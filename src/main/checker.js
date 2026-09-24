const nspell = require('nspell');
const { retext } = require('retext');
const retextEnglish = require('retext-english').default;
const retextPassive = require('retext-passive').default;
const retextRepeatedWords = require('retext-repeated-words').default;
const retextReadability = require('retext-readability').default;
const { SEVERITY, ISSUE_TYPES, CHECK_MODES } = require('../shared/constants');
const { NAME_PARTICLES, loadPlaceNames, levenshtein } = require('./confidence');
const { checkWithLanguageTool } = require('./languagetool');

const READABILITY_AGE = 18;
const MAX_READABILITY_ISSUES = 10;
const MIN_READABILITY_CHARS = 200;
const QUOTE_LENGTH = 280;

let spellChecker = null;
let currentLocale = null;

const dictionaryCache = {};

async function loadDictionary(locale) {
  if (dictionaryCache[locale]) {
    return dictionaryCache[locale];
  }

  const moduleName = locale === 'en-US' ? 'dictionary-en' : 'dictionary-en-gb';
  const dictModule = await import(moduleName);
  const dict = dictModule.default || dictModule;

  dictionaryCache[locale] = dict;
  return dict;
}

async function initChecker(locale = 'en-GB') {
  const dict = await loadDictionary(locale);
  spellChecker = nspell(dict);
  currentLocale = locale;
}

