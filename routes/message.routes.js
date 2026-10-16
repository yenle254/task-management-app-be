const express = require('express');
const router = express.Router();
const asyncHandler = require('../middleware/async-handler.middleware');
const {
    sendMessage,
    getConversations,
    getMessages,
    markAsRead,
    deleteMessage,
    getUnreadCount,
    getConversationByUser
} = require('../controllers/message.controller');
const { protect } = require('../middleware/auth.middleware');
const { validateRequest } = require('../middleware/validate-request.middleware');
const {
  sendMessageValidation,
  getMessagesValidation,
  getConversationByUserValidation
} = require('../validators');

router.use(protect);

// Get unread count
router.get('/unread/count', asyncHandler(getUnreadCount));

// Get all conversations
router.get('/conversations', asyncHandler(getConversations));

// Get conversation by user ID
router.get('/conversation/user/:userId', getConversationByUserValidation, validateRequest, asyncHandler(getConversationByUser));

// Get messages in conversation
router.get('/conversation/:conversationId', getMessagesValidation, validateRequest, asyncHandler(getMessages));

// Send message
router.post('/', sendMessageValidation, validateRequest, asyncHandler(sendMessage));

// Mark messages as read
router.put('/:conversationId/read', asyncHandler(markAsRead));

// Delete message
router.delete('/:id', asyncHandler(deleteMessage));

module.exports = router;

