const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const cors = require("cors");
const connectDB = require("./config/database");
const errorHandler = require("./middleware/errorHandler");

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
    },
  });
});

// Import routes
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/user");
const teamRoutes = require("./routes/team");
const taskRoutes = require("./routes/task");
const leaveRoutes = require("./routes/leave");
const attendanceRoutes = require("./routes/attendance");
const notificationRoutes = require("./routes/notification");
const messageRoutes = require("./routes/message");
const uploadRoutes = require("./routes/upload");
const statisticsRoutes = require("./routes/statistics");

// Mount routes
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/teams", teamRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api/statistics", statisticsRoutes);

app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
});

app.use(errorHandler);

const socketHandler = require("./utils/socketHandler");
socketHandler(io);

const PORT = process.env.PORT;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Socket.IO is ready`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
});
