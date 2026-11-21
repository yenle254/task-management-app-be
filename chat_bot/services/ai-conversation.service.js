/**
 * Server-side Conversation Memory & Model Feedback Loop Service (Phase 2.2 & 2.5)
 * Stores per-user conversation turns, resolved entities for multi-turn coreference,
 * and user feedback ratings for continuous classifier retraining.
 */

const MAX_CONVERSATION_USERS = 300;
const MAX_MESSAGES_PER_USER = 24;
const MAX_FEEDBACK_ENTRIES = 500;

const conversationStore = new Map();
const feedbackStore = [];

/**
 * Get stored conversation session for a user
 * @param {string} userId
 * @returns {{ messages: Array<Object>, lastResolvedEntities: Object, updatedAt: number }}
 */
const getUserConversation = (userId) => {
  const key = String(userId || 'anonymous');
  if (!conversationStore.has(key)) {
    return {
      messages: [],
      lastResolvedEntities: { taskId: null, taskTitle: null, assigneeId: null, teamId: null },
      updatedAt: Date.now()
    };
  }
  const entry = conversationStore.get(key);
  // Refresh LRU order
  conversationStore.delete(key);
  conversationStore.set(key, entry);
  return entry;
};

/**
 * Merge client-sent history with server-persisted history so multi-turn coreference
 * works across >4 turns even if the client omits history.
 */
const getMergedHistory = (userId, clientHistory = []) => {
  const session = getUserConversation(userId);
  if (Array.isArray(clientHistory) && clientHistory.length >= session.messages.length) {
    return clientHistory.slice(-MAX_MESSAGES_PER_USER);
  }
  const combined = [...session.messages];
  for (const turn of clientHistory || []) {
    if (
      turn?.content &&
      !combined.some((m) => m.role === turn.role && m.content === turn.content)
    ) {
      combined.push({ role: turn.role, content: turn.content });
    }
  }
  return combined.slice(-MAX_MESSAGES_PER_USER);
};

/**
 * Append a completed user/assistant turn to server memory
 */
const recordConversationTurn = (userId, { userMessage, assistantReply, resolvedEntities = {} }) => {
  const key = String(userId || 'anonymous');
  const current = getUserConversation(key);

  const nextMessages = [
    ...current.messages,
    { role: 'user', content: userMessage, at: new Date().toISOString() },
    { role: 'assistant', content: assistantReply, at: new Date().toISOString() }
  ].slice(-MAX_MESSAGES_PER_USER);

  const nextEntities = {
    ...current.lastResolvedEntities,
    ...Object.fromEntries(
      Object.entries(resolvedEntities).filter(([, v]) => v !== undefined && v !== null)
    )
  };

  if (conversationStore.size >= MAX_CONVERSATION_USERS && !conversationStore.has(key)) {
    const oldestKey = conversationStore.keys().next().value;
    if (oldestKey) conversationStore.delete(oldestKey);
  }

  conversationStore.set(key, {
    messages: nextMessages,
    lastResolvedEntities: nextEntities,
    updatedAt: Date.now()
  });
};

/**
 * Clear conversation memory for a user (or all users)
 */
const clearConversationMemory = (userId = null) => {
  if (userId) {
    conversationStore.delete(String(userId));
  } else {
    conversationStore.clear();
  }
};

/**
 * Record user feedback on an AI response for model quality governance (Phase 2.5)
 */
const recordAssistantFeedback = ({
  userId,
  message,
  predictedIntent,
  rating,
  confirmedAction = null,
  comment = ''
}) => {
  const entry = {
    id: `fb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: String(userId || 'anonymous'),
    message: String(message || '').slice(0, 500),
    predictedIntent: predictedIntent || 'unknown',
    rating: rating === 'down' ? 'down' : 'up',
    confirmedAction,
    comment: String(comment || '').slice(0, 500),
    createdAt: new Date().toISOString()
  };

  if (feedbackStore.length >= MAX_FEEDBACK_ENTRIES) {
    feedbackStore.shift();
  }
  feedbackStore.push(entry);
  return entry;
};

const getFeedbackRecords = () => [...feedbackStore];

module.exports = {
  getUserConversation,
  getMergedHistory,
  recordConversationTurn,
  clearConversationMemory,
  recordAssistantFeedback,
  getFeedbackRecords
};

