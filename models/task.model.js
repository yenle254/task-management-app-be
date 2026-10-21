const mongoose = require('mongoose');

const AttachmentSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true },
    filename: { type: String, required: true },
    type: { type: String, required: true },
}, { _id: true });

const CommentSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
}, { _id: true });

const SubTaskSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    isCompleted: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
}, { _id: true });

const StatusHistorySchema = new mongoose.Schema({
    from: { type: String, enum: ['todo', 'in_progress', 'done', 'deleted'], default: null },
    to: { type: String, enum: ['todo', 'in_progress', 'done', 'deleted'], required: true },
    at: { type: Date, default: Date.now },
    // The user who performed the transition, when known.
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Snapshot of the ownership at the time of the transition, so a historical
    // completion stays attributed to the team and assignees that held it then,
    // even if the task is later reassigned.
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
}, { _id: false });

const TaskSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['todo', 'in_progress', 'done', 'deleted'], default: 'todo', index: true },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true }],
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    startDate: { type: Date, },
    dueDate: { type: Date, index: true },
    completedAt: { type: Date, default: null, index: true }, // Track actual completion time
    // Every status transition is appended here, so a task that is completed,
    // reopened and completed again keeps both completion events.
    statusHistory: { type: [StatusHistorySchema], default: [] },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    attachments: [AttachmentSchema],
    comments: [CommentSchema],
    subTasks: [SubTaskSchema],
    tags: [String],
}, {
    timestamps: true,
    collection: 'tasks',
    // Composite indexes for common query patterns
    indexes: [
        { assignedTo: 1, status: 1 },                    // getMyTasks
        { teamId: 1, status: 1 },                      // getTeamTasks
        { status: 1, dueDate: 1 },                     // overdue tasks
        { assignedTo: 1, status: 1, dueDate: 1 },      // overdue + user filter
        { teamId: 1, completedAt: 1 }                  // team performance by completion
    ]
});


/**
 * Capture the status the document was loaded with.
 *
 * Mongoose does not expose the persisted value of a modified path during
 * `pre('save')`, so the original status is captured here — the `init` hook
 * runs once when a document is loaded from the database, before any
 * controller changes it.
 */
TaskSchema.pre('init', function (doc) {
    this.$locals.loadedStatus = doc.status;
});


TaskSchema.pre('save', function(next) {
    if (this.subTasks && this.subTasks.length > 0) {
        const completedCount = this.subTasks.filter(st => st.isCompleted).length;
        const totalSubtasks = this.subTasks.length;
        this.progress = Math.round((completedCount / totalSubtasks) * 100);

        if (completedCount === totalSubtasks) {
            this.status = 'done';
        } else if (completedCount > 0) {
            if (this.status === 'done') {
                this.status = 'in_progress';
            } else if (this.status === 'todo') {
                this.status = 'in_progress';
            }
        } else {
            if (this.status === 'done') {
                this.status = 'todo';
            }
        }
    } else {
        this.progress = 0;
    }

    // Track completion time.
    //
    // `completedAt` reflects the CURRENT state: it is set when the task
    // reaches 'done' and cleared when the task is reopened. A task that is
    // completed, reopened and completed again therefore keeps the latest
    // completion timestamp here, while `statusHistory` retains every
    // individual completion event.
    if (this.isModified('status')) {
        if (this.status === 'done' && !this.completedAt) {
            this.completedAt = new Date();
        } else if (this.status !== 'done' && this.completedAt) {
            this.completedAt = null;
        }
    }

    // Append a history entry for the transition, exactly once per transition.
    //
    // The previous status is resolved in this order:
    //  1. `$locals.previousStatus` — set by a controller that changed the
    //     status explicitly and knows the old value.
    //  2. `$locals.loadedStatus` — the status the document was loaded with,
    //     captured by the `init` hook. This covers the subtask recalculation
    //     path, where the transition is derived inside the hook.
    //  3. The last recorded history entry — for documents that were already
    //     carrying history.
    //
    // Whichever path changed the status, exactly one history entry is
    // appended per transition.
    const lastEntry = this.statusHistory[this.statusHistory.length - 1];
    const previousStatus =
        this.$locals.previousStatus !== undefined
            ? this.$locals.previousStatus
            : this.$locals.loadedStatus !== undefined
                ? this.$locals.loadedStatus
                : lastEntry
                    ? lastEntry.to
                    : 'todo';

    if (this.isModified('status') && previousStatus !== this.status) {
        this.statusHistory.push({
            from: previousStatus,
            to: this.status,
            at: new Date(),
            by: this.$locals.statusChangedBy || null,
            teamId: this.teamId || null,
            assignedTo: this.assignedTo || []
        });

        // Advance the recorded previous status so the same transition is never
        // appended twice, even if the hook runs again before the next change.
        this.$locals.previousStatus = this.status;
    }

    next();
});

module.exports = mongoose.model('Task', TaskSchema);