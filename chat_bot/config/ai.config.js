/**
 * AI Copilot Configuration, Configurable Suitability Weights, Cache & Calibration Settings
 */
const num = (envVal, fallback) => {
  const parsed = Number(envVal);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const AI_CONFIG = {
  PROVIDER: (process.env.AI_PROVIDER || 'auto').toLowerCase(),
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
  OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'qwen2.5:3b',
  OLLAMA_TIMEOUT_MS: num(process.env.OLLAMA_TIMEOUT_MS, 25000),
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',

  // 0.1 Query ceiling for manager team tasks
  TEAM_TASKS_QUERY_LIMIT: num(process.env.AI_TEAM_TASKS_QUERY_LIMIT, 500),
  PERSONAL_TASKS_QUERY_LIMIT: num(process.env.AI_PERSONAL_TASKS_QUERY_LIMIT, 25),

  // 0.2 Per-user LRU context cache settings
  CONTEXT_CACHE_MAX_USERS: num(process.env.AI_CONTEXT_CACHE_MAX_USERS, 200),
  CONTEXT_CACHE_TTL_MS: num(process.env.AI_CONTEXT_CACHE_TTL_MS, 45000),
  MANAGER_CONTEXT_CACHE_TTL_MS: num(process.env.AI_MANAGER_CONTEXT_CACHE_TTL_MS, 30000),

  // 0.3 Per-user AI rate limit settings
  RATE_LIMIT_MAX: num(process.env.AI_RATE_LIMIT_MAX, 30),
  RATE_LIMIT_WINDOW_MS: num(process.env.AI_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),

  // 1.3 & 1.4 Confidence calibration, OOD rejection & ambiguity margin thresholds
  CALIBRATION_TEMPERATURE: num(process.env.AI_CALIBRATION_TEMPERATURE, 0.22),
  OOD_CONFIDENCE_THRESHOLD: num(process.env.AI_OOD_CONFIDENCE_THRESHOLD, 0.12),
  AMBIGUOUS_MARGIN_THRESHOLD: num(process.env.AI_AMBIGUOUS_MARGIN_THRESHOLD, 0.08)
};

/**
 * 2.1 Configurable Experience-Weighted Suitability Scoring Weights
 */
const SUITABILITY_WEIGHTS = {
  PROVEN_BASE_SCORE: num(process.env.AI_WEIGHT_PROVEN_BASE, 50),
  COMPLETION_RATE_WEIGHT: num(process.env.AI_WEIGHT_COMPLETION_RATE, 0.55),
  ON_TIME_RATE_WEIGHT: num(process.env.AI_WEIGHT_ON_TIME_RATE, 0.65),
  COMPLETED_TASK_BONUS: num(process.env.AI_WEIGHT_COMPLETED_TASK_BONUS, 3),
  COMPLETED_TASK_CAP: num(process.env.AI_WEIGHT_COMPLETED_TASK_CAP, 10),
  HARD_TASK_BONUS: num(process.env.AI_WEIGHT_HARD_TASK_BONUS, 6),
  HARD_TASK_CAP: num(process.env.AI_WEIGHT_HARD_TASK_CAP, 5),
  OVERDUE_PENALTY: num(process.env.AI_WEIGHT_OVERDUE_PENALTY, 38),
  IN_PROGRESS_PENALTY: num(process.env.AI_WEIGHT_IN_PROGRESS_PENALTY, 12),
  TODO_PENALTY: num(process.env.AI_WEIGHT_TODO_PENALTY, 4),
  PENDING_LEAVE_PENALTY: num(process.env.AI_WEIGHT_PENDING_LEAVE_PENALTY, 15),
  APPROVED_LEAVE_PENALTY: num(process.env.AI_WEIGHT_APPROVED_LEAVE_PENALTY, 1000),
  SELF_CALLER_PENALTY: num(process.env.AI_WEIGHT_SELF_CALLER_PENALTY, 250)
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
            teamId: { type: 'string' },
            teamName: { type: 'string' },
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
  SUITABILITY_WEIGHTS,
  ASSISTANT_RESPONSE_SCHEMA,
  TASK_BREAKDOWN_SCHEMA,
  TASK_SUMMARY_SCHEMA
};
