const fs = require('node:fs');
const path = require('node:path');
const { INTENT_DEFINITIONS } = require('../utils/intent-keywords.config');

/**
 * Strip Vietnamese diacritics to generate realistic no-accent user queries
 */
const stripDiacritics = (str = '') =>
  String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');

/**
 * Generate workplace abbreviation & colloquial variants for Vietnamese augmentation
 */
const applyWorkplaceAugmentation = (text) => {
  const variants = new Set();
  variants.add(text);
  variants.add(stripDiacritics(text));

  const shorthand = stripDiacritics(text)
    .toLowerCase()
    .replace(/\bdatabase\b/g, 'db')
    .replace(/\bkhong\b/g, 'ko')
    .replace(/\bduoc\b/g, 'dc')
    .replace(/\bnhan vien\b/g, 'nv')
    .replace(/\bquan ly\b/g, 'ql')
    .replace(/\bcong viec\b/g, 'cv')
    .replace(/\bnghi phep\b/g, 'phep')
    .replace(/\bphut\b/g, 'p');

  if (shorthand !== stripDiacritics(text).toLowerCase()) {
    variants.add(shorthand);
  }

  return [...variants];
};

/**
 * Build the complete JSONL dataset file (hr-copilot-dataset.jsonl)
 * directly from the Single Source of Truth INTENT_DEFINITIONS (Phase 1.1 & 1.3)
 *
 * @returns {{ count: number, intentCount: number, datasetPath: string, examples: Array<Object> }}
 */
const buildDataset = () => {
  const examples = [];
  let idCounter = 1;

  for (const group of INTENT_DEFINITIONS) {
    for (const rawUtterance of group.utterances || []) {
      const augmentedList = applyWorkplaceAugmentation(rawUtterance);
      for (let i = 0; i < augmentedList.length; i++) {
        examples.push({
          id: `sample_${String(idCounter++).padStart(3, '0')}`,
          intent: group.intent,
          category: group.category,
          variant: i === 0 ? 'canonical_vi' : i === 1 ? 'no_diacritics' : 'shorthand_vi',
          utterance: augmentedList[i],
          canonicalUtterance: rawUtterance,
          idealAnswer: group.idealAnswer
        });
      }
    }
  }

  const datasetPath = path.join(__dirname, 'hr-copilot-dataset.jsonl');
  const jsonlContent = examples.map((ex) => JSON.stringify(ex)).join('\n') + '\n';
  fs.writeFileSync(datasetPath, jsonlContent, 'utf8');

  return {
    count: examples.length,
    intentCount: INTENT_DEFINITIONS.length,
    datasetPath,
    examples
  };
};

if (require.main === module) {
  const res = buildDataset();
  console.log(
    `[Dataset Builder] Generated ${res.count} training samples across ${res.intentCount} intents at ${res.datasetPath}`
  );
}

module.exports = {
  SEED_INTENT_EXAMPLES: INTENT_DEFINITIONS,
  buildDataset,
  stripDiacritics
};
