/**
 * message.validators.js
 * Validation rules for messaging endpoints
 */

const { body, param, query } = require('express-validator');

/**
 * Validation chain for sending a message
 */
const sendMessageValidation = [
  body('receiverId')
    .notEmpty().withMessage('Receiver ID is required')
    .custom((value) => {
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid receiver ID');
      }
      return true;
    }),

  body('message')
    .optional()
    .trim()
    .isLength({ max: 5000 }).withMessage('Message must be at most 5000 characters'),

  body('attachments')
    .optional()
    .isArray().withMessage('Attachments must be an array'),

  body('conversationId')
    .optional()
    .custom((value) => {
      if (value !== null) {
        const mongoose = require('mongoose');
        if (!mongoose.Types.ObjectId.isValid(value)) {
          throw new Error('Invalid conversation ID');
        }
      }
      return true;
    })
];

/**
 * Validation chain for getting messages in a conversation
 */
const getMessagesValidation = [
  param('conversationId')
    .custom((value) => {
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid conversation ID');
      }
      return true;
    }),

  query('page')
    .optional()
    .isInt({ min: 1 }).withMessage('Page must be a positive integer')
    .toInt(),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
    .toInt()
];

/**
 * Validation chain for getting conversation by user
 */
const getConversationByUserValidation = [
  param('userId')
    .custom((value) => {
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid user ID');
      }
      return true;
    })
];

/**
 * Validation chain for marking messages as read
 */
const markAsReadValidation = [
  param('conversationId')
    .custom((value) => {
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid conversation ID');
      }
      return true;
    })
];

/**
 * Validation chain for deleting a message
 */
const deleteMessageValidation = [
  param('id')
    .custom((value) => {
      const mongoose = require('mongoose');
      if (!mongoose.Types.ObjectId.isValid(value)) {
        throw new Error('Invalid message ID');
      }
      return true;
    })
];

module.exports = {
  sendMessageValidation,
  getMessagesValidation,
  getConversationByUserValidation,
  markAsReadValidation,
  deleteMessageValidation
};
