const { EXPECTED_LANGUAGE_OPTIONS } = require('../shared/constants');
const { resolveExpectedLanguage } = require('./url-locale');

const CHECK_KINDS = {
  SPELLING: 'spelling',
  LANGCHECK: 'langcheck',
};

const ADDRESS_HINT = 'Use an address that starts with http:// or https://.';
const FALLBACK_LANGUAGE = 'eng';

function validateAddress(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { valid: false, url: '', message: 'Enter at least one page address.' };
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, url: trimmed, message: ADDRESS_HINT };
    }
    return { valid: true, url: parsed.href };
  } catch {
    return { valid: false, url: trimmed, message: ADDRESS_HINT };
  }
}

function parseAddressList(input) {
  const lines = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
  const valid = [];
  const errors = [];
  const seen = new Set();

  lines.forEach((raw, index) => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return;

    const result = validateAddress(trimmed);
    if (!result.valid) {
      errors.push({ line: index + 1, url: trimmed, message: result.message });
      return;
    }

    if (seen.has(result.url)) return;
    seen.add(result.url);
    valid.push(result.url);
  });

  if (valid.length === 0 && errors.length === 0) {
    errors.push({ line: 0, url: '', message: 'Enter at least one page address.' });
  }

  return { valid, errors };
}

function resolvePageCheck(url) {
  const meta = resolveExpectedLanguage(url, {
    languageMode: 'from-url',
    expectedLanguage: FALLBACK_LANGUAGE,
  });
  const fromAddress = meta.source === 'url';
  const kind = meta.code === 'eng' ? CHECK_KINDS.SPELLING : CHECK_KINDS.LANGCHECK;

  return {
    code: meta.code,
    label: meta.label,
    source: fromAddress ? 'url' : 'fallback',
    summary: fromAddress ? `${meta.label}, from the address` : meta.label,
    kind,
    kindLabel: kind === CHECK_KINDS.SPELLING ? 'Spelling and grammar' : 'Unexpected English',
  };
}

function decisionForLanguage(code) {
  const known = EXPECTED_LANGUAGE_OPTIONS.find((entry) => entry.value === code);
  if (!known) return null;

  const kind = known.value === 'eng' ? CHECK_KINDS.SPELLING : CHECK_KINDS.LANGCHECK;
  return {
    code: known.value,
    label: known.label,
    source: 'country',
    summary: known.label,
    kind,
    kindLabel: kind === CHECK_KINDS.SPELLING ? 'Spelling and grammar' : 'Unexpected English',
  };
}

function decisionsForLanguages(codes) {
  const seen = new Set();
  const decisions = [];

  for (const code of codes || []) {
    const decision = decisionForLanguage(code);
    if (!decision || seen.has(decision.code)) continue;
    seen.add(decision.code);
    decisions.push(decision);
  }

  return decisions;
}

module.exports = {
  CHECK_KINDS,
  parseAddressList,
  resolvePageCheck,
  decisionForLanguage,
  decisionsForLanguages,
};
