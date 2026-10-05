# HR Task Management Backend - Claude.md

## Project Overview

HR Management System backend API viết bằng Node.js + Express + MongoDB, hỗ trợ real-time qua Socket.IO.

### Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js |
| Framework | Express.js 5.x |
| Database | MongoDB (Mongoose 8.x) |
| Auth | JWT + OTP |
| Real-time | Socket.IO 4.x |
| File Upload | Multer + Cloudinary |
| Email | Nodemailer |
| Validation | express-validator |
| Utilities | bcryptjs, date-fns, axios |

### Modules chính

- **Auth** - Đăng ký, đăng nhập, OTP reset password
- **Users** - Quản lý profile, phân quyền (HR Manager / Team Lead / Employee)
- **Teams** - Quản lý team với leader và members
- **Tasks** - CRUD task, subtasks, comments, attachments, progress tracking
- **Leaves** - Đơn nghỉ phép với approve/reject workflow
- **Attendance** - Chấm công với GPS location
- **Messages** - Real-time chat qua Socket.IO
- **Notifications** - Thông báo real-time

---

## Architecture

```
server/
├── config/           # Configuration (database, jwt)
├── controllers/      # Request handlers (routes → controller → response)
├── middleware/       # Auth, error handling, file upload, validation
├── models/          # Mongoose schemas
├── routes/          # Express route definitions
├── services/        # Business logic layer
├── utils/           # Helper functions, constants
├── validators/      # Input validation rules (express-validator)
├── migrations/      # Database migrations & index definitions
├── uploads/         # Uploaded files (gitignored)
├── server.js        # Application entry point
└── .env             # Environment variables
```

### Request Flow

```
HTTP Request
    ↓
Routes (router)
    ↓
Middleware (auth, validation)
    ↓
Controller (request handling)
    ↓
Service (business logic)
    ↓
Model (Mongoose → MongoDB)
    ↓
Response
```

### Role-based Access Control

| Role | Permissions |
|------|-------------|
| `hr_manager` | Full access, quản lý tất cả teams/users |
| `team_lead` | Quản lý team của mình, tạo/giao task |
| `employee` | Xem task được giao, chấm công, xin nghỉ phép |

---

## Code Standards

### Naming Conventions

```javascript
// Variables & Functions: camelCase
const userId = '...';
function getUserById() {}

// Classes/Promoted Schemas: PascalCase
const UserSchema = new mongoose.Schema({});
class UserService {}

// Constants: SCREAMING_SNAKE_CASE
const MAX_RETRY_ATTEMPTS = 5;

// Files: camelCase hoặc kebab-case
// - controllers: taskController.js
// - models: user.model.js hoặc User.js
// - utils: dateHelper.js

// Routes: kebab-case trong URL
// /api/tasks/my-tasks
// /api/attendance/clock-in
```

### Response Format

Luôn trả về consistent JSON structure:

```javascript
// Success
res.status(200).json({
  success: true,
  data: { ... },
  message: 'Operation successful' // optional
});

// Error
res.status(400).json({
  success: false,
  error: 'Error message here'
});

// Paginated response
res.json({
  success: true,
  count: 10,
  total: 100,
  page: 1,
  pages: 10,
  data: [...]
});
```

### Error Handling

```javascript
// Controller - always wrap in try-catch
const getUser = async (req, res) => {
  try {
    const user = await userService.getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Error codes
400 - Bad Request (validation failed)
401 - Unauthorized (no/invalid token)
403 - Forbidden (no permission)
404 - Not Found
429 - Too Many Requests (rate limit)
500 - Internal Server Error

// Validation errors (format từ validateRequest middleware)
{
  success: false,
  error: 'Validation failed',
  errors: [
    { field: 'email', message: 'Invalid email format' },
    { field: 'password', message: 'Password must be at least 6 characters' }
  ]
}
```

### Async/Await Patterns

```javascript
// ✅ CORRECT - always await
const user = await User.findById(id);

// ❌ WRONG - don't leave promises unhandled
User.findById(id).then(...); // unless for fire-and-forget

// ✅ CORRECT - parallel queries when possible
const [user, tasks] = await Promise.all([
  User.findById(id),
  Task.find({ assignedTo: id })
]);
```

