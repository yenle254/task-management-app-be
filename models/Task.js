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

const TaskSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['todo', 'in_progress', 'done', 'deleted'], default: 'todo' },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    assignedTo: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true },
    startDate: { type: Date, },
    dueDate: { type: Date, },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    attachments: [AttachmentSchema],
    comments: [CommentSchema],
    subTasks: [SubTaskSchema],
    tags: [String],
}, { timestamps: true, collection: 'tasks' });


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
    next();
});

module.exports = mongoose.model('Task', TaskSchema);