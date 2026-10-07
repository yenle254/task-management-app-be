/**
 * Office Controller
 * Quản lý office locations cho phép check-in
 */
const Office = require('../models/office.model');

/**
 * Lấy tất cả offices
 */
const getAllOffices = async (req, res) => {
  try {
    const offices = await Office.find().sort({ createdAt: -1 });
    res.json({
      success: true,
      data: offices
    });
  } catch (error) {
    console.error('Get offices error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Lấy office đang active
 */
const getActiveOffice = async (req, res) => {
  try {
    const office = await Office.findOne({ isActive: true });

    if (!office) {
      return res.status(404).json({
        success: false,
        error: 'No active office found'
      });
    }

    res.json({
      success: true,
      data: office
    });
  } catch (error) {
    console.error('Get active office error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Tạo office mới
 */
const createOffice = async (req, res) => {
  try {
    const { name, address, location, radius, workingHours, isActive } = req.body;

    // Kiểm tra location
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      return res.status(400).json({
        success: false,
        error: 'Valid location (lat, lng) is required'
      });
    }

    // Nếu là office active, deactivate các office khác
    if (isActive) {
      await Office.updateMany(
        { isActive: true },
        { isActive: false }
      );
    }

    const office = await Office.create({
      name,
      address,
      location,
      radius: radius || 200,
      workingHours: workingHours || { start: '09:00', end: '18:00' },
      isActive: isActive !== false
    });

    res.status(201).json({
      success: true,
      message: 'Office created successfully',
      data: office
    });
  } catch (error) {
    console.error('Create office error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Cập nhật office
 */
const updateOffice = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, location, radius, workingHours, isActive } = req.body;

    const office = await Office.findById(id);
    if (!office) {
      return res.status(404).json({
        success: false,
        error: 'Office not found'
      });
    }

    // Nếu set là active, deactivate các office khác
    if (isActive && !office.isActive) {
      await Office.updateMany(
        { _id: { $ne: id }, isActive: true },
        { isActive: false }
      );
    }

    // Update fields
    if (name !== undefined) office.name = name;
    if (address !== undefined) office.address = address;
    if (location !== undefined) office.location = location;
    if (radius !== undefined) office.radius = radius;
    if (workingHours !== undefined) office.workingHours = workingHours;
    if (isActive !== undefined) office.isActive = isActive;

    await office.save();

    res.json({
      success: true,
      message: 'Office updated successfully',
      data: office
    });
  } catch (error) {
    console.error('Update office error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Xóa office
 */
const deleteOffice = async (req, res) => {
  try {
    const { id } = req.params;

    const office = await Office.findByIdAndDelete(id);
    if (!office) {
      return res.status(404).json({
        success: false,
        error: 'Office not found'
      });
    }

    res.json({
      success: true,
      message: 'Office deleted successfully'
    });
  } catch (error) {
    console.error('Delete office error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

/**
 * Set office active (switch active office)
 */
const setActiveOffice = async (req, res) => {
  try {
    const { id } = req.params;

    const office = await Office.findById(id);
    if (!office) {
      return res.status(404).json({
        success: false,
        error: 'Office not found'
      });
    }

    // Deactivate all offices
    await Office.updateMany({}, { isActive: false });

    // Activate selected office
    office.isActive = true;
    await office.save();

    res.json({
      success: true,
      message: 'Active office updated successfully',
      data: office
    });
  } catch (error) {
    console.error('Set active office error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

module.exports = {
  getAllOffices,
  getActiveOffice,
  createOffice,
  updateOffice,
  deleteOffice,
  setActiveOffice
};
