const fs = require('node:fs');
const path = require('node:path');
const { extractNGrams, trainIntentClassifier } = require('../training/train-classifier');
const { normalizeVi } = require('../utils/vietnamese-nlp.utils');
const { AI_CONFIG } = require('../config/ai.config');
const { INTENT_MAP } = require('../utils/intent-keywords.config');
const { SOP_KNOWLEDGE_DOCUMENTS } = require('../config/sop-knowledge.config');

let cachedModel = null;

/**
 * Load trained intent model weights from disk (or train on-the-fly if missing)
 * @returns {Object}
 */
const getTrainedModel = (forceReload = false) => {
  if (cachedModel && !forceReload) return cachedModel;
  const modelPath = path.join(__dirname, '..', 'training', 'trained-intent-model.json');
  if (!fs.existsSync(modelPath)) {
    trainIntentClassifier();
  }
  cachedModel = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  return cachedModel;
};

/**
 * Build L2-normalized TF-IDF vector for an input query
 */
const vectorizeQuery = (message, model) => {
  const feats = extractNGrams(message);
  const tf = {};
  for (const f of feats) {
    tf[f] = (tf[f] || 0) + 1;
  }

  const vec = {};
  let normSq = 0;
  for (const [term, freq] of Object.entries(tf)) {
    const idf = model.idf[term];
    if (!idf) continue;
    const w = (1 + Math.log(freq)) * idf;
    vec[term] = w;
    normSq += w * w;
  }

  const norm = Math.sqrt(normSq) || 1;
  for (const term of Object.keys(vec)) {
    vec[term] = vec[term] / norm;
  }

  return { feats, vec, recognizedTokenCount: Object.keys(vec).length };
};

/**
 * Cosine similarity between two sparse L2-normalized vectors
 */
const cosineSimilarity = (vecA, vecB) => {
  if (!vecA || !vecB) return 0;
  let dot = 0;
  for (const [term, valA] of Object.entries(vecA)) {
    if (vecB[term]) {
      dot += valA * vecB[term];
    }
  }
  return dot;
};

/**
 * Phase 1.1, 1.3 & 1.4: Predict top intents using Unified Config Anchors +
 * Calibrated Temperature-Scaled Softmax Probability Distribution + Margin Check
 *
 * @param {string} message
 * @param {number} topK
 * @returns {Array<{intent: string, confidence: number, margin: number, isAmbiguous: boolean, isOutOfDomain: boolean}>}
 */
