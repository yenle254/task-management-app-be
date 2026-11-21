const aiConfig = require('./config/ai.config');
const intentKeywordsConfig = require('./utils/intent-keywords.config');
const sopKnowledgeConfig = require('./config/sop-knowledge.config');
const aiRoutes = require('./routes/ai.routes');
const aiController = require('./controllers/ai.controller');
const aiAssistantService = require('./services/ai-assistant.service');
const aiContextService = require('./services/ai-context.service');
const aiKnowledgeService = require('./services/ai-knowledge.service');
const aiConversationService = require('./services/ai-conversation.service');
const aiToolsService = require('./services/ai-tools.service');
const aiValidators = require('./validators/ai.validators');
const vietnameseNlpUtils = require('./utils/vietnamese-nlp.utils');

module.exports = {
  aiConfig,
  intentKeywordsConfig,
  sopKnowledgeConfig,
  aiRoutes,
  aiController,
  aiAssistantService,
  aiContextService,
  aiKnowledgeService,
  aiConversationService,
  aiToolsService,
  aiValidators,
  vietnameseNlpUtils
};
