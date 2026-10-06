/**
 * =====================================================
 * MONGOOSE INDEX DEFINITIONS
 * =====================================================
 *
 * These index definitions can be added to each model to enable
 * automatic index creation when the application starts.
 *
 * To enable: Import and call these functions after connecting to DB:
 *   const { createAllIndexes } = require('./models/indexes');
 *   await createAllIndexes();
 */

const Task = require('./task.model');
const User = require('./user.model');
const Team = require('./team.model');
const Attendance = require('./attendance.model');
const Leave = require('./leave.model');
const Notification = require('./notification.model');
const Conversation = require('./conversation.model');
const Message = require('./message.model');

/**
 * Create all recommended indexes
 * Call this after mongoose.connect()
 */
async function createAllIndexes() {
    console.log('🔧 Creating database indexes...');
    const startTime = Date.now();
    let count = 0;

    try {
        // Task indexes
        await Task.createIndexes();
        count += await Task.collection.indexes().then(idx => idx.length);
        console.log('  ✅ Task indexes created');

        // User indexes
        await User.createIndexes();
        count += await User.collection.indexes().then(idx => idx.length);
        console.log('  ✅ User indexes created');

        // Team indexes
        await Team.createIndexes();
        count += await Team.collection.indexes().then(idx => idx.length);
        console.log('  ✅ Team indexes created');

        // Attendance indexes
        await Attendance.createIndexes();
        count += await Attendance.collection.indexes().then(idx => idx.length);
        console.log('  ✅ Attendance indexes created');

        // Leave indexes
        await Leave.createIndexes();
        count += await Leave.collection.indexes().then(idx => idx.length);
        console.log('  ✅ Leave indexes created');

        // Notification indexes
        await Notification.createIndexes();
        count += await Notification.collection.indexes().then(idx => idx.length);
        console.log('  ✅ Notification indexes created');

        // Conversation indexes
        await Conversation.createIndexes();
        count += await Conversation.collection.indexes().then(idx => idx.length);
        console.log('  ✅ Conversation indexes created');

        // Message indexes
        await Message.createIndexes();
        count += await Message.collection.indexes().then(idx => idx.length);
        console.log('  ✅ Message indexes created');

        const elapsed = Date.now() - startTime;
        console.log(`\n✅ All indexes created in ${elapsed}ms\n`);

        return count;
    } catch (error) {
        console.error('❌ Error creating indexes:', error);
        throw error;
    }
}

/**
 * Drop all custom indexes (for testing/reset)
 */
async function dropAllIndexes() {
    console.log('🗑️  Dropping all custom indexes...');

    const models = [Task, User, Team, Attendance, Leave, Notification, Conversation, Message];

    for (const model of models) {
        try {
            const indexes = await model.collection.indexes();
            for (const idx of indexes) {
                // Don't drop _id index
                if (idx.name !== '_id_') {
                    try {
                        await model.collection.dropIndex(idx.name);
                        console.log(`  🗑️  Dropped: ${model.collection.name}.${idx.name}`);
                    } catch (e) {
                        // Index might not exist or can't be dropped
                    }
                }
            }
        } catch (error) {
            console.error(`  ⚠️  Error with ${model.collection.name}:`, error.message);
        }
    }

    console.log('✅ Index cleanup complete\n');
}

/**
 * Show current indexes for all collections
 */
async function showIndexes() {
    console.log('\n📊 Current Database Indexes:');
    console.log('=' .repeat(70));

    const models = [
        { name: 'Tasks', model: Task },
        { name: 'Users', model: User },
        { name: 'Teams', model: Team },
        { name: 'Attendances', model: Attendance },
        { name: 'Leaves', model: Leave },
        { name: 'Notifications', model: Notification },
        { name: 'Conversations', model: Conversation },
        { name: 'Messages', model: Message }
    ];

    for (const { name, model } of models) {
        try {
            const indexes = await model.collection.indexes();
            console.log(`\n📦 ${name}:`);
            indexes.forEach(idx => {
                const unique = idx.unique ? ' [UNIQUE]' : '';
                const key = JSON.stringify(idx.key).replace(/"/g, '');
                console.log(`   ${idx.name}: ${key}${unique}`);
            });
        } catch (error) {
            console.log(`  ⚠️  Error: ${error.message}`);
        }
    }

    console.log('\n' + '=' .repeat(70) + '\n');
}

module.exports = {
    createAllIndexes,
    dropAllIndexes,
    showIndexes
};
