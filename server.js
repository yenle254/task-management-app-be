const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/database");
const errorHandler = require("./middleware/error-handler.middleware");
const { generalLimiter } = require("./middleware/rate-limit.middleware");

dotenv.config();
const path = require("path");
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

connectDB();

app.use(
  cors({
    origin: process.env.CLIENT_URL || "*",
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set("io", io);

if (process.env.NODE_ENV === "development") {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
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

// Mount routes with general rate limiting (skip for /api/auth which uses strict limiter)
app.use("/api/auth", authRoutes);
app.use("/api/users", generalLimiter, userRoutes);
app.use("/api/teams", generalLimiter, teamRoutes);
app.use("/api/tasks", generalLimiter, taskRoutes);
app.use("/api/leaves", generalLimiter, leaveRoutes);
app.use("/api/attendance", generalLimiter, attendanceRoutes);
app.use("/api/notifications", generalLimiter, notificationRoutes);
app.use("/api/messages", generalLimiter, messageRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/offices", generalLimiter, officeRoutes);
app.use("/api/statistics", generalLimiter, statisticsRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
});

app.use(errorHandler);

const socketHandler = require("./utils/socket-handler.utils");
socketHandler(io);

const PORT = process.env.PORT;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Socket.IO is ready`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});
