const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const BLOCKED_EXTENSIONS = [
  'exe', 'scr', 'com', 'bat', 'cmd', 'ps1', 'vbs', 'vbe', 'js', 'jse',
  'wsf', 'wsh', 'msc', 'msp', 'mst', 'pif', 'application', 'gadget',
  'hta', 'lnk', 'inf', 'reg', 'cpl', 'sh', 'bash', 'zsh', 'ksh', 'csh',
  'apk', 'deb', 'rpm', 'app', 'run', 'command',
  'dll', 'so', 'dylib', 'jar', 'class',
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'sldm',
  'iso', 'img', 'dmg', 'msi', 'msp', 'msu', 'cab', 'swf', 'air'
];

const isExtensionBlocked = (filename) => {
  if (!filename) return false;
  const ext = filename.toLowerCase().split('.').pop();
  return BLOCKED_EXTENSIONS.includes(ext);
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext);
    cb(null, `${req.user._id}-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (isExtensionBlocked(file.originalname)) {
    return cb(new Error(`Cannot upload file with extension ".${file.originalname.split('.').pop()}" due to security`), false);
  }

  const allowedMimes = [
    'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv', 'application/csv', 'text/comma-separated-values',
    'application/zip', 'application/x-zip-compressed',
    'application/vnd.rar', 'application/x-rar-compressed',
    'application/octet-stream'
  ];

  if (!allowedMimes.includes(file.mimetype)) {
    return cb(new Error('Allowed file types: PDF, Word (DOC/DOCX), Excel (XLS/XLSX), PowerPoint (PPT/PPTX), CSV, TXT, ZIP, RAR, Images (JPG/PNG/GIF/WEBP)'), false);
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

const uploadSingle = upload.single('attachment');
const uploadFile = upload.single('file'); // For general file upload
const uploadMultiple = upload.array('attachments', 5);

const uploadErrorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'File too large. File under 10MB is allowed' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ success: false, error: 'Maximum 5 files when uploading' });
    }
  }

  if (err) {
    return res.status(400).json({
      success: false,
      error: err.message || 'Upload failed'
    });
  }

  next();
};

const getFileUrl = (filename, req = null) => {
  // If request is available, use it to construct the full URL
  if (req) {
    const protocol = req.protocol;
    const host = req.get('host');
    return `${protocol}://${host}/uploads/${filename}`;
  }
  
  // Fallback: return relative path (will be constructed on client side)
  return `/uploads/${filename}`;
};


const deleteFile = async (filename) => {
  try {
    if (!filename) return false;
    const filePath = path.join(uploadsDir, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Delete file error:', error);
    return false;
  }
};

const getOriginalFilename = (filename) => {
  const parts = filename.split('-');
  if (parts.length >= 3) {
    return parts.slice(3).join('-');
  }
  return filename;
};

module.exports = {
  uploadSingle,
  uploadFile,
  uploadMultiple,
  uploadErrorHandler,
  getFileUrl,
  deleteFile,
  getOriginalFilename,
};