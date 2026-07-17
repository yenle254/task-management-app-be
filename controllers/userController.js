const Team = require("../models/Team");
const User = require("../models/User");
const userService = require("../services/userService");

/**
 * @desc    Get all users
 * @route   GET /api/users
 * @access  Private (HR Manager)
 */

const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search, role, department } = req.query;

    const filters = {};
    if (search) filters.search = search;
    if (role) filters.role = role;
    if (department) filters.department = department;

    const result = await userService.getAllUsers(
      filters,
      parseInt(page),
      parseInt(limit)
    );

    res.status(200).json({
      success: true,
      data: result.users,
      pagination: result.pagination,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc    Get user by ID
 * @route   GET /api/users/:id
 * @access  Private
 */
const getUserById = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await userService.getUserById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc    Update user by ID
 * @route   PUT /api/users/:id
 * @access  Private (HR Manager)
 */
const updateUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const updateData = req.body;
    const user = await userService.updateUser(userId, updateData);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc    Delete (soft) user by ID
 * @route   DELETE /api/users/:id
 * @access  Private (HR Manager)
 */
const deleteUser = async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await userService.deleteUser(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

/**
 * @desc    Get users by Team ID
 * @route   GET /api/users/team/:teamId
 * @access  Private
 */
const getUsersByTeam = async (req, res) => {
  try {
    const teamId = req.params.teamId;
    const users = await userService.getUsersByTeam(teamId);
    res.status(200).json({
      success: true,
      data: users,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  getUsersByTeam,
};
