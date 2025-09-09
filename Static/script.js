// script.js

// Deployment-safe backend URL
const backendURL = window.location.hostname === "localhost"
  ? "http://localhost:5000"
  : "https://future-cs-01.onrender.com";

// Master key for HKDF-derived per-file keys
const masterKeyRaw = new TextEncoder().encode("SuperSecretMasterKey123!");
let masterCryptoKey;
let masterReady;

// Persisted metadata: { fileName, iv, salt, storedName }
let encryptedFiles = JSON.parse(localStorage.getItem("encryptedFiles") || "[]");

// Import master key
async function importMasterKey() {
  masterCryptoKey = await crypto.subtle.importKey(
    "raw",
    masterKeyRaw,
    "HKDF",
    false,
    ["deriveKey"]
  );
}

// Derive per-file key
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

// Encrypt file
async function encryptFile(file) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveFileKey(file.name, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await file.arrayBuffer();

  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);

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

  fileItem.querySelector(".download").addEventListener("click", (e) => {
    e.preventDefault();
    downloadFile(fileName);
  });

  fileItem.querySelector(".delete").addEventListener("click", (e) => {
    e.preventDefault();
    deleteFile(fileName, fileItem);
  });
}

// Upload files
document.getElementById("uploadBtn").addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;

  input.addEventListener("change", async () => {
    await masterReady;
    const formData = new FormData();
    const pendingMetas = [];

    for (const file of input.files) {
      addFileToTable(file.name, "Pending");
      try {
        const encryptedFile = await encryptFile(file);
        const encryptedBlob = new Blob([encryptedFile.encrypted], { type: "application/octet-stream" });
        formData.append('files', encryptedBlob, file.name + ".enc");

        // Temporarily store metadata, update later after server response
        pendingMetas.push({
          fileName: file.name,
          iv: Array.from(encryptedFile.iv),
          salt: Array.from(encryptedFile.salt),
          storedName: null
        });

      } catch (err) {
        console.error("Encryption failed for", file.name, err);
        alert("Encryption failed for " + file.name);
      }
    }

    try {
      const res = await fetch(`${backendURL}/upload`, { method: "POST", body: formData });
      if (!res.ok) throw new Error(`Upload failed. Status: ${res.status}`);
      const data = await res.json();

      if (Array.isArray(data.files)) {
        // ✅ Map server response objects to local metas
        data.files.forEach((fileObj, idx) => {
          if (pendingMetas[idx] && fileObj.stored) {
            pendingMetas[idx].storedName = fileObj.stored;
          }
        });

        encryptedFiles.push(...pendingMetas);

        // Update UI statuses
        pendingMetas.forEach(meta => {
          const items = document.querySelectorAll(".file-item");
          for (const item of items) {
            const nameEl = item.querySelector(".file-name");
            const metaEl = item.querySelector(".file-meta");
            if (nameEl && metaEl && nameEl.textContent === meta.fileName && metaEl.textContent === "Pending") {
              metaEl.textContent = "Uploaded";
              metaEl.className = "file-meta status-success";
            }
          }
        });
      }

      localStorage.setItem("encryptedFiles", JSON.stringify(encryptedFiles));
      alert(data.message);

    } catch (err) {
      console.error("Upload error:", err);
      alert(`Error uploading files to server: ${err.message}`);
    }
  });

  input.click();
});

// Download file
async function downloadFile(fileName) {
  try {
    const meta = encryptedFiles.find(f => f.fileName === fileName);
    if (!meta || !meta.storedName) throw new Error("File metadata missing");

    const res = await fetch(`${backendURL}/download/${encodeURIComponent(meta.storedName)}`);
    if (!res.ok) throw new Error("File not found on server");

    const encryptedBuffer = await res.arrayBuffer();

    await masterReady;
    const key = await deriveFileKey(meta.fileName, new Uint8Array(meta.salt));
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(meta.iv) },
      key,
      encryptedBuffer
    );

    const blob = new Blob([decrypted]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = meta.fileName;
    a.click();

  } catch (err) {
    console.error(err);
    alert("Error downloading/decrypting file: " + err.message);
  }
}

// Delete file
async function deleteFile(fileName, rowElement) {
  const metaIndex = encryptedFiles.findIndex(f => f.fileName === fileName);
  if (metaIndex === -1) return;

  const meta = encryptedFiles[metaIndex];
  encryptedFiles.splice(metaIndex, 1);
  localStorage.setItem("encryptedFiles", JSON.stringify(encryptedFiles));

  if (rowElement && rowElement.remove) rowElement.remove();

  if (!meta.storedName) return;

  try {
    const res = await fetch(`${backendURL}/delete/${encodeURIComponent(meta.storedName)}`, { method: "DELETE" });
    const data = await res.json();
    console.log("Delete response:", data);
    alert(data.message);
  } catch (err) {
    console.error(err);
    alert("Error deleting file from server");
  }
}

// Login
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
  .catch(err => console.error("Login error:", err));
});

// Initialize master key and populate UI
masterReady = importMasterKey();
masterReady.then(() => {
  for (const meta of encryptedFiles) {
    addFileToTable(meta.fileName, "Uploaded");
  }
}).catch(err => console.error("Failed to import master key:", err));
