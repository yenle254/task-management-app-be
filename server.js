let runtime;
try {
  runtime = require('./config/runtime.config').loadRuntimeConfig();
} catch (error) {
  console.error(`Startup configuration invalid: ${error.message}`);
  process.exit(1);
}

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const connectDB = require("./config/database");
const mongoose = require('mongoose');
const { createHealthService } = require('./services/health.service');
const { createHealthRouter } = require('./routes/health.routes');
const { createServerLifecycle } = require('./services/server-lifecycle.service');
const errorHandler = require("./middleware/error-handler.middleware");
const { generalLimiter } = require("./middleware/rate-limit.middleware");
const requestId = require("./middleware/request-id.middleware");
const requestLogger = require("./middleware/request-logger.middleware");
const sanitizeServerError = require("./middleware/sanitize-server-error.middleware");
const logger = require("./utils/logger.utils");

const { httpCorsOptions, socketCorsOptions, allowSocketRequest } = runtime.cors;
const { securityHeaders, permissionsPolicy } = require('./config/security.config');
const sanitizeInput = require('./middleware/sanitize.middleware');
const app = express();
app.set('trust proxy', runtime.trustProxy);
const server = http.createServer(app);

const io = new Server(server, { cors: socketCorsOptions, allowRequest: allowSocketRequest });

const health = createHealthService({ connection: mongoose.connection, timeoutMs: runtime.healthcheckTimeoutMs });

// Request ID must be registered before any other middleware so all requests
// (including 404s, parser errors, and global error handler) have a requestId.
app.use(requestId);
// Public probes precede auth, business rate limits, CORS and 5xx sanitization.
app.use('/health', createHealthRouter(health));
app.use(sanitizeServerError);
app.use((_req, res, next) => {
  if (health.isStopping()) {
    res.set('Connection', 'close');
    return res.status(503).json({ success: false, error: 'Service not ready' });
  }
  next();
});

app.use(requestLogger);
app.use(securityHeaders());
app.use(permissionsPolicy);
app.use(cors(httpCorsOptions));
app.set('query parser', 'simple'); // Never interpret bracketed input as Mongo operators.
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(sanitizeInput);
app.set("io", io);

if (process.env.NODE_ENV === "development") {
  app.use((req, res, next) => {
    logger.debug("HTTP request received", {
      requestId: req.requestId,
      method: req.method,
      route: req.path,
    });
    next();
  });
}
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "HR Task Management API",
    version: "1.0.0",
    endpoints: {
      auth: "/api/auth",
      users: "/api/users",
      teams: "/api/teams",
      tasks: "/api/tasks",
      leaves: "/api/leaves",
      attendance: "/api/attendance",
      notifications: "/api/notifications",
      messages: "/api/messages",
      offices: "/api/offices",
    },
  });
});

// Import routes
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/user.routes");
const teamRoutes = require("./routes/team.routes");
const taskRoutes = require("./routes/task.routes");
const leaveRoutes = require("./routes/leave.routes");
const attendanceRoutes = require("./routes/attendance.routes");
const notificationRoutes = require("./routes/notification.routes");
const messageRoutes = require("./routes/message.routes");
const uploadRoutes = require("./routes/upload.routes");
const statisticsRoutes = require("./routes/statistics.routes");
const officeRoutes = require("./routes/office.routes");
const adminRoutes = require("./routes/admin.routes");
const employeeRoutes = require("./routes/employee.routes");
const aiRoutes = require("./chat_bot/routes/ai.routes");

// Mount routes with general rate limiting (skip for /api/auth which uses strict limiter)
app.use("/api/auth", authRoutes);
app.use("/api/users", generalLimiter, userRoutes);
app.use("/api/teams", generalLimiter, teamRoutes);
app.use("/api/tasks", generalLimiter, taskRoutes);
app.use("/api/leaves", generalLimiter, leaveRoutes);
app.use("/api/attendance", generalLimiter, attendanceRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/messages", generalLimiter, messageRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/offices", generalLimiter, officeRoutes);
app.use("/api/statistics", generalLimiter, statisticsRoutes);
app.use("/api/employees", generalLimiter, employeeRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ai", generalLimiter, aiRoutes);
const { setupSwagger } = require("./config/swagger.config");
const fileRoutes = require('./routes/file.routes');
app.use('/uploads', fileRoutes);
app.use('/api/files', fileRoutes);
setupSwagger(app);

app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
});


app.use(errorHandler);

const socketHandler = require("./utils/socket-handler.utils");
const stopSockets = socketHandler(io);
const notificationService = require('./services/notification.service');
const reminderScheduler = require('./services/reminder-scheduler.service');
notificationService.initDelivery(io);
const lifecycle = createServerLifecycle({ server, io, health, stopSockets,
  stopScheduler: () => reminderScheduler.stop(), disconnectDatabase: () => mongoose.disconnect(),
  flushAudit: () => require('./services/audit.service').flush(),
  timeoutMs: runtime.shutdownTimeoutMs, logger });
connectDB().then(() => {
  if (health.isStopping()) return;
  reminderScheduler.start(io);
  health.markStarted();
}).catch(() => {
  logger.error('Database startup failed');
  void lifecycle.shutdown('database_startup_failed', 1);
});
server.on('error', () => {
  logger.error('HTTP server failed');
  void lifecycle.shutdown('http_server_error', 1);
});

server.listen(runtime.port, runtime.host, () => {
  logger.info("Server started", { port: runtime.port, host: runtime.host });
  logger.info("Socket.IO is ready");
  logger.info("Environment", { env: process.env.NODE_ENV || "development" });
});
