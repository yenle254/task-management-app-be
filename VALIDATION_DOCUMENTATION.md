# Input Validation Documentation

## Overview

Project sử dụng `express-validator` để validate input cho tất cả API endpoints. Validation được tách riêng vào thư mục `validators/` và được áp dụng ở routes layer.

## Files Structure

```
server/
├── middleware/
│   └── validateRequest.js       # Middleware xử lý validation errors
├── validators/
│   ├── index.js                # Central export
│   ├── auth.validators.js       # Auth validation rules
│   ├── user.validators.js       # User validation rules
│   ├── task.validators.js       # Task validation rules
│   ├── leave.validators.js      # Leave validation rules
│   ├── attendance.validators.js # Attendance validation rules
│   ├── notification.validators.js # Notification validation rules
│   └── message.validators.js    # Message validation rules
└── routes/
    ├── auth.js                 # Updated với validation
    ├── user.js
    ├── task.js
    ├── leave.js
    ├── attendance.js
    ├── notification.js
    └── message.js
```

## Validation Flow

```
Request → Validation Chain → validateRequest Middleware → Controller
                     ↓
              Nếu có lỗi → 400 Bad Request
```

## Usage Pattern

```javascript
// 1. Import validators
const { registerValidation } = require('../validators');
const { validateRequest } = require('../middleware/validateRequest');

// 2. Add to route
router.post('/register', registerValidation, validateRequest, register);
```

## Error Response Format

Khi validation fail, API trả về:

```json
{
  "success": false,
  "error": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format",
      "value": "invalid-email"
    }
  ]
}
```

---

## Validation Rules by Module

### Auth Module

#### POST /api/auth/register
| Field | Rules |
|-------|-------|
| `email` | Required, valid email format, max 255 chars, unique |
| `password` | Required, min 6, max 128 characters |
| `role` | Optional, one of: `hr_manager`, `team_lead`, `employee` |
| `profile.fullName` | Required, min 3, max 100 characters |
| `profile.employeeId` | Required, max 50 characters |
| `profile.department` | Optional, max 100 characters |
| `profile.position` | Optional, max 100 characters |
| `profile.phone` | Optional, matches phone pattern |

#### POST /api/auth/login
| Field | Rules |
|-------|-------|
| `email` | Required, valid email format |
| `password` | Required |

#### POST /api/auth/forgot-password
| Field | Rules |
|-------|-------|
| `email` | Required, valid email format |

#### POST /api/auth/verify-otp
| Field | Rules |
|-------|-------|
| `email` | Required, valid email format |
| `otp` | Required, 6 digits, numeric only |

#### POST /api/auth/reset-password
| Field | Rules |
|-------|-------|
| `email` | Required, valid email format |
| `resetToken` | Required |
| `newPassword` | Required, min 6, max 128 characters |

#### PUT /api/auth/password (Change password)
| Field | Rules |
|-------|-------|
| `oldPassword` | Required |
| `newPassword` | Required, min 6, max 128, different from old |

#### PUT /api/auth/profile
| Field | Rules |
|-------|-------|
| `fullName` | Optional, min 3, max 100 |
| `department` | Optional, max 100 |
| `position` | Optional, max 100 |
| `phone` | Optional, valid phone format |
| `avatar` | Optional, valid URL |

---

### User Module

#### GET /api/users
| Param | Rules |
|-------|-------|
| `page` | Optional, integer ≥ 1 |
| `limit` | Optional, integer 1-100 |
| `search` | Optional, max 100 |
| `role` | Optional, one of: `hr_manager`, `team_lead`, `employee` |
| `department` | Optional, max 100 |

#### GET /api/users/:id
| Param | Rules |
|-------|-------|
| `id` | Required, valid MongoDB ObjectId |

#### PUT /api/users/:id
| Field | Rules |
|-------|-------|
| `email` | Optional, valid email, unique |
| `role` | Optional, one of: `hr_manager`, `team_lead`, `employee` |
| `teamId` | Optional, valid ObjectId |
| `managerId` | Optional, valid ObjectId |
| `isActive` | Optional, boolean |
| `profile.fullName` | Optional, min 3, max 100 |
| `profile.department` | Optional, max 100 |
| `profile.position` | Optional, max 100 |
| `profile.phone` | Optional, valid phone format |

#### GET /api/users/team/:teamId
| Param | Rules |
|-------|-------|
| `teamId` | Required, valid MongoDB ObjectId |

---

### Task Module

#### POST /api/tasks
| Field | Rules |
|-------|-------|
| `title` | Required, min 3, max 255 |
| `description` | Optional, max 5000 |
| `assignedTo` | Required, array, at least 1, valid user IDs |
| `teamId` | Required, valid ObjectId, team must exist |
| `priority` | Optional, one of: `low`, `medium`, `high` |
| `difficulty` | Optional, one of: `easy`, `medium`, `hard` |
| `startDate` | Optional, valid ISO8601 date |
| `dueDate` | Optional, valid ISO8601, ≥ startDate |
| `tags` | Optional, array of strings, each max 50 |

#### PUT /api/tasks/:id
| Field | Rules |
|-------|-------|
| `title` | Optional, min 3, max 255 |
| `description` | Optional, max 5000 |
| `priority` | Optional, one of: `low`, `medium`, `high` |
| `startDate` | Optional, valid ISO8601 |
| `dueDate` | Optional, valid ISO8601 |
| `tags` | Optional, array |

#### POST /api/tasks/:id/assign
| Field | Rules |
|-------|-------|
| `assignedTo` | Required, array, at least 1, valid user IDs |

