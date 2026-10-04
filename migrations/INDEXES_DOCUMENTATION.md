# MongoDB Indexes - Technical Documentation

## Overview

This document describes the database indexes added to improve query performance for the HR Management System.

## Files Created

| File | Description |
|------|-------------|
| `migrations/001_add_performance_indexes.js` | Migration script with up/down commands |
| `migrations/INDEXES_REFERENCE.js` | Quick reference and MongoDB shell commands |
| `models/indexes.js` | Programmatic index management utilities |
| `models/*.js` | Updated with inline index definitions |

---

## Index Summary by Collection

### 🔴 HIGH PRIORITY (Impact: Major Performance Gains)

#### Tasks Collection (10 indexes)

| # | Index | Type | Purpose | Query Optimized |
|---|-------|------|---------|-----------------|
| 1 | `{ assignedTo: 1 }` | Single | WHERE assignedTo | `getMyTasks`, `getOverdueTasks` |
| 2 | `{ teamId: 1 }` | Single | WHERE teamId | `getTeamTasks`, `getAllTasks` |
| 3 | `{ status: 1 }` | Single | Filter deleted tasks | All task queries |
| 4 | `{ assignedTo: 1, status: 1 }` | Composite | User + status filter | `getMyTasks` |
| 5 | `{ teamId: 1, status: 1 }` | Composite | Team + status filter | `getTeamTasks` |
| 6 | `{ status: 1, dueDate: 1 }` | Composite | Overdue query | `getOverdueTasks` |
| 7 | `{ assignedTo: 1, status: 1, dueDate: 1 }` | Composite | Complex overdue filter | Overdue + user |
| 8 | `{ dueDate: 1 }` | Single | Sort by due date | Task listings |
| 9 | `{ assignedBy: 1 }` | Single | Creator lookup | Task audit |
| 10 | `{ createdAt: -1 }` | Single | Sort newest first | Default sort |

**Write Penalty:** LOW - These fields are rarely updated; indexes add minimal overhead.

---

#### Attendance Collection (4 indexes)

| # | Index | Type | Purpose | Query Optimized |
|---|-------|------|---------|-----------------|
| 1 | `{ userId: 1 }` | Single | User attendance history | `getMyAttendance` |
| 2 | `{ date: 1 }` | Single | Date range queries | `getAllAttendance` |
| 3 | `{ userId: 1, date: 1 }` | Composite | Daily clock-in check | `clockIn`, `clockOut` |
| 4 | `{ userId: 1, date: -1 }` | Composite | User history DESC | `getMyAttendance` |

**Write Penalty:** LOW - Attendance records are written once per day.

---

#### Leave Collection (6 indexes)

| # | Index | Type | Purpose | Query Optimized |
|---|-------|------|---------|-----------------|
| 1 | `{ userId: 1 }` | Single | User leave history | `getMyLeaves` |
| 2 | `{ status: 1 }` | Single | Filter by status | `getPendingLeaves` |
| 3 | `{ userId: 1, status: 1 }` | Composite | User + status | `getMyLeaves`, `getPendingLeaves` |
| 4 | `{ userId: 1, startDate: 1 }` | Composite | Year filter | `getLeaveBalance` |
| 5 | `{ status: 1, createdAt: -1 }` | Composite | Sort pending | `getPendingLeaves` |
| 6 | `{ startDate: 1 }` | Single | Date range | Team leaves |

**Write Penalty:** LOW - Leave requests are created/updated infrequently.

---

#### Notifications Collection (4 indexes)

| # | Index | Type | Purpose | Query Optimized |
|---|-------|------|---------|-----------------|
| 1 | `{ userId: 1 }` | Single | User notifications | `getMyNotifications` |
| 2 | `{ userId: 1, isRead: 1 }` | Composite | Unread count | Badge count |
| 3 | `{ userId: 1, createdAt: -1 }` | Composite | Paginate | All notification queries |
| 4 | `{ userId: 1, type: 1 }` | Composite | Filter by type | `getNotificationsByType` |

**Write Penalty:** LOW - Notifications are write-heavy but simple.

---

### 🟡 MEDIUM PRIORITY (Impact: Moderate Performance Gains)

#### Users Collection (6 indexes)

| # | Index | Type | Purpose | Query Optimized |
|---|-------|------|---------|-----------------|
| 1 | `{ teamId: 1 }` | Single | Team members lookup | `getUsersByTeam` |
| 2 | `{ role: 1 }` | Single | Find by role | HR/Team Lead queries |
| 3 | `{ isActive: 1 }` | Single | Filter active | `getAllUsers` |
| 4 | `{ role: 1, isActive: 1 }` | Composite | Active leaders | `getAvailableLeaders` |
| 5 | `{ role: 1, teamId: 1 }` | Composite | Team lead lookup | `canApproveLeave` |
| 6 | `{ teamId: 1, isActive: 1 }` | Composite | Active team members | `getUsersByTeam` |

