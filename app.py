import os  # <-- added this
import sqlite3
import uuid
import datetime
from flask import Flask, request, jsonify, send_file, abort, g
from werkzeug.utils import secure_filename
from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from Crypto.Protocol.KDF import HKDF
from Crypto.Hash import SHA256
import io, base64
import webbrowser

# ---------- CONFIG ----------
DATA_DIR = os.environ.get("DATA_DIR", "./data")
DB_PATH = os.environ.get("DB_PATH", "./filemeta.db")
MASTER_KEY = os.environ.get("MASTER_KEY")  # base64 expected
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB default cap
AUTH_TOKEN = os.environ.get("API_TOKEN", "demo-token")

if not MASTER_KEY:
    raise SystemExit("Set MASTER_KEY environment variable before running (base64-encoded 32 bytes).")

try:
    MASTER_KEY_BYTES = base64.b64decode(MASTER_KEY)
except Exception:
    MASTER_KEY_BYTES = MASTER_KEY.encode()[:32]

if len(MASTER_KEY_BYTES) < 32:
    MASTER_KEY_BYTES = (MASTER_KEY_BYTES + b'\x00'*32)[:32]

os.makedirs(DATA_DIR, exist_ok=True)

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = MAX_FILE_SIZE

# ---------- DB helpers ----------
def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
    return db

def init_db():
    db = get_db()
    db.execute("""
    CREATE TABLE IF NOT EXISTS files (
        id TEXT PRIMARY KEY,
        filename TEXT,
        stored_name TEXT,
        uploader TEXT,
        content_type TEXT,
        size INTEGER,
        salt BLOB,
        nonce BLOB,
        created_at TEXT
    )""")
    db.commit()

@app.teardown_appcontext
def close_db(err):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()

# ---------- Crypto helpers ----------
def derive_file_key(master_key: bytes, salt: bytes, length=32):
    return HKDF(master=master_key, key_len=length, salt=salt, hashmod=SHA256)

def encrypt_bytes(plaintext: bytes, file_salt: bytes):
    key = derive_file_key(MASTER_KEY_BYTES, file_salt)
    nonce = get_random_bytes(12)
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    ciphertext, tag = cipher.encrypt_and_digest(plaintext)
    return nonce, tag, ciphertext

def decrypt_bytes(nonce: bytes, tag: bytes, ciphertext: bytes, file_salt: bytes):
    key = derive_file_key(MASTER_KEY_BYTES, file_salt)
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    plaintext = cipher.decrypt_and_verify(ciphertext, tag)
    return plaintext

# ---------- Auth decorator ----------
from functools import wraps
def require_token(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        token = request.headers.get("X-API-Token")
        if token != AUTH_TOKEN:
            return jsonify({"error":"unauthorized"}), 401
        return f(*args, **kwargs)
    return wrapped

# ---------- Endpoints ----------
@app.route("/upload", methods=["POST"])
@require_token
def upload():
    if "file" not in request.files:
        return jsonify({"error":"no file part"}), 400
    file = request.files["file"]
    uploader = request.form.get("uploader", "anonymous")
    if file.filename == "":
        return jsonify({"error":"empty filename"}), 400
    orig_name = secure_filename(file.filename)
    data = file.read()
    if not data:
        return jsonify({"error":"empty file"}), 400

    salt = get_random_bytes(16)
    nonce, tag, ciphertext = encrypt_bytes(data, salt)

    file_id = str(uuid.uuid4())
    stored_name = f"{file_id}.enc"
    stored_path = os.path.join(DATA_DIR, stored_name)

    with open(stored_path, "wb") as fh:
        fh.write(tag + ciphertext)

    db = get_db()
    created_at = datetime.datetime.utcnow().isoformat() + "Z"
    db.execute("INSERT INTO files (id, filename, stored_name, uploader, content_type, size, salt, nonce, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
               (file_id, orig_name, stored_name, uploader, file.content_type, len(data), salt, nonce, created_at))
    db.commit()

    return jsonify({"id": file_id, "filename": orig_name, "size": len(data)}), 201

@app.route("/download/<file_id>", methods=["GET"])
@require_token
def download(file_id):
    db = get_db()
    row = db.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
    if not row:
        return jsonify({"error":"not found"}), 404
    stored_path = os.path.join(DATA_DIR, row["stored_name"])
    if not os.path.exists(stored_path):
        return jsonify({"error":"encrypted file missing"}), 500

    with open(stored_path, "rb") as fh:
        raw = fh.read()
    tag = raw[:16]
    ciphertext = raw[16:]
    salt = row["salt"]
    nonce = row["nonce"]
    try:
        plaintext = decrypt_bytes(nonce, tag, ciphertext, salt)
    except Exception as e:
        return jsonify({"error":"decryption failed", "detail": str(e)}), 500

    return send_file(io.BytesIO(plaintext),
                     as_attachment=True,
                     download_name=row["filename"],
                     mimetype=row["content_type"] or "application/octet-stream")

@app.route("/list", methods=["GET"])
@require_token
def list_files():
    db = get_db()
    rows = db.execute("SELECT id, filename, uploader, size, created_at FROM files ORDER BY created_at DESC").fetchall()
    out = [dict(r) for r in rows]
    return jsonify(out)

# ---------- Run app ----------
if __name__ == "__main__":
    with app.app_context():
        init_db()
        webbrowser.open("http://127.0.0.1:5000/list")
    app.run(host="0.0.0.0", port=5000, debug=False)
