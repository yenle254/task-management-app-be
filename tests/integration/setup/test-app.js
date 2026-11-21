const express = require('express');
const requestId = require('../../../middleware/request-id.middleware');
const sanitizeServerError = require('../../../middleware/sanitize-server-error.middleware');
const { securityHeaders, permissionsPolicy } = require('../../../config/security.config');
const sanitizeInput = require('../../../middleware/sanitize.middleware');
const errorHandler = require('../../../middleware/error-handler.middleware');

const emailService = require('../../../services/email.service');
const expoPushService = require('../../../services/expo-push.service');

// Replace sendResetPasswordEmail on emailService BEFORE requiring controllers/routes
// because auth.controller.js destructures { sendResetPasswordEmail } at require time.
const sharedSentEmails = [];
const sharedSentPushes = [];

emailService.sendResetPasswordEmail = async (email, otp, fullName) => {
  sharedSentEmails.push({ email, otp, fullName, sentAt: new Date() });
  return { success: true, messageId: `test-email-${sharedSentEmails.length}` };
};

expoPushService.send = async (payload) => {
  sharedSentPushes.push(payload);
};

const authRoutes = require('../../../routes/auth.routes');
const taskRoutes = require('../../../routes/task.routes');
const aiRoutes = require('../../../chat_bot/routes/ai.routes');

/**
 * Create a lightweight Socket.IO server stub that records room emissions and
 * disconnections without opening network ports.
 */
function createSocketStub() {
  const emitted = [];
  const disconnectedRooms = [];
  const io = {
    emitted,
    disconnectedRooms,
    to(room) {
      return {
        emit(event, payload) {
          emitted.push({ room: String(room), event, payload });
        },
      };
    },
    in(room) {
      return {
        disconnectSockets(close) {
          disconnectedRooms.push({ room: String(room), close: Boolean(close) });
        },
      };
    },
  };
  return io;
}

/**
 * Build an Express application matching server.js middleware and routes
 * while stubbing external email and push network calls.
 */
function createTestApp() {
  const sentEmails = sharedSentEmails;
  const sentPushes = sharedSentPushes;

  const app = express();
  const io = createSocketStub();

  app.disable('x-powered-by');
  app.use(requestId);
  app.use(sanitizeServerError);
  app.use(securityHeaders());
  app.use(permissionsPolicy);
  app.set('query parser', 'simple');
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(sanitizeInput);
  app.set('io', io);

  app.use('/api/auth', authRoutes);
  app.use('/api/tasks', taskRoutes);
  app.use('/api/ai', aiRoutes);

  app.use((_req, res) => {
    res.status(404).json({
      success: false,
      error: 'Route not found',
    });
  });

  app.use(errorHandler);

  return {
    app,
    io,
    sentEmails,
    sentPushes,
    clearOutbox() {
      sentEmails.length = 0;
      sentPushes.length = 0;
      io.emitted.length = 0;
      io.disconnectedRooms.length = 0;
    },
  };
}

module.exports = {
  createTestApp,
  createSocketStub,
};
