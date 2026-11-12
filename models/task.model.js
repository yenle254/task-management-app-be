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
    from: { type: String, enum: ['todo', 'in_progress', 'in_review', 'done', 'deleted'], default: null },
    to: { type: String, enum: ['todo', 'in_progress', 'in_review', 'done', 'deleted'], required: true },
    at: { type: Date, default: Date.now },
    // The user who performed the transition, when known.
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Snapshot of the ownership at the time of the transition, so a historical
    // completion stays attributed to the team and assignees that held it then,
    // even if the task is later reassigned.
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    dueDate: { type: Date, default: null }
}, { _id: false });

const ChecklistItemSchema = new mongoose.Schema({
    text: { type: String, required: true, trim: true, maxlength: 500 },
    isCompleted: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});
const ChecklistSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true, maxlength: 255 },
    items: { type: [ChecklistItemSchema], default: [] },
    createdAt: { type: Date, default: Date.now }
});
const TimeEntrySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    minutes: { type: Number, required: true, min: 1, max: 1440, validate: Number.isInteger },
    note: { type: String, default: '', trim: true, maxlength: 500 },
    loggedAt: { type: Date, default: Date.now }
});

const ReviewEventSchema = new mongoose.Schema({
    round: { type: Number, required: true },
    type: { type: String, enum: ['submitted', 'approved', 'changes_requested', 'withdrawn', 'reassigned', 'cancelled'], required: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    at: { type: Date, default: Date.now },
    note: { type: String, maxlength: 500, default: '' },
    reason: { type: String, maxlength: 1000, default: '' }
}, { _id: false });
const TaskSchema = new mongoose.Schema({
    review: {
        submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        submittedAt: { type: Date, default: null },
        note: { type: String, maxlength: 500, default: '' },
        currentRound: { type: Number, default: 0 },
        remindedAt: { type: Date, default: null },
        approverSnapshot: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            role: { type: String, enum: ['team_lead', 'hr_manager'] }, resolvedAt: Date, active: Boolean }],
        rounds: { type: [ReviewEventSchema], default: [] }
    },
    parentTaskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },
    checklists: { type: [ChecklistSchema], default: [] },
    dependencies: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }], default: [], validate: v => v.length <= 20 },
    watchers: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [], validate: v => v.length <= 50 },
    estimatedMinutes: { type: Number, default: null, min: 0, max: 100000, validate: v => v == null || Number.isInteger(v) },
    storyPoints: { type: Number, default: null, min: 0 },
    timeEntries: { type: [TimeEntrySchema], default: [] },
    actualMinutes: { type: Number, default: 0, min: 0 },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['todo', 'in_progress', 'in_review', 'done', 'deleted'], default: 'todo', index: true },
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
    // Durable deletion intent is saved atomically with removal of metadata.
    // Storage errors can be retried without losing the filename or attachment ID.
    pendingAttachmentDeletes: { type: [AttachmentSchema], default: [] },
    comments: [CommentSchema],
    subTasks: [SubTaskSchema],
    tags: [String],
}, {
    timestamps: true,
    collection: 'tasks',
    toJSON: { transform: (_doc, ret) => { delete ret.pendingAttachmentDeletes; return ret; } },
    toObject: { transform: (_doc, ret) => { delete ret.pendingAttachmentDeletes; return ret; } }
});

TaskSchema.index({ assignedTo: 1, status: 1 });
TaskSchema.index({ 'attachments.filename': 1 });
TaskSchema.index({ 'pendingAttachmentDeletes.filename': 1 });
TaskSchema.index({ teamId: 1, status: 1 });
TaskSchema.index({ status: 1, dueDate: 1 });
TaskSchema.index({ assignedTo: 1, status: 1, dueDate: 1 });
TaskSchema.index({ 'statusHistory.at': 1 });
TaskSchema.index({ parentTaskId: 1 });
TaskSchema.index({ dependencies: 1 });
TaskSchema.index({ watchers: 1 });
TaskSchema.index({ 'review.approverSnapshot.userId': 1, status: 1 });
TaskSchema.index({ status: 1, 'review.remindedAt': 1, 'review.submittedAt': 1 });
TaskSchema.index({ dueDate: 1, startDate: 1 });


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


TaskSchema.pre('save', async function(next) {
    try {
        await require('../services/task-write-lock.service').journalTaskSave(this);
        const advanced = require('../services/task-advanced.service');
        const requestedStatus = this.status;
        const persistedStatus = this.$locals.previousStatus ?? this.$locals.loadedStatus ?? this.statusHistory.at(-1)?.to;
        if (this.status === 'done' && persistedStatus !== 'done' && !this.$locals.reviewApproved) {
            throw advanced.fail('Task must be submitted for review before it can be completed');
        }
        if (this.status === 'deleted' || this.$locals.previousStatus === 'deleted') {
            this.status = 'deleted';
        } else if (this.subTasks && this.subTasks.length > 0) {
            const completedCount = this.subTasks.filter(st => st.isCompleted).length;
            const totalSubtasks = this.subTasks.length;
            advanced.recalculateProgress(this);

            if (completedCount === totalSubtasks) {
                if (!['done', 'in_review'].includes(this.status)) this.status = 'in_progress';
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
        }

        advanced.syncActualMinutes(this);
        if (this.status === 'done') {
            const completion = await advanced.canCompleteTask(this);
            if (!completion.ok) {
                if (requestedStatus === 'done') throw advanced.fail(completion.error);
                // Completing embedded work is allowed while blocked, but never
                // bypasses dependency/child checks to record a false completion.
                this.status = 'in_progress';
            }
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

        const initialSave = this.isNew && !lastEntry &&
            this.$locals.previousStatus === undefined &&
            this.$locals.loadedStatus === undefined;

        if (initialSave || (this.isModified('status') && previousStatus !== this.status)) {
            this.statusHistory.push({
                from: initialSave ? null : previousStatus,
                to: this.status,
                at: initialSave ? (this.createdAt || new Date()) : new Date(),
                by: this.$locals.statusChangedBy || null,
                teamId: this.teamId || null,
                assignedTo: this.assignedTo || [],
                dueDate: this.dueDate || null
            });

            // Advance the recorded previous status so the same transition is never
            // appended twice, even if the hook runs again before the next change.
            this.$locals.previousStatus = this.status;
        }

        this.$locals.reviewApproved = false;
        next();
    } catch (error) { next(error); }
});

TaskSchema.post('save', async function(task) {
    if (task.parentTaskId) {
        await require('../services/task-advanced.service').syncParentTask(task.parentTaskId, task.$locals.statusChangedBy);
    }
});

module.exports = mongoose.model('Task', TaskSchema);
