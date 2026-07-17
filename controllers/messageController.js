const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const User = require('../models/User');

/**
 * @desc    Send a message
 * @route   POST /api/messages
 * @access  Private
 */
const sendMessage = async (req, res) => {
    try {
        const senderId = req.user._id;
        const { receiverId, message, attachments } = req.body;

        if (!receiverId) {
            return res.status(400).json({
                success: false,
                error: 'Receiver ID is required'
            });
        }

        if (!message && (!attachments || attachments.length === 0)) {
            return res.status(400).json({
                success: false,
                error: 'Message or attachments are required'
            });
        }

        const receiver = await User.findById(receiverId);
        if (!receiver) {
            return res.status(404).json({
                success: false,
                error: 'Receiver not found'
            });
        }

        let conversation = await Conversation.findOne({
            participants: { $all: [senderId, receiverId] }
        });

        if (!conversation) {
            conversation = await Conversation.create({
                participants: [senderId, receiverId],
                unreadCount: new Map([
                    [receiverId.toString(), 0]
                ])
            });
        }

        const newMessage = await Message.create({
            conversationId: conversation._id,
            senderId,
            message,
            attachments: attachments || [],
            isRead: false
        });

        conversation.lastMessage = message;
        conversation.lastMessageAt = new Date();
        
        const currentUnread = conversation.unreadCount.get(receiverId.toString()) || 0;
        conversation.unreadCount.set(receiverId.toString(), currentUnread + 1);
        
        await conversation.save();
        await newMessage.populate('senderId', 'email profile');

        const io = req.app.get('io');
        if (io) {
            io.to(`conversation_${conversation._id}`).emit('new_message', {
                message: newMessage,
                conversationId: conversation._id
            });

            io.to(receiverId.toString()).emit('message_notification', {
                conversationId: conversation._id,
                senderId: senderId.toString(),
                senderName: req.user.profile?.fullName || req.user.email,
                message: message,
                timestamp: newMessage.createdAt
            });
        }

        res.status(201).json({
            success: true,
            data: newMessage,
            conversationId: conversation._id
        });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Get all conversations for current user
 * @route   GET /api/messages/conversations
 * @access  Private
 */
const getConversations = async (req, res) => {
    try {
        const userId = req.user._id;

        const conversations = await Conversation.find({
            participants: userId
        })
            .populate('participants', 'email profile')
            .sort({ lastMessageAt: -1 });

        const formattedConversations = conversations.map(conv => {
            const otherParticipant = conv.participants.find(
                p => p._id.toString() !== userId.toString()
            );
            
            return {
                _id: conv._id,
                participant: otherParticipant,
                lastMessage: conv.lastMessage,
                lastMessageAt: conv.lastMessageAt,
                unreadCount: conv.unreadCount.get(userId.toString()) || 0,
                createdAt: conv.createdAt,
                updatedAt: conv.updatedAt
            };
        });

        res.json({
            success: true,
            count: formattedConversations.length,
            data: formattedConversations
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Get messages in a conversation
 * @route   GET /api/messages/conversation/:conversationId
 * @access  Private
 */
const getMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user._id;
        const { page = 1, limit = 50 } = req.query;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({
                success: false,
                error: 'Conversation not found'
            });
        }

        const isParticipant = conversation.participants.some(
            p => p.toString() === userId.toString()
        );

        if (!isParticipant) {
            return res.status(403).json({
                success: false,
                error: 'Not authorized to view this conversation'
            });
        }

        const skip = (page - 1) * limit;
        const total = await Message.countDocuments({ conversationId });

        const messages = await Message.find({ conversationId })
            .populate('senderId', 'email profile')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        res.json({
            success: true,
            count: messages.length,
            total,
            page: parseInt(page),
            pages: Math.ceil(total / limit),
            data: messages.reverse()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Mark messages as read
 * @route   PUT /api/messages/:conversationId/read
 * @access  Private
 */
const markAsRead = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const userId = req.user._id;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({
                success: false,
                error: 'Conversation not found'
            });
        }

        await Message.updateMany(
            { 
                conversationId, 
                senderId: { $ne: userId },
                isRead: false 
            },
            { isRead: true }
        );

        conversation.unreadCount.set(userId.toString(), 0);
        await conversation.save();

        res.json({
            success: true,
            message: 'Messages marked as read'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Delete a message
 * @route   DELETE /api/messages/:id
 * @access  Private
 */
const deleteMessage = async (req, res) => {
    try {
        const message = await Message.findById(req.params.id);

        if (!message) {
            return res.status(404).json({
                success: false,
                error: 'Message not found'
            });
        }

        if (message.senderId.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                error: 'Not authorized to delete this message'
            });
        }

        await message.deleteOne();

        const conversation = await Conversation.findById(message.conversationId);
        if (conversation && conversation.lastMessage === message.message) {
            const lastMessage = await Message.findOne({ 
                conversationId: message.conversationId 
            })
                .sort({ createdAt: -1 });

            if (lastMessage) {
                conversation.lastMessage = lastMessage.message;
                conversation.lastMessageAt = lastMessage.createdAt;
            } else {
                conversation.lastMessage = '';
                conversation.lastMessageAt = null;
            }
            await conversation.save();
        }

        res.json({
            success: true,
            message: 'Message deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Get total unread message count
 * @route   GET /api/messages/unread/count
 * @access  Private
 */
const getUnreadCount = async (req, res) => {
    try {
        const userId = req.user._id;

        const conversations = await Conversation.find({
            participants: userId
        });

        let totalUnread = 0;
        conversations.forEach(conv => {
            totalUnread += conv.unreadCount.get(userId.toString()) || 0;
        });

        res.json({
            success: true,
            data: {
                unreadCount: totalUnread
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

/**
 * @desc    Get conversation by participant ID
 * @route   GET /api/messages/conversation/user/:userId
 * @access  Private
 */
const getConversationByUser = async (req, res) => {
    try {
        const currentUserId = req.user._id;
        const { userId } = req.params;

        const conversation = await Conversation.findOne({
            participants: { $all: [currentUserId, userId] }
        }).populate('participants', 'email profile');

        if (!conversation) {
            return res.status(404).json({
                success: false,
                error: 'Conversation not found'
            });
        }

        const otherParticipant = conversation.participants.find(
            p => p._id.toString() !== currentUserId.toString()
        );

        res.json({
            success: true,
            data: {
                _id: conversation._id,
                participant: otherParticipant,
                lastMessage: conversation.lastMessage,
                lastMessageAt: conversation.lastMessageAt,
                unreadCount: conversation.unreadCount.get(currentUserId.toString()) || 0
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
};

module.exports = {
    sendMessage,
    getConversations,
    getMessages,
    markAsRead,
    deleteMessage,
    getUnreadCount,
    getConversationByUser
};
