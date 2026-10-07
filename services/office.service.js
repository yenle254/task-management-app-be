/**
 * Office Service
 * Business logic cho office management
 */
const Office = require('../models/office.model');

/**
 * Get active office
 * @returns {Object|null} Active office or null
 */
const getActiveOffice = async () => {
  return await Office.findOne({ isActive: true });
};

/**
 * Validate if location is within active office area using Haversine formula
 * @param {Number} lat - Latitude
 * @param {Number} lng - Longitude
 * @returns {Boolean}
 */
const validateLocation = async (lat, lng) => {
  const office = await getActiveOffice();

  if (!office) {
    // Nếu không có office nào active, cho phép check-in (hoặc reject tùy yêu cầu)
    console.warn('No active office found, allowing check-in');
    return true;
  }

  const { lat: officeLat, lng: officeLng } = office.location;
  const radius = office.radius || 200; // Default 200m

  // Sử dụng Haversine formula để tính khoảng cách
  const distance = calculateDistance(lat, lng, officeLat, officeLng);

  return distance <= radius;
};

/**
 * Calculate distance between two points using Haversine formula
 * @param {Number} lat1 - Latitude point 1
 * @param {Number} lng1 - Longitude point 1
 * @param {Number} lat2 - Latitude point 2
 * @param {Number} lng2 - Longitude point 2
 * @returns {Number} Distance in meters
 */
const calculateDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371000; // Bán kính Trái Đất in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;

  return distance;
};

/**
 * Convert degree to radians
 */
const toRad = (deg) => {
  return deg * (Math.PI / 180);
};

/**
 * Get all offices
 */
const getAllOffices = async () => {
  return await Office.find().sort({ createdAt: -1 });
};

/**
 * Get office by ID
 */
const getOfficeById = async (id) => {
  return await Office.findById(id);
};

/**
 * Create new office
 */
const createOffice = async (data) => {
  // Nếu là office active, deactivate others
  if (data.isActive) {
    await Office.updateMany({ isActive: true }, { isActive: false });
  }
  return await Office.create(data);
};

/**
 * Update office
 */
const updateOffice = async (id, data) => {
  const office = await Office.findById(id);
  if (!office) {
    throw new Error('Office not found');
  }

  // Nếu set là active, deactivate others
  if (data.isActive && !office.isActive) {
    await Office.updateMany({ _id: { $ne: id }, isActive: true }, { isActive: false });
  }

  Object.assign(office, data);
  return await office.save();
};

/**
 * Delete office
 */
const deleteOffice = async (id) => {
  return await Office.findByIdAndDelete(id);
};

/**
 * Set active office
 */
const setActiveOffice = async (id) => {
  const office = await Office.findById(id);
  if (!office) {
    throw new Error('Office not found');
  }

  // Deactivate all
  await Office.updateMany({}, { isActive: false });

  // Activate selected
  office.isActive = true;
  await office.save();

  return office;
};

module.exports = {
  getActiveOffice,
  validateLocation,
  calculateDistance,
  getAllOffices,
  getOfficeById,
  createOffice,
  updateOffice,
  deleteOffice,
  setActiveOffice
};
