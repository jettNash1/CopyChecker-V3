const { DEFAULT_CONFIG } = require('./defaultConfig');

const CHECK_DEFAULTS = {
  locale: 'en-GB',
  englishVariant: 'en-GB',
  ignoreTags: [...DEFAULT_CONFIG.ignoreTags],
  ignoreSelectors: [...DEFAULT_CONFIG.ignoreSelectors],
  contentTags: [...DEFAULT_CONFIG.contentTags],
  allowList: [],
  minWordLength: DEFAULT_CONFIG.minWordLength,
  minSentenceLength: 20,
  minBlockLength: 40,
  francMinLength: 10,
  suppressNestedWhenBlockFlagged: true,
  detectionLevels: {
    words: true,
    sentences: true,
    blocks: true,
  },
  grammarRules: { ...DEFAULT_CONFIG.grammarRules },
  fetchTimeoutMs: DEFAULT_CONFIG.fetchTimeoutMs,
  fetchConcurrency: DEFAULT_CONFIG.fetchConcurrency,
  fetchMode: 'auto',
  checkMode: 'offline',
  authProfiles: [],
};

module.exports = { CHECK_DEFAULTS };
