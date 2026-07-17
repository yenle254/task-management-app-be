const express = require('express');
const router = express.Router();
const { uploadFile, uploadErrorHandler, getFileUrl } = require('../middleware/upload');
const { protect } = require('../middleware/auth');

/**
 * @desc    Upload a single file
 * @route   POST /api/upload
 * @access  Private
 */
router.post('/', protect, uploadFile, uploadErrorHandler, (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const fileUrl = getFileUrl(req.file.filename, req);

    res.status(200).json({
      success: true,
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

