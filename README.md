# SOC File Portal — Secure File Upload & Download (Flask + AES-GCM)

## Overview
This project is a simple secure file portal built with Python Flask that demonstrates:
- AES-GCM authenticated encryption for files at rest
- Per-file key derivation using HKDF from a master key
- Secure storage of encrypted blobs on disk with metadata in SQLite

This is a demo/training project intended for internship Task 3 (Future Interns).

## Features
- Upload files (encrypted with AES-GCM before saving)
- Download files (decrypted and streamed)
- List uploaded files (metadata only)
- Basic token authentication for endpoints
- Configurable via environment variables

## Setup (Kali / Linux)
```bash
# clone repo
git clone https://github.com/USERNAME/soc-file-portal.git
cd soc-file-portal

# create venv & install
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# prepare data dir
mkdir -p data demo_files

# create environment variables (example)
export MASTER_KEY=$(head -c 32 /dev/urandom | base64)
export API_TOKEN="replace-with-secure-token"
export DATA_DIR="./data"
export DB_PATH="./filemeta.db"

# run app
python app.py
# or
gunicorn -b 0.0.0.0:5000 app:app
```

## API examples
Upload:
```bash
curl -X POST -H "X-API-Token: $API_TOKEN" \
  -F "file=@demo_files/example.txt" \
  -F "uploader=you" \
  http://localhost:5000/upload
```

List:
```bash
curl -H "X-API-Token: $API_TOKEN" http://localhost:5000/list
```

Download:
```bash
curl -H "X-API-Token: $API_TOKEN" -OJ http://localhost:5000/download/<id>
```

## Security notes
See `SECURITY.md` for design rationale, threats, and recommended production hardening.

## License
MIT — demo/synthetic project for learning.
