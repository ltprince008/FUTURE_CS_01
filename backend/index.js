const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 5000;

// Enable CORS
app.use(cors());

// ✅ Use Render persistent disk
const uploadDir = process.env.RENDER_PERSISTENT_DIR
  ? path.join(process.env.RENDER_PERSISTENT_DIR, 'uploads')
  : path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Helper to prevent filename collisions
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

// Multer storage setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, getUniqueFilename(file.originalname)),
});

const upload = multer({ storage });

// Serve static frontend
app.use(express.static(path.join(__dirname, '../Static')));
app.use(express.json());

// Serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../templates/index.html'));
});

// ✅ Upload route with logging
app.post('/upload', upload.array('files'), (req, res) => {
  if (!req.files || req.files.length === 0) {
    console.log('⚠️ No files uploaded');
    return res.status(400).json({ message: 'No files uploaded' });
  }

  console.log('✅ Files uploaded:', req.files.map(f => ({
    original: f.originalname,
    stored: f.filename,
    path: f.path
  })));

  const uploadedFiles = req.files.map(f => ({
    original: f.originalname,
    stored: f.filename
  }));

  res.json({
    message: 'Files uploaded successfully!',
    files: uploadedFiles
  });
});

// ✅ Download route with logging (auto-check .enc if missing)
app.get('/download/:filename', (req, res) => {
  let filePath = path.join(uploadDir, req.params.filename);

  // If file without .enc is requested but only .enc exists
  if (!fs.existsSync(filePath) && !req.params.filename.endsWith('.enc')) {
    const encPath = filePath + '.enc';
    if (fs.existsSync(encPath)) filePath = encPath;
  }

  console.log('📥 Download request for:', req.params.filename);
  console.log('🔍 Resolved path:', filePath);

  if (fs.existsSync(filePath)) {
    console.log('✅ File found, sending:', filePath);
    res.download(filePath);
  } else {
    console.log('❌ File not found on server:', filePath);
    res.status(404).json({ message: 'File not found' });
  }
});

// ✅ Delete route with logging (auto-check .enc too)
app.delete('/delete/:filename', (req, res) => {
  let filePath = path.join(uploadDir, req.params.filename);

  // If file without .enc is requested but only .enc exists
  if (!fs.existsSync(filePath) && !req.params.filename.endsWith('.enc')) {
    const encPath = filePath + '.enc';
    if (fs.existsSync(encPath)) filePath = encPath;
  }

  console.log('🗑 Delete request for:', req.params.filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log('✅ File deleted:', filePath);
    res.json({ message: 'File deleted successfully' });
  } else {
    console.log('❌ File not found (delete):', filePath);
    res.status(404).json({ message: 'File not found' });
  }
});

// Start server
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
