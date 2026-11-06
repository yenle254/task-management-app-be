/**
 * AI Copilot Configuration & Structured Output Schemas
 */
const AI_CONFIG = {
  PROVIDER: (process.env.AI_PROVIDER || 'auto').toLowerCase(),
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
  OLLAMA_TIMEOUT_MS: Number(process.env.OLLAMA_TIMEOUT_MS) || 25000,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || ''
};

const ASSISTANT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    suggestedQuestions: {
      type: 'array',
      items: { type: 'string' }
    },
    proposedAction: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['NONE', 'LOG_TIME', 'CREATE_LEAVE', 'CREATE_TASK_DRAFT']
        },
        summary: { type: 'string' },
        payload: {
          type: 'object',
          properties: {
            taskId: { type: 'string' },
            taskTitle: { type: 'string' },
            minutes: { type: 'number' },
            note: { type: 'string' },
            type: { type: 'string' },
            startDate: { type: 'string' },
            endDate: { type: 'string' },
            reason: { type: 'string' },
            assigneeId: { type: 'string' },
            assigneeName: { type: 'string' },
            difficulty: { type: 'string' },
            priority: { type: 'string' }
          }
        }
      },
      required: ['type']
    }
  },
  required: ['reply', 'suggestedQuestions']
};

const TASK_BREAKDOWN_SCHEMA = {
  type: 'object',
  properties: {
    difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
    priority: { type: 'string', enum: ['low', 'medium', 'high'] },
    estimatedMinutes: { type: 'integer' },
    storyPoints: { type: 'integer' },
    tags: { type: 'array', items: { type: 'string' } },
    subTasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' }
        },
        required: ['title']
      }
    },
    checklist: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } }
      },
      required: ['title', 'items']
    },
    reasoning: { type: 'string' }
  },
  required: [
    'difficulty',
    'priority',
    'estimatedMinutes',
    'storyPoints',
    'tags',
    'subTasks',
    'checklist'
  ]
};

const TASK_SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    statusAnalysis: { type: 'string' },
    blockers: { type: 'array', items: { type: 'string' } },
    recentActivitySummary: { type: 'string' },
    nextSteps: { type: 'array', items: { type: 'string' } }
  },
  required: ['headline', 'statusAnalysis', 'blockers', 'recentActivitySummary', 'nextSteps']
};

module.exports = {
  AI_CONFIG,
  ASSISTANT_RESPONSE_SCHEMA,
  TASK_BREAKDOWN_SCHEMA,
  TASK_SUMMARY_SCHEMA
};

