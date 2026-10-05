const express = require('express');
const router = express.Router();
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
router.get('/unread/count', getUnreadCount);

// Get all conversations
router.get('/conversations', getConversations);

// Get conversation by user ID
router.get('/conversation/user/:userId', getConversationByUserValidation, validateRequest, getConversationByUser);

// Get messages in conversation
router.get('/conversation/:conversationId', getMessagesValidation, validateRequest, getMessages);

// Send message
router.post('/', sendMessageValidation, validateRequest, sendMessage);

// Mark messages as read
router.put('/:conversationId/read', markAsRead);

// Delete message
router.delete('/:id', deleteMessage);

module.exports = router;

