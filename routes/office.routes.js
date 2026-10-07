/**
 * Office Routes
 */
const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middleware/auth.middleware');
const { USER_ROLES } = require('../utils/constants.utils');
const {
  getAllOffices,
  getActiveOffice,
  createOffice,
  updateOffice,
  deleteOffice,
  setActiveOffice
} = require('../controllers/office.controller');
const { validateRequest } = require('../middleware/validate-request.middleware');
const {
  createOfficeValidation,
  updateOfficeValidation,
  officeIdValidation
} = require('../validators/office.validators');

// All routes require authentication
router.use(protect);

// HR Manager only can manage offices
router.get('/', getAllOffices);
router.get('/active', getActiveOffice);

router.post(
  '/',
  authorize(USER_ROLES.HR_MANAGER),
  createOfficeValidation,
  validateRequest,
  createOffice
);

router.put(
  '/:id',
  authorize(USER_ROLES.HR_MANAGER),
  updateOfficeValidation,
  validateRequest,
  updateOffice
);

router.put(
  '/:id/activate',
  authorize(USER_ROLES.HR_MANAGER),
  officeIdValidation,
  validateRequest,
  setActiveOffice
);

router.delete(
  '/:id',
  authorize(USER_ROLES.HR_MANAGER),
  officeIdValidation,
  validateRequest,
  deleteOffice
);

module.exports = router;
