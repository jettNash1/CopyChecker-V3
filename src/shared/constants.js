const TOOLS = {
  COPYCHECK: 'copycheck',
  LANGCHECK: 'langcheck',
};

const IPC_CHANNELS = {
  RUN: 'webcheck:run',
  CANCEL: 'webcheck:cancel',
  PAUSE: 'webcheck:pause',
  EXPORT: 'webcheck:export',
  LOAD_APP_CONFIG: 'webcheck:loadAppConfig',
  SAVE_APP_CONFIG: 'webcheck:saveAppConfig',
  LOAD_CONFIG: 'webcheck:loadConfig',
  SAVE_CONFIG: 'webcheck:saveConfig',
  IMPORT_URLS: 'webcheck:importUrls',
  PROGRESS: 'webcheck:progress',
  PING: 'webcheck:ping',
  DISMISSALS_LOAD: 'webcheck:dismissals:load',
  DISMISSALS_ADD: 'webcheck:dismissals:add',
  DISMISSALS_CLEAR: 'webcheck:dismissals:clear',
  ADD_TO_ALLOWLIST: 'webcheck:addToAllowList',
  IMPORT_SITEMAP: 'webcheck:importSitemap',
  CRAWL: 'webcheck:crawl',
  RUN_HISTORY_LIST: 'webcheck:runHistory:list',
  RUN_HISTORY_LOAD: 'webcheck:runHistory:load',
  RUN_HISTORY_SAVE: 'webcheck:runHistory:save',
  RUN_HISTORY_DELETE: 'webcheck:runHistory:delete',
  RUN_HISTORY_CLEAR: 'webcheck:runHistory:clear',
  COMPARE_RUNS: 'webcheck:compareRuns',
  RECHECK_URL: 'webcheck:recheckUrl',
  OPEN_URL: 'webcheck:openUrl',
  ONBOARDING_GET: 'webcheck:onboarding:get',
  ONBOARDING_SET: 'webcheck:onboarding:set',
  SCHEDULE_RESTART: 'webcheck:schedule:restart',
};

const USER_AGENT = 'WebCheck/1.2 (Desktop Content Audit)';

const FETCH_MODES = {
  AUTO: 'auto',
  STATIC: 'static',
  RENDERED: 'rendered',
};

function normaliseFetchMode(mode) {
  if (mode === FETCH_MODES.RENDERED || mode === FETCH_MODES.STATIC || mode === FETCH_MODES.AUTO) {
    return mode;
  }
  return FETCH_MODES.AUTO;
}

const FETCH_ACCESS_CODES = {
  DOMAIN_BLOCKED: 'DOMAIN_BLOCKED',
  BOT_PROTECTION: 'BOT_PROTECTION',
  RATE_LIMITED: 'RATE_LIMITED',
};

const FETCH_ACCESS_MESSAGES = {
  DOMAIN_BLOCKED:
    'This domain could not be reached. If the site is new, it may be blocked by your network\'s security policies. Check the URL, or ask IT to allow the domain.',
  BOT_PROTECTION:
    'This site is protected by Cloudflare or a similar service that blocks automated crawling. Add pages manually, or try JavaScript rendered fetch mode when checking URLs.',
  RATE_LIMITED:
    'This site asked WebCheck to slow down. Requests were delayed and retried, but the host still refused them.',
};

const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

const ISSUE_TYPES = {
  SPELLING: 'Spelling',
  PASSIVE_VOICE: 'Grammar: Passive voice',
  REPEATED_WORD: 'Grammar: Repeated word',
  READABILITY: 'Grammar: Readability',
  DOUBLE_SPACE: 'Style: Double space',
  GRAMMAR: 'Grammar',
  STYLE: 'Style',
};

const LANGCHECK_ISSUE_TYPES = {
  ENGLISH_WORD: 'Translation: Unexpected English (word)',
  ENGLISH_SENTENCE: 'Translation: Unexpected English (sentence)',
  ENGLISH_BLOCK: 'Translation: Unexpected English (block)',
  LOCALE_FALLBACK: 'LangCheck: Locale fallback',
  ENGLISH_PAGE: 'LangCheck: English page (no URL locale)',
};

const EXPECTED_LANGUAGE_OPTIONS = [
  { value: 'eng', label: 'English' },
  { value: 'fra', label: 'French' },
  { value: 'deu', label: 'German' },
  { value: 'spa', label: 'Spanish' },
  { value: 'jpn', label: 'Japanese' },
  { value: 'ita', label: 'Italian' },
  { value: 'por', label: 'Portuguese' },
  { value: 'nld', label: 'Dutch' },
  { value: 'pol', label: 'Polish' },
  { value: 'swe', label: 'Swedish' },
  { value: 'dan', label: 'Danish' },
  { value: 'nor', label: 'Norwegian' },
  { value: 'fin', label: 'Finnish' },
  { value: 'ces', label: 'Czech' },
  { value: 'ron', label: 'Romanian' },
  { value: 'hun', label: 'Hungarian' },
  { value: 'tur', label: 'Turkish' },
  { value: 'arb', label: 'Arabic' },
  { value: 'rus', label: 'Russian' },
  { value: 'ukr', label: 'Ukrainian' },
  { value: 'cmn', label: 'Chinese (Mandarin)' },
  { value: 'kor', label: 'Korean' },
];

const CHECK_MODES = {
  OFFLINE: 'offline',
  LANGUAGETOOL: 'languagetool',
};

const CSV_COLUMNS = [
  'timestamp',
  'locale',
  'url',
  'context',
  'flaggedText',
  'issueType',
  'suggestion',
  'message',
  'rule',
  'location',
  'suggestions',
  'severity',
  'element',
  'configSnapshot',
  'diffStatus',
];

const ROWS_PER_PAGE = 50;

const LOCALE_OPTIONS = [
  { value: 'en-GB', label: 'British English (en-GB)' },
  { value: 'en-US', label: 'American English (en-US)' },
];

const EXPORT_FORMATS = [
  { value: 'csv', label: 'CSV', extension: 'csv' },
  { value: 'html', label: 'HTML report', extension: 'html' },
  { value: 'json', label: 'JSON', extension: 'json' },
  { value: 'tsv', label: 'TSV report', extension: 'tsv' },
];

module.exports = {
  IPC_CHANNELS,
  USER_AGENT,
  FETCH_MODES,
  normaliseFetchMode,
  FETCH_ACCESS_CODES,
  FETCH_ACCESS_MESSAGES,
  SEVERITY,
  ISSUE_TYPES,
  LANGCHECK_ISSUE_TYPES,
  EXPECTED_LANGUAGE_OPTIONS,
  TOOLS,
  CHECK_MODES,
  CSV_COLUMNS,
  ROWS_PER_PAGE,
  LOCALE_OPTIONS,
  EXPORT_FORMATS,
};