#### PUT /api/tasks/:id/status
| Field | Rules |
|-------|-------|
| `status` | Required, one of: `todo`, `in_progress`, `done` |

#### PUT /api/tasks/:id/progress
| Field | Rules |
|-------|-------|
| `progress` | Required, integer 0-100 |

#### POST /api/tasks/:id/comments
| Field | Rules |
|-------|-------|
| `text` | Required, min 1, max 2000 |

#### POST /api/tasks/:id/subtasks
| Field | Rules |
|-------|-------|
| `title` | Required, min 1, max 255 |

#### PATCH /api/tasks/:id/subtasks/:subtaskId
| Field | Rules |
|-------|-------|
| `title` | Optional, min 1, max 255 |
| `isCompleted` | Optional, boolean |

#### GET /api/tasks
| Param | Rules |
|-------|-------|
| `page` | Optional, integer ≥ 1 |
| `limit` | Optional, integer 1-100 |
| `status` | Optional, one of: `todo`, `in_progress`, `done` |
| `priority` | Optional, one of: `low`, `medium`, `high` |
| `search` | Optional, max 100 |

#### GET /api/tasks/team/:teamId
| Param | Rules |
|-------|-------|
| `teamId` | Required, valid ObjectId |
| `status` | Optional |

#### GET /api/tasks/overdue
| Param | Rules |
|-------|-------|
| `forTeam` | Optional, boolean |

---

### Leave Module

#### POST /api/leaves
| Field | Rules |
|-------|-------|
| `type` | Required, one of: `sick`, `vacation`, `personal` |
| `startDate` | Required, ISO8601, ≥ today |
| `endDate` | Required, ISO8601, ≥ startDate |
| `reason` | Optional, max 500 characters |

#### GET /api/leaves
| Param | Rules |
|-------|-------|
| `status` | Optional, one of: `pending`, `approved`, `rejected` |
| `type` | Optional, one of: `sick`, `vacation`, `personal` |
| `year` | Optional, integer 2000-2100 |
| `page` | Optional, integer ≥ 1 |
| `limit` | Optional, integer 1-100 |

#### GET /api/leaves/balance
| Param | Rules |
|-------|-------|
| `year` | Optional, integer 2000-2100 |

#### PUT /api/leaves/:id/reject
| Field | Rules |
|-------|-------|
| `rejectionReason` | Optional, max 500 characters |

#### GET /api/leaves/team/:teamId
| Param | Rules |
|-------|-------|
| `teamId` | Required, valid ObjectId |
| `status` | Optional |
| `month` | Optional, integer 1-12 |
| `year` | Optional, integer 2000-2100 |

---

### Attendance Module

#### POST /api/attendance/clockin
| Field | Rules |
|-------|-------|
| `lat` | Required, float -90 to 90 |
| `lng` | Required, float -180 to 180 |

#### GET /api/attendance/my
| Param | Rules |
|-------|-------|
| `startDate` | Optional, ISO8601 |
| `endDate` | Optional, ISO8601, ≥ startDate |
| `page` | Optional, integer ≥ 1 |
| `limit` | Optional, integer 1-100 |

#### PUT /api/attendance/:id
| Field | Rules |
|-------|-------|
| `clockIn` | Optional, ISO8601 |
| `clockOut` | Optional, ISO8601 |
| `status` | Optional, one of: `present`, `late`, `absent` |
| `workHours` | Optional, float 0-24 |
| `location.lat` | Optional, float -90 to 90 |
| `location.lng` | Optional, float -180 to 180 |

---

### Notification Module

#### GET /api/notifications
| Param | Rules |
|-------|-------|
| `page` | Optional, integer ≥ 1 |
| `limit` | Optional, integer 1-100 |
| `unreadOnly` | Optional, boolean |

#### GET /api/notifications/type/:type
| Param | Rules |
|-------|-------|
| `type` | Required, one of valid notification types |
| `page` | Optional, integer ≥ 1 |
| `limit` | Optional, integer 1-100 |

---

### Message Module

#### POST /api/messages
| Field | Rules |
|-------|-------|
| `receiverId` | Required, valid ObjectId |
| `message` | Optional, max 5000 |
| `attachments` | Optional, array |
| `conversationId` | Optional, valid ObjectId |

#### GET /api/messages/conversation/:conversationId
| Param | Rules |
|-------|-------|
| `conversationId` | Required, valid ObjectId |
| `page` | Optional, integer ≥ 1 |
| `limit` | Optional, integer 1-100 |

#### GET /api/messages/conversation/user/:userId
| Param | Rules |
|-------|-------|
| `userId` | Required, valid ObjectId |

---

## Custom Validators

### Email Uniqueness
```javascript
// Kiểm tra email chưa tồn tại trong DB
.custom(async (email) => {
  const user = await User.findOne({ email });
  if (user) throw new Error('Email already exists');
})
```

### Date Range Validation
```javascript
// endDate phải >= startDate
.custom((value, { req }) => {
  if (new Date(value) < new Date(req.body.startDate)) {
    throw new Error('End date must be after start date');
  }
})
```

### Future Date Validation
```javascript
// startDate không được là quá khứ
.custom((value) => {
  const date = new Date(value);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date < today) {
    throw new Error('Start date cannot be in the past');
  }
})
```

### ObjectId Validation
```javascript
// Kiểm tra MongoDB ObjectId hợp lệ
.custom((value) => {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new Error('Invalid ID format');
  }
})
```

---

## TODO

- [ ] Thêm unit tests cho validators
- [ ] Thêm integration tests cho API endpoints
- [ ] Thêm rate limiting
