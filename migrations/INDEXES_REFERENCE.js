/**
 * =====================================================
 * MONGODB PERFORMANCE INDEXES - QUICK REFERENCE
 * =====================================================
 *
 * This file documents all recommended indexes for the HR Management System.
 * Run commands manually in MongoDB shell or use with mongoose auto-index.
 *
 * Usage:
 *   mongo mongodb://127.0.0.1:27017/tma_demo migrations/simple_indexes.js
 *
 * Or add to server.js startup (not recommended for production):
 *   await Task.createIndexes();
 */

const mongoose = require('mongoose');

// ============================================
// TASKS COLLECTION
// ============================================
const taskIndexes = [
  // Single column indexes
  { key: { assignedTo: 1 }, description: 'getMyTasks, task lookup by assignee' },
  { key: { teamId: 1 }, description: 'getTeamTasks, getAllTasks' },
  { key: { status: 1 }, description: 'Filter by status (todo, done, deleted)' },
  { key: { assignedBy: 1 }, description: 'Get tasks created by user' },
  { key: { dueDate: 1 }, description: 'Sort by dueDate, overdue queries' },
  { key: { createdAt: -1 }, description: 'Default sort: newest first' },

  // Composite indexes - ordered by selectivity
  { key: { assignedTo: 1, status: 1 }, description: 'getMyTasks: assignedTo + filter deleted' },
  { key: { teamId: 1, status: 1 }, description: 'getTeamTasks, getAllTasks: team + filter deleted' },
  { key: { status: 1, dueDate: 1 }, description: 'Overdue tasks query' },
  { key: { assignedTo: 1, status: 1, dueDate: 1 }, description: 'Overdue + user filter' }
];

// ============================================
// USERS COLLECTION
// ============================================
const userIndexes = [
  { key: { teamId: 1 }, description: 'getUsersByTeam, getTeamMembers' },
  { key: { role: 1 }, description: 'Find HR managers, team leads' },
  { key: { isActive: 1 }, description: 'Filter active users' },
  { key: { role: 1, isActive: 1 }, description: 'getAvailableLeaders' },
  { key: { role: 1, teamId: 1 }, description: 'Find team lead of specific team' },
  { key: { teamId: 1, isActive: 1 }, description: 'getUsersByTeam with active filter' }
];

// ============================================
// ATTENDANCE COLLECTION
// ============================================
const attendanceIndexes = [
  { key: { userId: 1 }, description: 'Get user attendance records' },
  { key: { date: 1 }, description: 'Get attendance by date' },
  { key: { userId: 1, date: 1 }, description: 'Clock-in check (unique per user per day)' },
  { key: { userId: 1, date: -1 }, description: 'User attendance history' }
];

// ============================================
// LEAVES COLLECTION
// ============================================
const leaveIndexes = [
  { key: { userId: 1 }, description: 'Get user leave requests' },
  { key: { status: 1 }, description: 'Filter by status (pending, approved, rejected)' },
  { key: { userId: 1, status: 1 }, description: 'getMyLeaves, getPendingLeaves' },
  { key: { userId: 1, startDate: 1 }, description: 'Year filter for leave balance' },
  { key: { status: 1, createdAt: -1 }, description: 'Sort pending leaves by date' },
  { key: { startDate: 1 }, description: 'Date range queries' }
];

// ============================================
// NOTIFICATIONS COLLECTION
// ============================================
const notificationIndexes = [
  { key: { userId: 1 }, description: 'Get user notifications' },
  { key: { userId: 1, isRead: 1 }, description: 'Unread count, filter unread' },
  { key: { userId: 1, createdAt: -1 }, description: 'Paginate notifications' },
  { key: { userId: 1, type: 1 }, description: 'Filter by notification type' }
];

// ============================================
// CONVERSATIONS COLLECTION
// ============================================
const conversationIndexes = [
  { key: { participants: 1 }, description: 'Find conversation by participants' },
  { key: { participants: 1, lastMessageAt: -1 }, description: 'Get conversations sorted by recent' }
];

// ============================================
// MESSAGES COLLECTION
// ============================================
const messageIndexes = [
  { key: { conversationId: 1 }, description: 'Get messages in conversation' },
  { key: { conversationId: 1, createdAt: -1 }, description: 'Messages sorted by date' }
];

// ============================================
// TEAMS COLLECTION
// ============================================
const teamIndexes = [
  { key: { leaderId: 1 }, description: 'Find team by leader' },
  { key: { name: 1 }, unique: true, description: 'Team name uniqueness' }
];

// ============================================
// MONGODB SHELL COMMANDS (Run these manually)
// ============================================
/*
// Switch to database
use tma_demo;

// TASKS
db.tasks.createIndex({ assignedTo: 1 });
db.tasks.createIndex({ teamId: 1 });
db.tasks.createIndex({ status: 1 });
db.tasks.createIndex({ assignedBy: 1 });
db.tasks.createIndex({ dueDate: 1 });
db.tasks.createIndex({ createdAt: -1 });
db.tasks.createIndex({ assignedTo: 1, status: 1 });
db.tasks.createIndex({ teamId: 1, status: 1 });
db.tasks.createIndex({ status: 1, dueDate: 1 });
db.tasks.createIndex({ assignedTo: 1, status: 1, dueDate: 1 });

// USERS
db.users.createIndex({ teamId: 1 });
db.users.createIndex({ role: 1 });
db.users.createIndex({ isActive: 1 });
db.users.createIndex({ role: 1, isActive: 1 });
db.users.createIndex({ role: 1, teamId: 1 });
db.users.createIndex({ teamId: 1, isActive: 1 });

// ATTENDANCE
db.attendances.createIndex({ userId: 1 });
db.attendances.createIndex({ date: 1 });
db.attendances.createIndex({ userId: 1, date: 1 });
db.attendances.createIndex({ userId: 1, date: -1 });

// LEAVES
db.leaves.createIndex({ userId: 1 });
db.leaves.createIndex({ status: 1 });
db.leaves.createIndex({ userId: 1, status: 1 });
db.leaves.createIndex({ userId: 1, startDate: 1 });
db.leaves.createIndex({ status: 1, createdAt: -1 });
db.leaves.createIndex({ startDate: 1 });

// NOTIFICATIONS
db.notifications.createIndex({ userId: 1 });
db.notifications.createIndex({ userId: 1, isRead: 1 });
db.notifications.createIndex({ userId: 1, createdAt: -1 });
db.notifications.createIndex({ userId: 1, type: 1 });

// CONVERSATIONS
db.conversations.createIndex({ participants: 1 });
db.conversations.createIndex({ participants: 1, lastMessageAt: -1 });

// MESSAGES
db.messages.createIndex({ conversationId: 1 });
db.messages.createIndex({ conversationId: 1, createdAt: -1 });

// TEAMS
db.teams.createIndex({ leaderId: 1 });
db.teams.createIndex({ name: 1 }, { unique: true });

// Verify indexes
db.tasks.getIndexes();
*/

// ============================================
// EXPORT FOR PROGRAMMATIC USE
// ============================================
module.exports = {
  taskIndexes,
  userIndexes,
  attendanceIndexes,
  leaveIndexes,
  notificationIndexes,
  conversationIndexes,
  messageIndexes,
  teamIndexes
};
