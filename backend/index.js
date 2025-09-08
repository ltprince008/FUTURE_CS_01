const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const port = 5000;

// Ensure uploads folder exists inside backend/
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Helper to generate a unique filename if it already exists
function getUniqueFilename(originalName) {
  const filePath = path.join(uploadDir, originalName);
  if (!fs.existsSync(filePath)) return originalName;

  const ext = path.extname(originalName);
  const name = path.basename(originalName, ext);

  let counter = 1;
  let newName;
  do {
    newName = `${name}(${counter})${ext}`;
    counter++;
  } while (fs.existsSync(path.join(uploadDir, newName)));

  return newName;
}

// Multer setup for file uploads (preserve original filename, avoid overwrite)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, getUniqueFilename(file.originalname));
  },
});

const upload = multer({ storage });

// Serve static frontend files (JS/CSS) from Static/
app.use(express.static(path.join(__dirname, '../Static')));
app.use(express.json());

// Serve index.html from templates/
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../templates/index.html'));
});

// File upload route (multiple files)
app.post('/upload', upload.array('files'), (req, res) => {
  console.log('Upload route hit:', req.files);
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: 'No files uploaded' });
  }
  const uploadedFiles = req.files.map(f => f.filename);
  res.json({ message: 'Files uploaded successfully!', files: uploadedFiles });
});

// Download file
app.get('/download/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ message: 'File not found' });
  }
});

// Delete file
app.delete('/delete/:filename', (req, res) => {
  const filePath = path.join(uploadDir, req.params.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    res.json({ message: 'File deleted successfully' });
  } else {
    res.status(404).json({ message: 'File not found' });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
