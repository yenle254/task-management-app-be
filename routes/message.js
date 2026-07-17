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
} = require('../controllers/messageController');
const { protect } = require('../middleware/auth');

router.use(protect);

// Get unread count
router.get('/unread/count', getUnreadCount);

// Get all conversations
router.get('/conversations', getConversations);

// Get conversation by user ID
router.get('/conversation/user/:userId', getConversationByUser);

// Get messages in conversation
router.get('/conversation/:conversationId', getMessages);

// Send message
router.post('/', sendMessage);

// Mark messages as read
router.put('/:conversationId/read', markAsRead);

// Delete message
router.delete('/:id', deleteMessage);



module.exports = router;

