const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth.middleware');
const asyncHandler = require('../middleware/async-handler.middleware');
const { validateRequest } = require('../middleware/validate-request.middleware');
const { createHRAccountValidation } = require('../validators/admin.validators');
const { createHRAccount } = require('../controllers/admin.controller');
const { USER_ROLES } = require('../utils/constants.utils');

// All routes require system_admin role
router.use(protect);
router.use(authorize(USER_ROLES.SYSTEM_ADMIN));

// POST /api/admin/hr-accounts - Create HR Manager account
router.post('/hr-accounts', createHRAccountValidation, validateRequest, asyncHandler(createHRAccount));

module.exports = router;
