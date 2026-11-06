const aiConfig = require('./config/ai.config');
const aiRoutes = require('./routes/ai.routes');
const aiController = require('./controllers/ai.controller');
const aiAssistantService = require('./services/ai-assistant.service');
const aiContextService = require('./services/ai-context.service');
const aiValidators = require('./validators/ai.validators');
const vietnameseNlpUtils = require('./utils/vietnamese-nlp.utils');

module.exports = {
  aiConfig,
  aiRoutes,
  aiController,
  aiAssistantService,
  aiContextService,
  aiValidators,
  vietnameseNlpUtils
};
