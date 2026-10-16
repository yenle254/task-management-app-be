const adminService = require('../services/admin.service');

/**
 * @desc    Create HR Manager account
 * @route   POST /api/admin/hr-accounts
 * @access  Private (System Admin only)
 */
const createHRAccount = async (req, res) => {
  try {
    const { email, password, profile } = req.body;

    if (!email || !password || !profile?.fullName || !profile?.employeeId) {
      return res.status(400).json({
        success: false,
        error: 'Email, password, fullName, and employeeId are required'
      });
    }

    const user = await adminService.createHRAccount({ email, password, profile });

    res.status(201).json({
      success: true,
      message: 'HR Manager account created successfully',
      data: user
    });
  } catch (error) {
    console.error('Create HR account error:', error);
    const statusCode = error.message.includes('already') ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  createHRAccount,
};
