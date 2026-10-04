/**
 * Migration: 001_add_performance_indexes.js
 * Purpose: Add performance indexes for all collections based on query analysis
 * Date: 2024
 *
 * Run with: node migrations/001_add_performance_indexes.js
 * Or use with mongoose-migrate or similar tools
 */

const mongoose = require('mongoose');

// Load models
const User = require('../models/User');
const Task = require('../models/Task');
const Team = require('../models/Team');
const Attendance = require('../models/Attendance');
const Leave = require('../models/Leave');
const Notification = require('../models/Notification');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const MIGRATION_NAME = '001_add_performance_indexes';

/**
 * Helper function to create index only if it doesn't exist
 * Uses try-catch to handle duplicate key errors gracefully
 */
async function createIndexSafe(model, indexSpec, options = {}) {
    const collectionName = model.collection.name;
    const indexName = Object.keys(indexSpec).join('_');

    try {
        const existingIndexes = await model.collection.indexes();
        const indexExists = existingIndexes.some(idx => {
            const idxKey = Object.keys(idx.key).join('_');
            return idxKey === indexName && idx.key[Object.keys(indexSpec)[0]] === Object.values(indexSpec)[0];
        });

        if (indexExists) {
            console.log(`  ⏭️  Index already exists: ${collectionName}.${indexName}`);
            return false;
        }

        await model.collection.createIndex(indexSpec, {
            ...options,
            background: true // Always build in background to avoid locking
        });
        console.log(`  ✅ Created index: ${collectionName}.${indexName}`);
        return true;
    } catch (error) {
        if (error.code === 85 || error.code === 86) {
            // Index already exists with different options (code 85) or duplicate (code 86)
            console.log(`  ⏭️  Index already exists: ${collectionName}.${indexName}`);
            return false;
        }
        console.error(`  ❌ Error creating index ${collectionName}.${indexName}:`, error.message);
        throw error;
    }
}

/**
 * Run all migrations
 */
async function up() {
    console.log(`\n🚀 Starting migration: ${MIGRATION_NAME}`);
    console.log('=' .repeat(60));

    let indexesCreated = 0;

    try {
        // ========================================
        // TASKS COLLECTION - HIGH PRIORITY
        // ========================================
        console.log('\n📦 Tasks Collection:');

        // Single column indexes
        await createIndexSafe(Task, { assignedTo: 1 });
        await createIndexSafe(Task, { teamId: 1 });
        await createIndexSafe(Task, { status: 1 });
        await createIndexSafe(Task, { assignedBy: 1 });
        await createIndexSafe(Task, { dueDate: 1 });
        await createIndexSafe(Task, { createdAt: -1 });

        // Composite indexes - most common query patterns
        await createIndexSafe(Task, { assignedTo: 1, status: 1 });           // getMyTasks
        await createIndexSafe(Task, { teamId: 1, status: 1 });             // getTeamTasks, getAllTasks
        await createIndexSafe(Task, { status: 1, dueDate: 1 });             // overdue tasks
        await createIndexSafe(Task, { assignedTo: 1, status: 1, dueDate: 1 }); // overdue + filter

        indexesCreated++;

        // ========================================
        // USERS COLLECTION - MEDIUM PRIORITY
        // ========================================
        console.log('\n📦 Users Collection:');

        await createIndexSafe(User, { teamId: 1 });
        await createIndexSafe(User, { role: 1 });
        await createIndexSafe(User, { isActive: 1 });
        await createIndexSafe(User, { role: 1, isActive: 1 });  // getAvailableLeaders
        await createIndexSafe(User, { role: 1, teamId: 1 });   // find team lead of team
        await createIndexSafe(User, { teamId: 1, isActive: 1 }); // getUsersByTeam

        // ========================================
        // ATTENDANCE COLLECTION - HIGH PRIORITY
        // ========================================
        console.log('\n📦 Attendance Collection:');

        await createIndexSafe(Attendance, { userId: 1 });
        await createIndexSafe(Attendance, { date: 1 });
        await createIndexSafe(Attendance, { userId: 1, date: 1 });  // Clock-in check, stats
        await createIndexSafe(Attendance, { userId: 1, date: -1 }); // My attendance history

        // ========================================
        // LEAVES COLLECTION - HIGH PRIORITY
        // ========================================
        console.log('\n📦 Leaves Collection:');

        await createIndexSafe(Leave, { userId: 1 });
        await createIndexSafe(Leave, { status: 1 });
        await createIndexSafe(Leave, { userId: 1, status: 1 });    // getMyLeaves, getPendingLeaves
        await createIndexSafe(Leave, { userId: 1, startDate: 1 }); // Year filter
        await createIndexSafe(Leave, { status: 1, createdAt: -1 }); // Sort pending
        await createIndexSafe(Leave, { startDate: 1 });             // Date range queries

        // ========================================
        // NOTIFICATIONS COLLECTION - HIGH PRIORITY
        // ========================================
        console.log('\n📦 Notifications Collection:');

        await createIndexSafe(Notification, { userId: 1 });
        await createIndexSafe(Notification, { userId: 1, isRead: 1 });   // Unread count, filter
        await createIndexSafe(Notification, { userId: 1, createdAt: -1 }); // Paginate
        await createIndexSafe(Notification, { userId: 1, type: 1 });     // Filter by type

        // ========================================
        // CONVERSATIONS COLLECTION - MEDIUM PRIORITY
        // ========================================
        console.log('\n📦 Conversations Collection:');

        await createIndexSafe(Conversation, { participants: 1 });
        await createIndexSafe(Conversation, { participants: 1, lastMessageAt: -1 }); // Get conversations sorted

        // ========================================
        // MESSAGES COLLECTION - MEDIUM PRIORITY
        // ========================================
        console.log('\n📦 Messages Collection:');

        await createIndexSafe(Message, { conversationId: 1 });
        await createIndexSafe(Message, { conversationId: 1, createdAt: -1 }); // Get messages sorted

        // ========================================
        // TEAMS COLLECTION - LOW PRIORITY
        // ========================================
        console.log('\n📦 Teams Collection:');

        await createIndexSafe(Team, { leaderId: 1 });
        await createIndexSafe(Team, { name: 1 }, { unique: true }); // Team name should be unique

        console.log('\n' + '=' .repeat(60));
        console.log(`✅ Migration ${MIGRATION_NAME} completed successfully!`);
        console.log('=' .repeat(60) + '\n');

    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        throw error;
    }
}