### Database Operations

```javascript
// ✅ Use lean() for read-only queries (better performance)
const users = await User.find(query).lean();

// ✅ Use select() to limit fields
const user = await User.findById(id).select('email profile.fullName');

// ✅ Use pagination
const skip = (page - 1) * limit;
const users = await User.find(query).skip(skip).limit(limit);
```

---

## Database Indexes

Xem chi tiết: [migrations/INDEXES_DOCUMENTATION.md](migrations/INDEXES_DOCUMENTATION.md)

### Quick Reference

```javascript
// Key indexes đã được thêm vào models:
Task:     { assignedTo, teamId, status, dueDate }
User:     { teamId, role, isActive }
Attendance: { userId + date }
Leave:    { userId + status, startDate }
Notification: { userId + isRead }
```

### Run Migration

```bash
# Tạo indexes
node migrations/001_add_performance_indexes.js up

# Kiểm tra indexes
node migrations/001_add_performance_indexes.js status

# Rollback
node migrations/001_add_performance_indexes.js down
```

---

## Input Validation

Xem chi tiết: [VALIDATION_DOCUMENTATION.md](VALIDATION_DOCUMENTATION.md)

### Validation Pattern

```javascript
// 1. Import validators
const { registerValidation } = require('../validators');
const { validateRequest } = require('../middleware/validateRequest');

// 2. Add to route
router.post('/register', registerValidation, validateRequest, register);
```

### Error Response Format

```json
{
  "success": false,
  "error": "Validation failed",
  "errors": [
    { "field": "email", "message": "Invalid email format" }
  ]
}
```

### Validation Files

| File | Mô tả |
|------|--------|
| `validators/auth.validators.js` | Auth validation rules |
| `validators/user.validators.js` | User validation rules |
| `validators/task.validators.js` | Task validation rules |
| `validators/leave.validators.js` | Leave validation rules |
| `validators/attendance.validators.js` | Attendance validation rules |
| `validators/notification.validators.js` | Notification validation rules |
| `validators/message.validators.js` | Message validation rules |

---

## Scripts & Commands

### Development

```bash
# Install dependencies
npm install

# Run development server (with hot reload)
npm run dev

# Run production server
npm start

# Seed database (if exists)
npm run seed
```

### Testing

```bash
# Run tests
npm test

# TODO: Add test scripts
# npm run test:unit
# npm run test:integration
# npm run test:coverage
```

### Database

```bash
# MongoDB shell - kết nối local
mongosh mongodb://127.0.0.1:27017/tma_demo

# Kiểm tra indexes
db.tasks.getIndexes()

# Explain query
db.tasks.find({ assignedTo: ObjectId("...") }).explain("executionStats")
```

---

## Environment Variables

Tạo file `.env` (xem `.env.example`):

```env
# Server
PORT=3000
NODE_ENV=development

# Database
MONGO_URL=mongodb://127.0.0.1:27017/tma_demo

# JWT
JWT_SECRET=your_secret_key_here
JWT_EXPIRE=7d

# Client URL (for CORS)
CLIENT_URL=*

# Optional: Email (Nodemailer)
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=user@example.com
EMAIL_PASS=password

# Optional: Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

---

## API Endpoints

### Authentication
- `POST /api/auth/register` - Đăng ký
- `POST /api/auth/login` - Đăng nhập
- `POST /api/auth/forgot-password` - Quên mật khẩu (gửi OTP)
- `POST /api/auth/verify-otp` - Xác thực OTP
- `POST /api/auth/reset-password` - Reset mật khẩu
- `GET /api/auth/me` - Lấy thông tin user hiện tại
- `PUT /api/auth/profile` - Cập nhật profile

### Tasks
- `POST /api/tasks` - Tạo task (Team Lead, HR)
- `GET /api/tasks` - Danh sách tasks
- `GET /api/tasks/my` - Tasks của tôi
- `GET /api/tasks/:id` - Chi tiết task
- `PUT /api/tasks/:id` - Cập nhật task
- `DELETE /api/tasks/:id` - Xóa task (soft delete)
- `POST /api/tasks/:id/assign` - Giao task
- `PUT /api/tasks/:id/status` - Cập nhật status
- `POST /api/tasks/:id/comments` - Thêm comment
- `POST /api/tasks/:id/subtasks` - Thêm subtask

### Teams
- `POST /api/teams` - Tạo team
- `GET /api/teams` - Danh sách teams
- `GET /api/teams/:id` - Chi tiết team
- `PUT /api/teams/:id` - Cập nhật team
- `DELETE /api/teams/:id` - Xóa team
- `POST /api/teams/:id/members` - Thêm thành viên
- `DELETE /api/teams/:id/members/:userId` - Xóa thành viên

### Attendance
- `POST /api/attendance/clock-in` - Check-in
- `PUT /api/attendance/clock-out` - Check-out
- `GET /api/attendance/my` - Lịch sử chấm công
- `GET /api/attendance/stats` - Thống kê chấm công

### Leaves
- `POST /api/leaves` - Tạo đơn nghỉ phép
- `GET /api/leaves/my` - Đơn của tôi
- `GET /api/leaves` - Danh sách đơn (HR)
- `PUT /api/leaves/:id/approve` - Phê duyệt
- `PUT /api/leaves/:id/reject` - Từ chối

### Messages (WebSocket)
- Real-time chat qua Socket.IO
- Events: `send_message`, `new_message`, `typing_start`, `typing_stop`

---

## Development Workflow

### 1. Feature Development

```bash
# Tạo branch mới
git checkout -b feature/task-api-improvements

