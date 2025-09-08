// script.js

const backendURL = 'http://localhost:5000';

// Master key for HKDF-derived per-file keys (demo, in-memory)
const masterKeyRaw = new TextEncoder().encode("SuperSecretMasterKey123!");
let masterCryptoKey;
let masterReady; // Promise that resolves when master key is imported

// Persisted metadata (array of { fileName, iv: [..], salt: [..] })
let encryptedFiles = JSON.parse(localStorage.getItem("encryptedFiles") || "[]");

// Import master key for HKDF
async function importMasterKey() {
  masterCryptoKey = await crypto.subtle.importKey(
    "raw",
    masterKeyRaw,
    "HKDF",
    false,
    ["deriveKey"]
  );
}
 
// Derive per-file key using HKDF (salt must be Uint8Array)
async function deriveFileKey(fileName, salt) {
  const info = new TextEncoder().encode(fileName);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info },
    masterCryptoKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

// Encrypt file: returns { encrypted: ArrayBuffer, iv: Uint8Array, salt: Uint8Array, fileName }
async function encryptFile(file) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveFileKey(file.name, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await file.arrayBuffer();

  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);

  // Update persistent metadata (store IV and salt as plain arrays)
  encryptedFiles = encryptedFiles.filter(m => m.fileName !== file.name); // dedupe
  encryptedFiles.push({ fileName: file.name, iv: Array.from(iv), salt: Array.from(salt) });
  localStorage.setItem("encryptedFiles", JSON.stringify(encryptedFiles));

  return { encrypted, iv, salt, fileName: file.name };
}

// Add file row to UI
function addFileToTable(fileName, status) {
  const fileList = document.querySelector(".file-list");
  const fileItem = document.createElement("div");
  fileItem.className = "file-item";

  fileItem.innerHTML = `
    <div class="file-icon"></div>
    <div class="file-info">
      <div class="file-name">${fileName}</div>
      <div class="file-meta status-${status}">${status}</div>
    </div>
    <div class="file-actions">
      <button class="file-action download">Download</button>
      <button class="file-action delete" style="color: var(--error)">Delete</button>
    </div>
  `;
  fileList.appendChild(fileItem);

  // Download should request the .enc file and then decrypt client-side
  fileItem.querySelector(".download").addEventListener("click", (e) => {
    e.preventDefault();
    downloadFile(fileName + ".enc");
  });

  fileItem.querySelector(".delete").addEventListener("click", (e) => {
    e.preventDefault();
    deleteFile(fileName + ".enc", fileItem);
  });
}

// Download + decrypt the .enc file, then trigger a save of original filename
async function downloadFile(fileName) {
  try {
    const res = await fetch(`${backendURL}/download/${encodeURIComponent(fileName)}`);
    if (!res.ok) throw new Error('File not found on server');

    const encryptedBlob = await res.blob();
    const encryptedBuffer = await encryptedBlob.arrayBuffer();

    const originalName = fileName.replace(/\.enc$/i, "");
    const stored = encryptedFiles.find(f => f.fileName === originalName);
    if (!stored) throw new Error("Encryption metadata not found for " + originalName);

    // Ensure master key is ready
    await masterReady;

    const iv = new Uint8Array(stored.iv);
    const salt = new Uint8Array(stored.salt);

    const key = await deriveFileKey(stored.fileName, salt);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encryptedBuffer
    );

    const originalBlob = new Blob([decrypted]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(originalBlob);
    a.download = stored.fileName;
    a.click();

  } catch (err) {
    console.error(err);
    alert("Error downloading/decrypting file: " + err.message);
  }
}

// Delete file: remove metadata and tell server to delete .enc file
async function deleteFile(fileName, rowElement) {
  const originalName = fileName.replace(/\.enc$/i, "");
  encryptedFiles = encryptedFiles.filter(f => f.fileName !== originalName);
  localStorage.setItem("encryptedFiles", JSON.stringify(encryptedFiles));

  if (rowElement && rowElement.remove) rowElement.remove();

  try {
    const res = await fetch(`${backendURL}/delete/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
    const data = await res.json();
    console.log('Delete response:', data);
    alert(data.message);
  } catch (err) {
    console.error(err);
    alert("Error deleting file from server");
  }
}

// Upload files: encrypt each file client-side, append encrypted Blob as .enc, then POST
document.getElementById("uploadBtn").addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;

  input.addEventListener("change", async () => {
    // wait until master key is ready
    await masterReady;

    const formData = new FormData();

    for (const file of input.files) {
      addFileToTable(file.name, "Pending");

      try {
        const encryptedFile = await encryptFile(file);
        const encryptedBlob = new Blob([encryptedFile.encrypted], { type: "application/octet-stream" });

        // append encrypted blob with .enc name
        formData.append('files', encryptedBlob, file.name + ".enc");
      } catch (err) {
        console.error("Encryption failed for", file.name, err);
        alert("Encryption failed for " + file.name);
      }
    }

    try {
      console.log('Uploading encrypted files to backend...');
      const res = await fetch(`${backendURL}/upload`, {
        method: 'POST',
        body: formData
      });

      if (!res.ok) throw new Error(`Upload failed. Status: ${res.status}`);

      const data = await res.json();
      console.log('Upload response data:', data);

      // Update UI statuses for files that finished uploading
      if (Array.isArray(data.files)) {
        data.files.forEach(encName => {
          const originalName = encName.replace(/\.enc$/i, "");
          const items = document.querySelectorAll('.file-item');
          for (const item of items) {
            const nameEl = item.querySelector('.file-name');
            const metaEl = item.querySelector('.file-meta');
            if (nameEl && metaEl && nameEl.textContent === originalName && metaEl.textContent === "Pending") {
              metaEl.textContent = "Uploaded";
              metaEl.className = "file-meta status-success";
            }
          }
        });
      }

      alert(data.message);
    } catch (err) {
      console.error('Upload error:', err);
      alert(`Error uploading files to server: ${err.message}`);
    }
  });

  input.click();
});

// Login (unchanged)
document.getElementById("loginBtn").addEventListener("click", () => {
  const username = prompt("Enter username:");
  const password = prompt("Enter password:");

  fetch(`${backendURL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  })
  .then(res => res.json())
  .then(data => alert(data.message))
  .catch(err => console.error('Login error:', err));
});

// Initialize master key and populate UI from localStorage
masterReady = importMasterKey();
masterReady
  .then(() => {
    // show previously-uploaded (persisted metadata) files in UI
    for (const meta of encryptedFiles) {
      addFileToTable(meta.fileName, "Uploaded");
    }
  })
  .catch(err => {
    console.error("Failed to import master key:", err);
  });
