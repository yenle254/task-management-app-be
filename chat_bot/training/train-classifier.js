const fs = require('node:fs');
const path = require('node:path');
const { buildDataset, SEED_INTENT_EXAMPLES } = require('./dataset-builder');
const { normalizeVi } = require('../utils/vietnamese-nlp.utils');

/**
 * Expand common Vietnamese workplace shorthand before feature extraction
 */
const expandShorthand = (normText = '') =>
  normText
    .replace(/\bdb\b/g, 'database')
    .replace(/\bko\b/g, 'khong')
    .replace(/\bdc\b/g, 'duoc')
    .replace(/\bnv\b/g, 'nhan vien')
    .replace(/\bql\b/g, 'quan ly')
    .replace(/\bcv\b/g, 'cong viec')
    .replace(/\bot\b/g, 'log gio')
    .replace(/\bdoing\b/g, 'in_progress');

/**
 * Extract Unigram + Bigram features from a Vietnamese utterance
 * @param {string} rawText
 * @returns {Array<string>}
 */
const extractNGrams = (rawText = '') => {
  const norm = expandShorthand(normalizeVi(rawText));
  if (!norm) return [];
  const words = norm.split(' ').filter((w) => w.length > 1);
  const features = [...words];

  for (let i = 0; i < words.length - 1; i++) {
    features.push(`${words[i]}_${words[i + 1]}`);
  }
  for (let i = 0; i < words.length - 2; i++) {
    features.push(`${words[i]}_${words[i + 1]}_${words[i + 2]}`);
  }
  return features;
};

/**
 * Train Hybrid Multinomial Naive Bayes + TF-IDF Cosine Centroid Classifier
 * and save weights to server/chat_bot/training/trained-intent-model.json
 */
const trainIntentClassifier = () => {
  const { examples, count, intentCount } = buildDataset();

  const docCount = examples.length;
  const dfMap = new Map();
  const classDocCounts = {};
  const classTokenCounts = {};
  const classTotalTokens = {};
  const vocabSet = new Set();

  for (const ex of examples) {
    const intent = ex.intent;
    classDocCounts[intent] = (classDocCounts[intent] || 0) + 1;
    if (!classTokenCounts[intent]) classTokenCounts[intent] = {};
    if (!classTotalTokens[intent]) classTotalTokens[intent] = 0;

    const ngrams = extractNGrams(ex.utterance);
    const uniqueInDoc = new Set(ngrams);

    for (const feat of uniqueInDoc) {
      dfMap.set(feat, (dfMap.get(feat) || 0) + 1);
      vocabSet.add(feat);
    }

    for (const feat of ngrams) {
      classTokenCounts[intent][feat] = (classTokenCounts[intent][feat] || 0) + 1;
      classTotalTokens[intent] += 1;
    }
  }

  const vocabulary = [...vocabSet];
  const vocabSize = vocabulary.length;

  // 1. Compute smoothed IDF weights: log(1 + (N + 1) / (df + 1))
  const idf = {};
  for (const term of vocabulary) {
    const df = dfMap.get(term) || 1;
    idf[term] = Number((Math.log(1 + (docCount + 1) / (df + 0.5))).toFixed(4));
  }

  // 2. Compute Multinomial Naive Bayes Log-Priors and Laplace-Smoothed Log-Likelihoods
  const alpha = 0.35;
  const classPriors = {};
  const classLogProbs = {};
  const defaultLogProbs = {};

  for (const intent of Object.keys(classDocCounts)) {
    classPriors[intent] = Number(Math.log(classDocCounts[intent] / docCount).toFixed(4));
    classLogProbs[intent] = {};
    const denom = classTotalTokens[intent] + alpha * vocabSize;
    defaultLogProbs[intent] = Number(Math.log(alpha / denom).toFixed(4));

    for (const [term, c] of Object.entries(classTokenCounts[intent])) {
      // Weight term count by IDF to boost discriminative domain terms
      const weightedCount = c * (idf[term] || 1);
      classLogProbs[intent][term] = Number(
        Math.log((weightedCount + alpha) / denom).toFixed(4)
      );
    }
  }

  // 3. Compute L2-normalized TF-IDF Centroid Vector per Intent Class
  const intentCentroids = {};
  for (const intent of Object.keys(classDocCounts)) {
    const rawVec = {};
    let normSq = 0;
    for (const [term, c] of Object.entries(classTokenCounts[intent])) {
      const weight = (1 + Math.log(c)) * (idf[term] || 1);
      rawVec[term] = weight;
      normSq += weight * weight;
    }
    const norm = Math.sqrt(normSq) || 1;
    intentCentroids[intent] = {};
    for (const [term, weight] of Object.entries(rawVec)) {
      intentCentroids[intent][term] = Number((weight / norm).toFixed(4));
    }
  }

  // 4. Build Canonical Few-Shot RAG Cards with L2-normalized TF-IDF vectors
  const ragCards = SEED_INTENT_EXAMPLES.map((group) => {
    const combinedText = `${group.category} ${group.utterances.join(' ')}`;
    const feats = extractNGrams(combinedText);
    const tf = {};
    for (const f of feats) tf[f] = (tf[f] || 0) + 1;

    const vec = {};
    let normSq = 0;
    for (const [term, freq] of Object.entries(tf)) {
      const w = (1 + Math.log(freq)) * (idf[term] || 1);
      vec[term] = w;
      normSq += w * w;
    }
    const norm = Math.sqrt(normSq) || 1;
    for (const term of Object.keys(vec)) {
      vec[term] = Number((vec[term] / norm).toFixed(4));
    }

    return {
      intent: group.intent,
      category: group.category,
      sampleQuestion: group.utterances[0],
      idealAnswer: group.idealAnswer,
      vector: vec
    };
  });

  const modelPayload = {
    version: '3.0.0',
    trainedAt: new Date().toISOString(),
    stats: {
      totalSamples: count,
      intentCount,
      vocabularySize: vocabSize
    },
    idf,
    classPriors,
    defaultLogProbs,
    classLogProbs,
    intentCentroids,
    ragCards
  };

  const modelPath = path.join(__dirname, 'trained-intent-model.json');
  fs.writeFileSync(modelPath, JSON.stringify(modelPayload, null, 2), 'utf8');

  return {
    modelPath,
    stats: modelPayload.stats
  };
};

if (require.main === module) {
  const result = trainIntentClassifier();
  console.log(
    `[Intent Classifier Trainer] Model trained successfully!`,
    JSON.stringify(result.stats),
    `Saved to ${result.modelPath}`
  );
}

module.exports = {
  trainIntentClassifier,
  extractNGrams,
  expandShorthand
};

