const User = require("../models/User");

/**
 * Get all users with pagination and filters
 * @param {Object} filters - Search/filter criteria
 * @param {Number} page - Page number
 * @param {Number} limit - Items per page
 * @returns {Object} - Users list and pagination info
 */

const getAllUsers = async (filters = {}, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  const query = { isActive: true };

  if (filters.search) {
    query.$or = [
      { "profile.fullName": { $regex: filters.search, $options: "i" } },
      { email: { $regex: filters.search, $options: "i" } },
    ];
  }

  // filter by role
  if (filters.role) {
    query.role = filters.role;
  }

  // filter by department
  if (filters.department) {
    query["profile.department"] = filters.department;
  }

  const total = await User.countDocuments(query);
  const users = await User.find(query)
    .skip(skip)
    .limit(limit)
    .select("-password") // exclude password field
    .populate("teamId", "name")
    .populate("managerId", "profile.fullName email")
    .sort({ createdAt: -1 });

  return {
    users,
    pagination: {
      current: page,
      total: Math.ceil(total / limit),
      count: users.length,
      totalRecords: total,
    },
  };
};

/**
 * Get user by ID
 * @param {String} userId
 * @returns {Object|null}
 */

const getUserById = async (userId) => {
  return await User.findById(userId)
    .select("-password")
    .populate("teamId", "name description");
};

/**
 * Update user info
 * @param {String} userId
 * @param {Object} updateData
 * @returns {Object}
 */

const updateUser = async (userId, updateData) => {
  const restrictedFields = ["email", "password", "_id"];
  restrictedFields.forEach((field) => delete updateData[field]);
  const user = await User.findByIdAndUpdate(
    userId,
    updateData, 
    {
      new: true,
      runValidators: true,
    }
  ).select("-password");

  return user;
};

/**
 * Delete user by ID
 * @param {String} userId
 * @returns {Object}
 */

const deleteUser = async (userId) => {
  return await User.findByIdAndUpdate(
    userId,
    { isActive: false }, 
    { new: true }
  );
};

/**
 * Get all user in a team
 * @param {String} teamId
 * @returns {Array}
 */

const getUsersByTeam = async (teamId) => {
  return await User.find({ teamId, isActive: true })
    .select("-password")
    .populate("teamId", "name")
    .populate("managerId", "profile.fullName email");
};

module.exports = {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUsersByTeam,
};