const predictIntents = (message = '', topK = 3) => {
  const model = getTrainedModel();
  const { feats, vec, recognizedTokenCount } = vectorizeQuery(message, model);
  const norm = normalizeVi(message);
  const intents = Object.keys(model.classPriors);

  // If the query has zero recognized domain tokens and doesn't match any intent keyword, classify as out_of_domain
  const hasAnyConfigKeyword = Object.values(INTENT_MAP).some((def) =>
    (def.keywords || []).some((kw) => norm.includes(kw))
  );
  if (recognizedTokenCount === 0 && !hasAnyConfigKeyword) {
    return [
      {
        intent: 'out_of_domain',
        confidence: 0.92,
        margin: 0.85,
        isAmbiguous: false,
        isOutOfDomain: true
      }
    ];
  }

  // 1. Compute Naive Bayes log-scores
  const nbLogScores = {};
  let maxLog = -Infinity;
  for (const intent of intents) {
    let score = model.classPriors[intent] || 0;
    const logProbs = model.classLogProbs[intent] || {};
    const defProb = model.defaultLogProbs[intent] || -10;
    for (const f of feats) {
      if (model.idf[f]) {
        score += logProbs[f] !== undefined ? logProbs[f] : defProb;
      }
    }
    nbLogScores[intent] = score;
    if (score > maxLog) maxLog = score;
  }

  const nbTemp = 4.5;
  let sumNbExp = 0;
  const nbProbs = {};
  for (const intent of intents) {
    const e = Math.exp((nbLogScores[intent] - maxLog) / nbTemp);
    nbProbs[intent] = e;
    sumNbExp += e;
  }
  for (const intent of intents) {
    nbProbs[intent] = nbProbs[intent] / (sumNbExp || 1);
  }

  // 2. Compute raw logits combining TF-IDF Cosine + Naive Bayes + Single-Config Anchor Boost
  const rawLogits = {};
  let maxLogit = -Infinity;
  for (const intent of intents) {
    const centroid = model.intentCentroids[intent] || {};
    const cos = cosineSimilarity(vec, centroid);
    const def = INTENT_MAP[intent];
    const anchorBoost =
      def && typeof def.anchorBoost === 'function' ? def.anchorBoost(norm) : 0;
    const kwMatches = def
      ? (def.keywords || []).filter((kw) => norm.includes(kw)).length
      : 0;
    const kwBoost = Math.min(kwMatches * 0.08, 0.24);

    const logit = cos * 0.65 + nbProbs[intent] * 0.35 + anchorBoost + kwBoost;
    rawLogits[intent] = logit;
    if (logit > maxLogit) maxLogit = logit;
  }

  // 3. Phase 1.4: Calibrated Temperature-Scaled Softmax across all classes
  // so confidence is a true probability distribution (sum = 1.0)
  const calTemp = AI_CONFIG.CALIBRATION_TEMPERATURE || 0.22;
  let sumCalExp = 0;
  const calibratedProbs = {};
  for (const intent of intents) {
    const e = Math.exp((rawLogits[intent] - maxLogit) / calTemp);
    calibratedProbs[intent] = e;
    sumCalExp += e;
  }

  const ranked = intents
    .map((intent) => ({
      intent,
      rawScore: Number(rawLogits[intent].toFixed(4)),
      confidence: Number((calibratedProbs[intent] / (sumCalExp || 1)).toFixed(3))
    }))
    .sort((a, b) => b.confidence - a.confidence);

  const top1Conf = ranked[0]?.confidence || 0;
  const top2Conf = ranked[1]?.confidence || 0;
  const margin = Number((top1Conf - top2Conf).toFixed(3));
  const isAmbiguous = margin < AI_CONFIG.AMBIGUOUS_MARGIN_THRESHOLD;
  const isOutOfDomain =
    ranked[0]?.intent === 'out_of_domain' ||
    (ranked[0]?.rawScore || 0) < AI_CONFIG.OOD_CONFIDENCE_THRESHOLD;

  return ranked.slice(0, topK).map((item, idx) => ({
    intent: idx === 0 && isOutOfDomain ? 'out_of_domain' : item.intent,
    confidence: item.confidence,
    rawScore: item.rawScore,
    margin: idx === 0 ? margin : Number((item.confidence - (ranked[idx + 1]?.confidence || 0)).toFixed(3)),
    isAmbiguous: idx === 0 ? isAmbiguous : false,
    isOutOfDomain: idx === 0 ? isOutOfDomain : item.intent === 'out_of_domain',
    runnerUpIntent: idx === 0 ? ranked[1]?.intent || null : null
  }));
};

/**
 * Retrieve Top-K dynamic Few-Shot RAG examples from the trained knowledge index
 * @param {string} message
 * @param {number} topK
 * @returns {Array<{intent: string, category: string, sampleQuestion: string, idealAnswer: string, similarity: number}>}
 */
const retrieveFewShotExamples = (message = '', topK = 2) => {
  const model = getTrainedModel();
  const { vec } = vectorizeQuery(message, model);

  const scored = (model.ragCards || []).map((card) => ({
    intent: card.intent,
    category: card.category,
    sampleQuestion: card.sampleQuestion,
    idealAnswer: card.idealAnswer,
    similarity: Number(cosineSimilarity(vec, card.vector).toFixed(3))
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK);
};

/**
 * Phase 2.3: Retrieve SOP document from externalized SOP_KNOWLEDGE_DOCUMENTS config using keyword & vector scoring
 */
const buildSystemSopReply = (message, context) => {
  const norm = normalizeVi(message);
  let bestDoc = SOP_KNOWLEDGE_DOCUMENTS[SOP_KNOWLEDGE_DOCUMENTS.length - 1];
  let bestScore = -1;

  for (const doc of SOP_KNOWLEDGE_DOCUMENTS) {
    const matches = (doc.keywords || []).filter((kw) => norm.includes(kw)).length;
    if (matches > bestScore) {
      bestScore = matches;
      bestDoc = doc;
    }
  }

  return bestDoc.contentTemplate(context);
};

module.exports = {
  getTrainedModel,
  predictIntents,
  retrieveFewShotExamples,
  buildSystemSopReply
};
