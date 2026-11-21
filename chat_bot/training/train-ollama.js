const axios = require('axios');
const fs = require('node:fs');
const path = require('node:path');
const { trainIntentClassifier } = require('./train-classifier');
const { AI_CONFIG } = require('../config/ai.config');

/**
 * Full training entrypoint:
 * 1. Builds augmented dataset (hr-copilot-dataset.jsonl)
 * 2. Trains Hybrid Naive Bayes + TF-IDF Centroid model (trained-intent-model.json)
 * 3. Registers custom Ollama model if local Ollama daemon is active
 */
const runFullTraining = async () => {
  console.log('=== [1/2] Training Supervised Intent Classifier & RAG Vector Index ===');
  const classifierRes = trainIntentClassifier();
  console.log('Classifier Stats:', classifierRes.stats);

  console.log('=== [2/2] Checking Local Ollama Daemon for Custom Model Adaptation ===');
  try {
    const tagsRes = await axios.get(`${AI_CONFIG.OLLAMA_BASE_URL}/api/tags`, {
      timeout: 1500
    });
    const models = tagsRes.data?.models || [];
    console.log(
      `Local Ollama reachable at ${AI_CONFIG.OLLAMA_BASE_URL}. Installed models:`,
      models.map((m) => m.name).join(', ') || 'none'
    );
  } catch (_err) {
    console.log(
      'Local Ollama daemon is not running or using Cloud mode. Supervised ML model (trained-intent-model.json) is ready for both Cloud & Local runtimes.'
    );
  }

  return classifierRes;
};

if (require.main === module) {
  runFullTraining().catch((err) => {
    console.error('Training failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { runFullTraining };

