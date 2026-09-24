const { normaliseFetchMode } = require('./constants');

const DEFAULT_IGNORE_TAGS = [
  'script',
  'style',
  'code',
  'pre',
  'nav',
  'footer',
  'noscript',
  'time',
  'aside',
];

const DEFAULT_IGNORE_SELECTORS = [
  '[aria-hidden="true"]',
  '[class*="attribution" i]',
  '[class*="metadata" i]',
  '[class*="timestamp" i]',
  '[data-testid*="attribution" i]',
  '[data-testid*="timestamp" i]',
];

const DEFAULT_CONTENT_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'td', 'th', 'blockquote', 'figcaption', 'caption',
];

const DEFAULT_SCHEDULE = {
  enabled: false,
  frequency: 'daily',
  outputDir: '',
  outputFormat: 'csv',
  lastRunAt: null,
};

const DEFAULT_CONFIG = {
  locale: 'en-GB',
  ignoreTags: [...DEFAULT_IGNORE_TAGS],
  ignoreSelectors: [...DEFAULT_IGNORE_SELECTORS],
  contentTags: [...DEFAULT_CONTENT_TAGS],
  allowList: [],
  minWordLength: 3,
  grammarRules: {
    passiveVoice: true,
    repeatedWords: true,
    readability: true,
  },
  fetchTimeoutMs: 15000,
  fetchConcurrency: 3,
  fetchMode: 'auto',
  checkMode: 'offline',
  languageToolUrl: 'https://api.languagetool.org/v2/check',
  languageToolMaxChars: 20000,
  languageToolDelayMs: 100,
  crawlMaxDepth: 2,
  crawlExcludeExtensions: ['pdf', 'zip', 'jpg', 'jpeg', 'png', 'gif', 'svg', 'mp4', 'mp3'],
  crawlExcludePaths: ['/admin', '/api', '/wp-admin'],
  crawlExcludeQueryStrings: true,
  savedUrls: [],
  authProfiles: [],
  schedule: { ...DEFAULT_SCHEDULE },
  showPreviouslyDismissed: false,
};

function mergeConfig(stored) {
  if (!stored || typeof stored !== 'object') {
    return { ...DEFAULT_CONFIG, schedule: { ...DEFAULT_SCHEDULE } };
  }

  return {
    ...DEFAULT_CONFIG,
    ...stored,
    ignoreTags: Array.isArray(stored.ignoreTags) ? stored.ignoreTags : DEFAULT_CONFIG.ignoreTags,
    ignoreSelectors: Array.isArray(stored.ignoreSelectors) && stored.ignoreSelectors.length > 0
      ? stored.ignoreSelectors
      : DEFAULT_CONFIG.ignoreSelectors,
    contentTags: Array.isArray(stored.contentTags) && stored.contentTags.length > 0
      ? stored.contentTags
      : DEFAULT_CONFIG.contentTags,
    allowList: Array.isArray(stored.allowList) ? stored.allowList : DEFAULT_CONFIG.allowList,
    grammarRules: {
      ...DEFAULT_CONFIG.grammarRules,
      ...(stored.grammarRules || {}),
    },
    savedUrls: Array.isArray(stored.savedUrls) ? stored.savedUrls : DEFAULT_CONFIG.savedUrls,
    crawlExcludeExtensions: Array.isArray(stored.crawlExcludeExtensions)
      ? stored.crawlExcludeExtensions
      : DEFAULT_CONFIG.crawlExcludeExtensions,
    crawlExcludePaths: Array.isArray(stored.crawlExcludePaths)
      ? stored.crawlExcludePaths
      : DEFAULT_CONFIG.crawlExcludePaths,
    crawlExcludeQueryStrings: stored.crawlExcludeQueryStrings !== false,
    authProfiles: Array.isArray(stored.authProfiles) ? stored.authProfiles : [],
    schedule: { ...DEFAULT_SCHEDULE, ...(stored.schedule || {}) },
    fetchConcurrency: stored.fetchConcurrency ?? DEFAULT_CONFIG.fetchConcurrency,
    fetchMode: normaliseFetchMode(stored.fetchMode),
    checkMode: stored.checkMode === 'languagetool' ? 'languagetool' : 'offline',
    languageToolUrl: stored.languageToolUrl || DEFAULT_CONFIG.languageToolUrl,
    languageToolMaxChars: stored.languageToolMaxChars ?? DEFAULT_CONFIG.languageToolMaxChars,
    languageToolDelayMs: stored.languageToolDelayMs ?? DEFAULT_CONFIG.languageToolDelayMs,
  };
}

module.exports = {
  DEFAULT_CONFIG,
  DEFAULT_IGNORE_TAGS,
  DEFAULT_IGNORE_SELECTORS,
  DEFAULT_CONTENT_TAGS,
  DEFAULT_SCHEDULE,
  mergeConfig,
};
