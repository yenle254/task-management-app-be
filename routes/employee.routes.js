const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth.middleware');
const asyncHandler = require('../middleware/async-handler.middleware');
const { getDashboard, getMyTasks } = require('../controllers/employee.controller');

// All routes require authentication
router.use(protect);

// Dashboard and tasks
router.get('/dashboard', asyncHandler(getDashboard));
router.get('/tasks', asyncHandler(getMyTasks));

module.exports = router;
