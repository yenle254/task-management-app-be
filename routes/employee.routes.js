const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth.middleware');
const { USER_ROLES } = require('../utils/constants.utils');
const asyncHandler = require('../middleware/async-handler.middleware');
const { getDashboard, getMyTasks } = require('../controllers/employee.controller');

// All routes require authentication
router.use(protect);
router.use(authorize(USER_ROLES.EMPLOYEE));

// Dashboard and tasks
router.get('/dashboard', asyncHandler(getDashboard));
router.get('/tasks', asyncHandler(getMyTasks));

module.exports = router;
