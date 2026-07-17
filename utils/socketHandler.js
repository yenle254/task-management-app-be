const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');

const onlineUsers = new Map();

const socketHandler = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      
      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', (socket) => {
    //console.log(`User connected: ${socket.user.email} (${socket.id})`);
 
    onlineUsers.set(socket.user._id.toString(), socket.id);
    io.emit('user_online', { 
      userId: socket.user._id.toString(),
      email: socket.user.email 
    });

    socket.join(socket.user._id.toString());
    socket.emit('online_users', Array.from(onlineUsers.keys()));

    socket.on('join_conversation', (conversationId) => {
      socket.join(`conversation_${conversationId}`);
      //console.log(`User ${socket.user.email} joined conversation ${conversationId}`);
    });


    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conversation_${conversationId}`);
      //console.log(`User ${socket.user.email} left conversation ${conversationId}`);
    });


    socket.on('send_message', async (data) => {
      try {
        const { receiverId, message, attachments, conversationId, tempId } = data;
        const senderId = socket.user._id;

        console.log('Received send_message:', {
          receiverId,
          message,
          attachments,
          conversationId,
          tempId
        });

        let conversation;
        if (conversationId) {
          conversation = await Conversation.findById(conversationId);
        } else {
          conversation = await Conversation.findOne({
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
        }

        const newMessage = await Message.create({
          conversationId: conversation._id,
          senderId,
          message,
          attachments: attachments || [],
          isRead: false
        });

        console.log('Created message:', {
          _id: newMessage._id,
          message: newMessage.message,
          attachments: newMessage.attachments
        });

        conversation.lastMessage = message;
        conversation.lastMessageAt = new Date();
        
        const currentUnread = conversation.unreadCount.get(receiverId.toString()) || 0;
        conversation.unreadCount.set(receiverId.toString(), currentUnread + 1);
        
        await conversation.save();

        await newMessage.populate('senderId', 'email profile');

        io.to(`conversation_${conversation._id}`).emit('new_message', {
          message: newMessage,
          conversationId: conversation._id,
          tempId: tempId
        });

        io.to(receiverId.toString()).emit('message_notification', {
          conversationId: conversation._id,
          senderId: senderId.toString(),
          senderName: socket.user.profile?.fullName || socket.user.email,
          message: message,
          timestamp: newMessage.createdAt
        });

        socket.emit('message_sent', {
          tempId: tempId,
          message: newMessage,
          conversationId: conversation._id
        });

      } catch (error) {
        console.error('Send message error:', error);
        socket.emit('message_error', {
          tempId: data.tempId,
          error: error.message
        });
      }
    });

    socket.on('typing_start', (data) => {
      const { conversationId, receiverId } = data;
      io.to(receiverId.toString()).emit('user_typing', {
        conversationId,
        userId: socket.user._id.toString(),
        userName: socket.user.profile?.fullName || socket.user.email
      });
    });

    socket.on('typing_stop', (data) => {
      const { conversationId, receiverId } = data;
      io.to(receiverId.toString()).emit('user_stop_typing', {
        conversationId,
        userId: socket.user._id.toString()
      });
    });

    socket.on('mark_as_read', async (data) => {
      try {
        const { conversationId } = data;
        const userId = socket.user._id;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          return socket.emit('error', { message: 'Conversation not found' });
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

        const otherParticipants = conversation.participants.filter(
          p => p.toString() !== userId.toString()
        );

        otherParticipants.forEach(participantId => {
          io.to(participantId.toString()).emit('messages_read', {
            conversationId,
            readBy: userId.toString()
          });
        });

      } catch (error) {
        console.error('Mark as read error:', error);
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('disconnect', () => {
      //console.log(`User disconnected: ${socket.user.email} (${socket.id})`);
      
      onlineUsers.delete(socket.user._id.toString());
      
      io.emit('user_offline', { 
        userId: socket.user._id.toString(),
        email: socket.user.email 
      });
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });
};

module.exports = socketHandler;

