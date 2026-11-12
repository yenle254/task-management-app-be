const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { FILE_UPLOAD } = require('../utils/constants.utils');

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const { allowedExtension, inspectFile } = require('../utils/file-signature.helper');
const { hasUnsafeKeys } = require('./sanitize.middleware');
const {
  isCloudinaryEnabled,
  uploadToCloudinary,
  deleteFromCloudinary,
} = require('../config/cloudinary.config');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${req.user._id}-${uniqueSuffix}${ext.toLowerCase()}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (!allowedExtension(file.originalname)) {
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
    // Busboy signals the limit when it reaches this byte count. Permit the
    // documented inclusive maximum; the first extra byte is rejected.
    fileSize: FILE_UPLOAD.MAX_SIZE + 1,
  },
});

const verifiedUpload = middleware => (req, res, next) => {
  middleware(req, res, async error => {
    const files = req.files || (req.file ? [req.file] : []);
    const uploadedToCloud = [];
    try {
      if (error) throw error;
      if (hasUnsafeKeys(req.body)) throw new Error('Unsupported input keys');
      for (const file of files) {
        const detected = await inspectFile(file.path, file.originalname);
        if (!detected) throw new Error('File content does not match its extension');
        file.mimetype = detected;
      }
      if (isCloudinaryEnabled()) {
        for (const file of files) {
          try {
            await uploadToCloudinary(file.path, file.filename);
            uploadedToCloud.push(file.filename);
            await fs.promises.unlink(file.path).catch(() => {});
          } catch (cloudError) {
            if (process.env.NODE_ENV !== 'production') {
              console.warn(`[Cloudinary] Upload failed (${cloudError.message}). Kept file locally at uploads/${file.filename}`);
            } else {
              throw cloudError;
            }
          }
        }
      }
      next();
    } catch (failure) {
      await Promise.all([
        ...files.map(file => fs.promises.unlink(file.path).catch(() => {})),
        ...uploadedToCloud.map(filename => deleteFromCloudinary(filename).catch(() => {})),
      ]);
      next(failure);
    }
  });
};
const uploadSingle = verifiedUpload(upload.single('attachment'));
const uploadFile = verifiedUpload(upload.single('file'));
const uploadMultiple = verifiedUpload(upload.array('attachments', FILE_UPLOAD.MAX_FILES));

const uploadErrorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: 'File too large. File under 10MB is allowed' });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || (err.code === 'LIMIT_UNEXPECTED_FILE' && err.field === 'attachments')) {
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


const deleteFile = async (filename, { throwOnError = false } = {}) => {
  try {
    if (!filename || path.basename(filename) !== filename || filename.includes('..') || filename.includes('\\')) return false;
    let deleted = false;
    const filePath = path.join(uploadsDir, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      deleted = true;
    }
    if (isCloudinaryEnabled()) {
      const cloudDeleted = await deleteFromCloudinary(filename);
      deleted = deleted || cloudDeleted;
    }
    return deleted;
  } catch (error) {
    console.error('Delete file error:', error);
    if (throwOnError) throw error;
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