**Write Penalty:** LOW - User updates are infrequent.

---

#### Conversations Collection (2 indexes)

| # | Index | Type | Purpose | Query Optimized |
|---|-------|------|---------|-----------------|
| 1 | `{ participants: 1 }` | Single | Find conversation | `sendMessage` |
| 2 | `{ participants: 1, lastMessageAt: -1 }` | Composite | Sorted list | `getConversations` |

**Write Penalty:** LOW - Updated on new message only.

---

#### Messages Collection (2 indexes)

| # | Index | Type | Purpose | Query Optimized |
|---|-------|------|---------|-----------------|
| 1 | `{ conversationId: 1 }` | Single | Message history | `getMessages` |
| 2 | `{ conversationId: 1, createdAt: -1 }` | Composite | Sorted messages | `getMessages` |

**Write Penalty:** LOW - Append-only pattern.

---

#### Teams Collection (2 indexes)

| # | Index | Type | Purpose | Query Optimized |
|---|-------|------|---------|-----------------|
| 1 | `{ leaderId: 1 }` | Single | Find by leader | `ensureLeaderEligible` |
| 2 | `{ name: 1 }` | Unique | Name uniqueness | `createTeam` |

**Write Penalty:** NONE - Unique constraint prevents duplicates.

---

## How Indexes Improve Performance

### Before Indexes
```javascript
// getMyTasks - O(n) full collection scan
db.tasks.find({ assignedTo: ObjectId("..."), status: { $ne: 'deleted' } })

// With 10,000 tasks: scans all 10,000 documents
```

### After Indexes
```javascript
// getMyTasks - O(log n) index lookup
db.tasks.find({ assignedTo: ObjectId("..."), status: { $ne: 'deleted' } })
       .hint({ assignedTo: 1, status: 1 })

// With 10,000 tasks: scans ~14 index entries (log₂10000 ≈ 14)
```

### Performance Improvement Estimation

| Operation | Without Index | With Index | Improvement |
|-----------|--------------|------------|-------------|
| Simple lookup (10K docs) | ~50ms | ~2ms | **25x faster** |
| Range query (10K docs) | ~80ms | ~5ms | **16x faster** |
| Join + filter (10K docs) | ~200ms | ~20ms | **10x faster** |
| Pagination (10K docs) | ~100ms | ~10ms | **10x faster** |

---

## Running the Migration

### Option 1: Migration Script (Recommended)
```bash
# Run migration
node migrations/001_add_performance_indexes.js up

# Check status
node migrations/001_add_performance_indexes.js status

# Rollback (if needed)
node migrations/001_add_performance_indexes.js down
```

### Option 2: MongoDB Shell
```javascript
// Connect to database
use tma_demo;

// Run index creation commands from INDEXES_REFERENCE.js
db.tasks.createIndex({ assignedTo: 1 });
db.tasks.createIndex({ teamId: 1 });
// ... etc
```

### Option 3: Automatic (On Server Start)
```javascript
// In server.js or after connectDB()
const { createAllIndexes } = require('./models/indexes');
await createAllIndexes();
```

---

## Monitoring Index Performance

### Check index usage:
```javascript
// MongoDB shell
db.tasks.find({ assignedTo: ObjectId("...") }).explain("executionStats")
```

### Key metrics to watch:
- `totalKeysExamined` - Number of index entries scanned
- `totalDocsExamined` - Number of documents scanned
- `executionTimeMillis` - Query execution time
- `indexName` - Which index was used

### Common issues:
1. **Index not used** - Check query shape matches index fields
2. **Collection scan** - Missing index for query pattern
3. **Index too large** - Too many indexes, consider dropping unused ones

---

## Index Maintenance

### View all indexes:
```javascript
db.collection.getIndexes()
```

### Drop unused index:
```javascript
db.tasks.dropIndex("index_name")
```

### Check index size:
```javascript
db.collection.stats().indexSizes
```

---

## Rollback Plan

If indexes cause issues:

1. **Immediate rollback:**
```bash
node migrations/001_add_performance_indexes.js down
```

2. **Selective removal:** Drop specific problematic indexes via MongoDB shell.

3. **Model rollback:** Remove index definitions from model files.

---

## Notes

- MongoDB automatically creates indexes for `unique: true` fields
- Composite index order matters: put high-selectivity fields first
- Indexes are built in background by default (non-blocking)
- `background: true` prevents locking during index creation