# Code...

# Commit
git add .
git commit -m "feat: add pagination to task API"

# Push
git push origin feature/task-api-improvements
```

### 2. Code Review Checklist

- [ ] Code follows naming conventions
- [ ] Error handling is complete
- [ ] Input validation is implemented
- [ ] Response format is consistent
- [ ] Indexes added for new queries
- [ ] Tests added (TODO: when test suite exists)

### 3. Before Merging

```bash
# Pull latest
git checkout main
git pull origin main

# Merge feature branch
git merge feature/task-api-improvements

# Resolve conflicts if any

# Push
git push origin main
```

---

## Socket.IO Events

### Client → Server

```javascript
// Gửi message
socket.emit('send_message', {
  receiverId: 'user_id',
  message: 'Hello!',
  conversationId: null // or existing conversation ID
});

// Join/leave conversation
socket.emit('join_conversation', conversationId);
socket.emit('leave_conversation', conversationId);

// Typing indicator
socket.emit('typing_start', { conversationId, receiverId });
socket.emit('typing_stop', { conversationId, receiverId });
```

### Server → Client

```javascript
// Message received
socket.on('new_message', (data) => { ... });

// Notification
socket.on('message_notification', (data) => { ... });

// Online status
socket.on('user_online', (data) => { ... });
socket.on('user_offline', (data) => { ... });

// Typing
socket.on('user_typing', (data) => { ... });
```

---

## TODO / Technical Debt

### High Priority
- [ ] Add unit tests (Jest)
- [x] Add input validation middleware (express-validator) ✅ DONE
- [ ] Add rate limiting
- [ ] Create API documentation (Swagger)

### Medium Priority
- [ ] Extract duplicate code (enrichTask helper)
- [ ] Add Redis caching for statistics
- [ ] Implement structured logging (winston/pino)
- [ ] Add request ID tracing

### Low Priority
- [ ] Add README for frontend integration
- [ ] Create Docker configuration
- [ ] Setup CI/CD pipeline

---

## Troubleshooting

### MongoDB Connection Issues

```bash
# Check if MongoDB is running
mongosh --eval "db.adminCommand('ping')"

# Restart MongoDB service (Windows)
net stop MongoDB && net start MongoDB
```

### Port Already in Use

```bash
# Find process using port 3000
netstat -ano | findstr :3000

# Kill process
taskkill /PID <pid_number> /F
```

### Clear Node_modules Issues

```bash
# Clear cache
npm cache clean --force

# Reinstall
rm -rf node_modules
npm install
```

---

## Resources

- [Express.js Documentation](https://expressjs.com/)
- [Mongoose Documentation](https://mongoosejs.com/)
- [Socket.IO Documentation](https://socket.io/docs/)
- [MongoDB Index Documentation](https://docs.mongodb.com/manual/indexes/)
