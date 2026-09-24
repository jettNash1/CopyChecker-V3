const { EXPECTED_LANGUAGE_OPTIONS } = require('../shared/constants');

const LANGUAGE_CODE_MAP = {
  eng: 'eng',
  en: 'eng',
  'en-gb': 'eng',
  'en-us': 'eng',
  fra: 'fra',
  fr: 'fra',
  deu: 'deu',
  de: 'deu',
  spa: 'spa',
  es: 'spa',
  jpn: 'jpn',
  ja: 'jpn',
  jp: 'jpn',
  ita: 'ita',
  it: 'ita',
  por: 'por',
  pt: 'por',
  nld: 'nld',
  nl: 'nld',
  pol: 'pol',
  pl: 'pol',
  swe: 'swe',
  sv: 'swe',
  dan: 'dan',
  da: 'dan',
  nor: 'nor',
  nb: 'nor',
  no: 'nor',
  fin: 'fin',
  fi: 'fin',
  ces: 'ces',
  cs: 'ces',
  ron: 'ron',
  ro: 'ron',
  hun: 'hun',
  hu: 'hun',
  tur: 'tur',
  tr: 'tur',
  rus: 'rus',
  ru: 'rus',
  ukr: 'ukr',
  uk: 'ukr',
  cmn: 'cmn',
  zh: 'cmn',
  kor: 'kor',
  ko: 'kor',
  arb: 'arb',
  ar: 'arb',
};

const QUERY_PARAM_KEYS = ['lang', 'locale', 'language'];

function normaliseLanguageCode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const lower = raw.trim().toLowerCase();
  if (LANGUAGE_CODE_MAP[lower]) return LANGUAGE_CODE_MAP[lower];
  const token = lower.split(/[-_]/)[0];
  return LANGUAGE_CODE_MAP[token] || null;
}

function getLanguageLabel(code) {
  const option = EXPECTED_LANGUAGE_OPTIONS.find((entry) => entry.value === code);
  return option?.label || code;
}

function segmentToLanguageCode(segment) {
  const lower = segment.toLowerCase();

  if (/^[a-z]{2}$/.test(lower)) {
    return LANGUAGE_CODE_MAP[lower] || null;
  }

  const bcp47 = lower.match(/^([a-z]{2})-([a-z]{2})$/);
  if (bcp47) {
    return LANGUAGE_CODE_MAP[lower] || LANGUAGE_CODE_MAP[bcp47[1]] || null;
  }

  return null;
}

function detectFromPath(pathname) {
  const segments = pathname.split('/').filter(Boolean);

  for (const segment of segments) {
    const code = segmentToLanguageCode(segment);
    if (code) return code;
  }

  return null;
}

function detectFromQuery(searchParams) {
  for (const key of QUERY_PARAM_KEYS) {
    const value = searchParams.get(key);
    const code = normaliseLanguageCode(value);
    if (code) return code;
  }
  return null;
}

function detectFromSubdomain(hostname) {
  const parts = hostname.split('.');
  if (parts.length < 3) return null;
  const subdomain = parts[0].toLowerCase();
  if (subdomain.length !== 2) return null;
  return normaliseLanguageCode(subdomain);
}

function resolveExpectedLanguage(url, config) {
  const fallbackCode = config.expectedLanguage || 'fra';
  const languageMode = config.languageMode || 'from-url';

  if (languageMode === 'manual') {
    return {
      code: fallbackCode,
      source: 'manual',
      label: getLanguageLabel(fallbackCode),
    };
  }

  try {
    const parsed = new URL(url);
    const fromPath = detectFromPath(parsed.pathname);
    if (fromPath) {
      return { code: fromPath, source: 'url', label: getLanguageLabel(fromPath) };
    }

    const fromQuery = detectFromQuery(parsed.searchParams);
    if (fromQuery) {
      return { code: fromQuery, source: 'url', label: getLanguageLabel(fromQuery) };
    }

    const fromSubdomain = detectFromSubdomain(parsed.hostname);
    if (fromSubdomain) {
      return { code: fromSubdomain, source: 'url', label: getLanguageLabel(fromSubdomain) };
    }
  } catch {
    // Invalid URL — use fallback
  }

  return {
    code: fallbackCode,
    source: 'fallback',
    label: getLanguageLabel(fallbackCode),
  };
}

module.exports = {
  resolveExpectedLanguage,
  normaliseLanguageCode,
  getLanguageLabel,
  detectFromPath,
};