/**
 * Rollback migration (remove indexes)
 */
async function down() {
    console.log(`\n🔄 Rolling back migration: ${MIGRATION_NAME}`);
    console.log('=' .repeat(60));

    const indexesToRemove = [
        // Tasks
        { model: Task, name: 'assignedTo_1' },
        { model: Task, name: 'teamId_1' },
        { model: Task, name: 'status_1' },
        { model: Task, name: 'assignedBy_1' },
        { model: Task, name: 'dueDate_1' },
        { model: Task, name: 'createdAt_-1' },
        { model: Task, name: 'assignedTo_1_status_1' },
        { model: Task, name: 'teamId_1_status_1' },
        { model: Task, name: 'status_1_dueDate_1' },
        { model: Task, name: 'assignedTo_1_status_1_dueDate_1' },

        // Users
        { model: User, name: 'teamId_1' },
        { model: User, name: 'role_1' },
        { model: User, name: 'isActive_1' },
        { model: User, name: 'role_1_isActive_1' },
        { model: User, name: 'role_1_teamId_1' },
        { model: User, name: 'teamId_1_isActive_1' },

        // Attendance
        { model: Attendance, name: 'userId_1' },
        { model: Attendance, name: 'date_1' },
        { model: Attendance, name: 'userId_1_date_1' },
        { model: Attendance, name: 'userId_1_date_-1' },

        // Leave
        { model: Leave, name: 'userId_1' },
        { model: Leave, name: 'status_1' },
        { model: Leave, name: 'userId_1_status_1' },
        { model: Leave, name: 'userId_1_startDate_1' },
        { model: Leave, name: 'status_1_createdAt_-1' },
        { model: Leave, name: 'startDate_1' },

        // Notification
        { model: Notification, name: 'userId_1' },
        { model: Notification, name: 'userId_1_isRead_1' },
        { model: Notification, name: 'userId_1_createdAt_-1' },
        { model: Notification, name: 'userId_1_type_1' },

        // Conversation
        { model: Conversation, name: 'participants_1' },
        { model: Conversation, name: 'participants_1_lastMessageAt_-1' },

        // Message
        { model: Message, name: 'conversationId_1' },
        { model: Message, name: 'conversationId_1_createdAt_-1' },

        // Team
        { model: Team, name: 'leaderId_1' },
        { model: Team, name: 'name_1' },
    ];

    for (const { model, name } of indexesToRemove) {
        try {
            await model.collection.dropIndex(name);
            console.log(`  🗑️  Dropped index: ${model.collection.name}.${name}`);
        } catch (error) {
            if (error.code === 27) {
                console.log(`  ⏭️  Index not found: ${model.collection.name}.${name}`);
            } else {
                console.error(`  ⚠️  Error dropping index ${name}:`, error.message);
            }
        }
    }

    console.log('\n' + '=' .repeat(60));
    console.log(`✅ Rollback completed!`);
    console.log('=' .repeat(60) + '\n');
}

/**
 * Show current indexes
 */
async function status() {
    console.log(`\n📊 Current indexes for ${MIGRATION_NAME}:`);
    console.log('=' .repeat(60));

    const models = [User, Task, Team, Attendance, Leave, Notification, Conversation, Message];

    for (const model of models) {
        try {
            const indexes = await model.collection.indexes();
            console.log(`\n📦 ${model.collection.name}:`);
            indexes.forEach(idx => {
                const keyStr = JSON.stringify(idx.key);
                const unique = idx.unique ? ' (UNIQUE)' : '';
                console.log(`   - ${Object.keys(idx.key).join(', ')} ${unique}`);
            });
        } catch (error) {
            console.log(`  ⚠️  Error getting indexes: ${error.message}`);
        }
    }

    console.log('\n' + '=' .repeat(60) + '\n');
}

// Main execution
async function main() {
    const command = process.argv[2] || 'up';

    // Connect to MongoDB
    const mongoUrl = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/tma_demo';

    try {
        await mongoose.connect(mongoUrl);
        console.log(`📡 Connected to MongoDB: ${mongoUrl}`);

        switch (command) {
            case 'up':
                await up();
                break;
            case 'down':
                await down();
                break;
            case 'status':
                await status();
                break;
            default:
                console.log('Usage: node migrations/001_add_performance_indexes.js [up|down|status]');
        }

        await mongoose.connection.close();
        console.log('🔌 Disconnected from MongoDB');
        process.exit(0);

    } catch (error) {
        console.error('❌ Migration error:', error);
        await mongoose.connection.close();
        process.exit(1);
    }
}

main();
