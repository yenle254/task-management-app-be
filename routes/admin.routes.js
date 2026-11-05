const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth.middleware');
const asyncHandler = require('../middleware/async-handler.middleware');
const { validateRequest } = require('../middleware/validate-request.middleware');
const { createHRAccountValidation } = require('../validators/admin.validators');
const { createHRAccount } = require('../controllers/admin.controller');
const { USER_ROLES } = require('../utils/constants.utils');

// All routes require authentication; each operation declares its allowed roles.
router.use(protect);

// POST /api/admin/hr-accounts - Create HR Manager account
router.post('/hr-accounts', authorize(USER_ROLES.SYSTEM_ADMIN), createHRAccountValidation, validateRequest, asyncHandler(createHRAccount));

const { auditLimiter } = require('../middleware/rate-limit.middleware');
const audit = require('../controllers/audit.controller');
const rules = require('../validators/audit.validators');
const canReadAudit = authorize(USER_ROLES.SYSTEM_ADMIN, USER_ROLES.HR_MANAGER);
router.get('/audit-logs', canReadAudit, auditLimiter, rules.listAuditLogsValidation, validateRequest, asyncHandler(audit.listAuditLogs));
router.get('/audit-logs/target/:type/:id', canReadAudit, auditLimiter, rules.targetAuditLogsValidation, validateRequest, asyncHandler(audit.getTargetAuditLogs));
router.get('/audit-logs/:id', canReadAudit, auditLimiter, rules.auditLogIdValidation, validateRequest, asyncHandler(audit.getAuditLogById));

module.exports = router;