async function ensureLocale(locale) {
  if (locale !== currentLocale || !spellChecker) {
    await initChecker(locale);
  }
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function enrichIssue(issue) {
  const suggestions = issue.suggestions || (issue.suggestion ? [issue.suggestion] : []);
  return {
    ...issue,
    suggestions,
    message: issue.message || '',
    rule: issue.rule || '',
    location: issue.location || issue.element || '',
    offset: issue.offset ?? -1,
    length: issue.length ?? 0,
    suggestion: issue.suggestion || suggestions[0] || '',
  };
}

function tokeniseWords(text) {
  const matches = text.match(/[A-Za-z][A-Za-z'-]*/g);
  return matches || [];
}

function isGluedToken(word) {
  return /[a-z][A-Z]/.test(word) || word.length > 30;
}

function wordForms(word) {
  const forms = new Set([word]);
  const lower = word.toLowerCase();

  forms.add(lower);

  if (lower.endsWith("'s")) {
    forms.add(lower.slice(0, -2));
  } else if (lower.endsWith('s') && lower.length > 2) {
    forms.add(lower.slice(0, -1));
    forms.add(`${lower.slice(0, -1)}'s`);
  } else {
    forms.add(`${lower}'s`);
    forms.add(`${lower}s`);
  }

  if (word !== lower) {
    forms.add(word);
  }

  return Array.from(forms);
}

function isDictionaryValid(word) {
  return wordForms(word).some((form) => spellChecker.correct(form));
}

function isCapitalised(word) {
  return /^[A-Z]/.test(word) && !/^[A-Z]+$/.test(word);
}

function isAcronym(word) {
  return /^[A-Z]{2,5}$/.test(word);
}

function isBesideCapitalised(words, wordIndex) {
  const word = words[wordIndex] || '';
  if (!/^[A-Z]/.test(word)) return false;
  const prev = wordIndex > 0 ? words[wordIndex - 1] : '';
  const next = wordIndex + 1 < words.length ? words[wordIndex + 1] : '';
  return /^[A-Z]/.test(prev) || /^[A-Z]/.test(next);
}

function shouldSkipSpellingWord(word, wordIndex, words) {
  if (!word) return true;
  if (isAcronym(word)) return true;
  if (wordIndex > 0 && isCapitalised(word)) return true;
  if (isBesideCapitalised(words, wordIndex)) return true;
  if (wordIndex > 0 && NAME_PARTICLES.has(words[wordIndex - 1].toLowerCase().replace(/'/g, ''))) {
    return true;
  }
  if (loadPlaceNames().has(word.toLowerCase())) return true;
  return false;
}

function spellingCandidates(word, wordIndex, words) {
  if (!word.includes('-')) {
    return shouldSkipSpellingWord(word, wordIndex, words) ? [] : [word];
  }

  return word.split('-').filter((part) => part && !/^[A-Z]/.test(part) && !isAcronym(part));
}

function stripTrailingApostrophe(word) {
  return String(word || '').replace(/['’]+$/u, '');
}

function isOneLetterSpellingFix(word, suggestion) {
  if (!suggestion) return false;
  if (word.toLowerCase() === suggestion.toLowerCase()) return false;
  return levenshtein(word.toLowerCase(), suggestion.toLowerCase()) === 1;
}

function findWordOffset(text, word, wordIndex, words) {
  let searchFrom = 0;
  for (let i = 0; i < wordIndex; i += 1) {
    const idx = text.indexOf(words[i], searchFrom);
    if (idx >= 0) searchFrom = idx + words[i].length;
  }
  const offset = text.indexOf(word, searchFrom);
  return offset >= 0 ? offset : -1;
}

function checkSpelling(sentences, config) {
  const issues = [];
  const allowSet = new Set((config.allowList || []).map((w) => w.toLowerCase()));
  const minLen = config.minWordLength || 3;

  for (const sentence of sentences) {
    if ((sentence.wordCount || 0) < 2) continue;

    const words = tokeniseWords(sentence.text);

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (word.length < minLen) continue;
      if (/\d/.test(word)) continue;
      if (isGluedToken(word)) continue;
      if (allowSet.has(word.toLowerCase())) continue;

      const candidates = spellingCandidates(word, i, words);
      for (const candidate of candidates) {
        const token = stripTrailingApostrophe(candidate);
        if (token.length < minLen) continue;
        if (allowSet.has(token.toLowerCase())) continue;
        if (isDictionaryValid(token) || isDictionaryValid(candidate)) continue;

        const suggestions = spellChecker.suggest(token).slice(0, 5);
        const sentenceStart = !word.includes('-') && i === 0;
        if ((sentenceStart || isCapitalised(token)) && !isOneLetterSpellingFix(token, suggestions[0])) {
          continue;
        }

        const offset = findWordOffset(sentence.text, candidate, i, words);
        issues.push(enrichIssue({
          id: generateId(),
          url: sentence.url,
          context: sentence.text,
          paragraph: sentence.paragraph || sentence.text,
          flaggedText: token,
          issueType: ISSUE_TYPES.SPELLING,
          suggestion: suggestions[0] || '',
          suggestions,
          message: 'Possible misspelling',
          rule: 'Dictionary lookup',
          location: sentence.location || sentence.element,
          element: sentence.element,
          offset,
          length: token.length,
          severity: SEVERITY.ERROR,
        }));
      }
    }
  }

  return issues;
}

function checkDoubleSpaces(blocks) {
  const issues = [];
  const regex = /\s{2,}/g;

  for (const block of blocks) {
    let match = regex.exec(block.text);
    while (match) {
      issues.push(enrichIssue({
        id: generateId(),
        url: block.url,
        context: sentenceAround(block.text, match[0]),
        paragraph: block.text,
        flaggedText: match[0],
        issueType: ISSUE_TYPES.DOUBLE_SPACE,
        suggestion: ' ',
        suggestions: [' '],
        message: 'Double space detected',
        rule: 'Double Space',
        location: block.location || block.element,
        element: block.element,
        offset: match.index,
        length: match[0].length,
        severity: SEVERITY.INFO,
      }));
      match = regex.exec(block.text);
    }
    regex.lastIndex = 0;
  }

  return issues;
}

function buildGrammarProcessor(config) {
  const processor = retext().use(retextEnglish);

  if (config.grammarRules?.passiveVoice) {
    processor.use(retextPassive);
  }
  if (config.grammarRules?.repeatedWords) {
    processor.use(retextRepeatedWords);
  }
  if (config.grammarRules?.readability) {
    processor.use(retextReadability, { age: READABILITY_AGE });
  }

  return processor;
}

function textAt(message, blockText) {
  const start = message.position?.start?.offset ?? message.place?.start?.offset;
  const end = message.position?.end?.offset ?? message.place?.end?.offset;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return '';
  return String(blockText || '').slice(start, end);
}

function sentenceAround(text, needle) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const parts = clean.split(/(?<=[.!?])\s+/);
  const target = String(needle || '').trim().toLowerCase();
  const found = target
    ? parts.find((part) => part.toLowerCase().includes(target))
    : '';
  const sentence = found || parts[0] || clean;
  if (sentence.length <= QUOTE_LENGTH) return sentence;
  return `${sentence.slice(0, QUOTE_LENGTH - 3)}...`;
}

function limitReadabilityIssues(issues) {
  const readability = (issues || [])
    .filter((issue) => issue.issueType === ISSUE_TYPES.READABILITY)
    .filter((issue) => String(issue.context || '').length >= MIN_READABILITY_CHARS)
    .sort((left, right) => String(right.context || '').length - String(left.context || '').length)
    .slice(0, MAX_READABILITY_ISSUES);
  const rest = (issues || []).filter((issue) => issue.issueType !== ISSUE_TYPES.READABILITY);
  return [...rest, ...readability];
}

function mapGrammarMessage(message, block) {
  const source = message.source || '';
  const reason = message.reason || message.message || 'Grammar issue';
  const located = textAt(message, block.text);
  const flaggedText = (message.actual || located || reason).slice(0, 120);
  const suggestion = (message.expected && message.expected[0]) || '';
  const suggestions = message.expected?.length ? message.expected.slice(0, 5) : (suggestion ? [suggestion] : []);

  let issueType = ISSUE_TYPES.READABILITY;
  let rule = 'Readability';
  let severity = SEVERITY.INFO;

  if (source.includes('retext-passive') || reason.toLowerCase().includes('passive')) {
    issueType = ISSUE_TYPES.PASSIVE_VOICE;
    rule = 'Passive voice';
    severity = SEVERITY.WARNING;
  } else if (source.includes('retext-repeated-words') || reason.toLowerCase().includes('not twice')) {
    issueType = ISSUE_TYPES.REPEATED_WORD;
    rule = 'Repeated word';
    severity = SEVERITY.WARNING;
  }

  return enrichIssue({
    id: generateId(),
    url: block.url,
    context: sentenceAround(located || block.text, flaggedText),
    paragraph: block.text,
    flaggedText: source.includes('retext-repeated-words')
      ? (message.actual || reason).slice(0, 120)
      : flaggedText,
    issueType,
    suggestion,
    suggestions,
    message: reason,
    rule,
    location: block.location || block.element,
    element: block.element,
    offset: -1,
    length: flaggedText.length,
    severity,
  });
}

async function checkGrammar(blocks, config) {
  const issues = [];
  const processor = buildGrammarProcessor(config);

  for (const block of blocks) {
    if (!block.text || block.text.length < 10) continue;

    try {
      const file = await processor.process(block.text);
      const messages = file.messages || [];

      for (const message of messages) {
        const baseIssue = mapGrammarMessage(message, block);
        issues.push(baseIssue);
      }
    } catch {
      // Skip blocks that fail grammar processing
    }
  }

  return issues;
}

async function checkOffline(blocks, config) {
  const sentences = blocks.flatMap((block) => block.sentences || []);

  const spellingIssues = checkSpelling(sentences, config);
  const grammarIssues = await checkGrammar(blocks, config);
  const doubleSpaceIssues = checkDoubleSpaces(blocks);

  return limitReadabilityIssues([...spellingIssues, ...grammarIssues, ...doubleSpaceIssues]);
}

async function checkContent(blocks, config) {
  await ensureLocale(config.locale || 'en-GB');

  if (config.checkMode === CHECK_MODES.LANGUAGETOOL) {
    const ltIssues = await checkWithLanguageTool(blocks, config);
    const doubleSpaceIssues = checkDoubleSpaces(blocks);
    return [...ltIssues, ...doubleSpaceIssues];
  }

  return checkOffline(blocks, config);
}

module.exports = {
  initChecker,
  ensureLocale,
  checkContent,
  checkOffline,
  checkDoubleSpaces,
  tokeniseWords,
  wordForms,
  isDictionaryValid,
  enrichIssue,
  shouldSkipSpellingWord,
  spellingCandidates,
  stripTrailingApostrophe,
  limitReadabilityIssues,
  sentenceAround,
};
