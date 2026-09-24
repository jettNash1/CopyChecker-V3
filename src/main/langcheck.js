const { franc } = require('franc');
const { SEVERITY, LANGCHECK_ISSUE_TYPES } = require('../shared/constants');
const {
  ensureLocale,
  enrichIssue,
  isDictionaryValid,
} = require('./checker');
const { splitIntoSentences } = require('./parser');
const { resolveExpectedLanguage, getLanguageLabel } = require('./url-locale');
const {
  hasLanguageDictionary,
  ensureLanguageDictionary,
  isValidInLanguage,
} = require('./lang-dictionaries');

const STANDALONE_LATIN_WORD = /(?<![\p{L}\p{N}])[A-Za-z][A-Za-z'-]*(?![\p{L}\p{N}])/gu;

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function tokeniseStandaloneLatinWords(text) {
  if (!text) return [];
  const matches = text.match(STANDALONE_LATIN_WORD);
  return matches || [];
}

function isEnglishText(text, francMinLength) {
  if (!text || text.length < francMinLength) {
    return false;
  }
  return franc(text, { minLength: francMinLength }) === 'eng';
}

function isAllowlisted(word, allowList) {
  const lower = word.toLowerCase();
  return (allowList || []).some((entry) => entry.toLowerCase() === lower);
}

function shouldSkipNamedOrHyphen(word, words, index) {
  if (word.includes('-')) return true;
  if (!/^[A-Z]/.test(word)) return false;
  const prev = index > 0 ? words[index - 1] : '';
  const next = index + 1 < words.length ? words[index + 1] : '';
  return /^[A-Z]/.test(prev) || /^[A-Z]/.test(next);
}

function shouldSkipWord(word, config) {
  if (word.length < (config.minWordLength || 3)) return true;
  if (/\d/.test(word)) return true;
  if (/^[A-Z]{2,4}$/.test(word)) return true;
  if (isAllowlisted(word, config.allowList)) return true;
  return false;
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

function createLocaleFallbackIssue(url, meta) {
  return enrichIssue({
    id: generateId(),
    url,
    context: '',
    flaggedText: `No URL locale (${meta.label})`,
    issueType: LANGCHECK_ISSUE_TYPES.LOCALE_FALLBACK,
    suggestion: '',
    suggestions: [],
    message: `Could not detect locale from URL; checked against ${meta.label} (default)`,
    rule: 'langcheck/locale-fallback',
    location: '',
    element: '',
    offset: -1,
    length: 0,
    severity: SEVERITY.INFO,
  });
}

function createEnglishPageIssue(url) {
  return enrichIssue({
    id: generateId(),
    url,
    context: '',
    flaggedText: 'English page',
    issueType: LANGCHECK_ISSUE_TYPES.ENGLISH_PAGE,
    suggestion: '',
    suggestions: [],
    message: 'No locale in URL; page content appears to be English — LangCheck skipped for this URL',
    rule: 'langcheck/content-english',
    location: '',
    element: '',
    offset: -1,
    length: 0,
    severity: SEVERITY.INFO,
  });
}

function createWordIssue(block, word, offset, expectedLabel, suggestion) {
  return enrichIssue({
    id: generateId(),
    url: block.url,
    context: block.text,
    flaggedText: word,
    issueType: LANGCHECK_ISSUE_TYPES.ENGLISH_WORD,
    suggestion,
    suggestions: [suggestion],
    message: `English word detected; page expected ${expectedLabel}`,
    rule: 'langcheck/english-word',
    location: block.location || block.element,
    element: block.element,
    offset,
    length: word.length,
    severity: SEVERITY.WARNING,
  });
}

function createSentenceIssue(block, sentenceText, expectedLabel, suggestion) {
  return enrichIssue({
    id: generateId(),
    url: block.url,
    context: block.text,
    flaggedText: sentenceText,
    issueType: LANGCHECK_ISSUE_TYPES.ENGLISH_SENTENCE,
    suggestion,
    suggestions: [suggestion],
    message: `Detected English sentence; page expected ${expectedLabel}`,
    rule: 'langcheck/franc-sentence',
    location: block.location || block.element,
    element: block.element,
    offset: block.text.indexOf(sentenceText),
    length: sentenceText.length,
    severity: SEVERITY.WARNING,
  });
}

function createBlockIssue(block, expectedLabel, suggestion) {
  return enrichIssue({
    id: generateId(),
    url: block.url,
    context: block.text,
    flaggedText: block.text.length > 200 ? `${block.text.slice(0, 200)}…` : block.text,
    issueType: LANGCHECK_ISSUE_TYPES.ENGLISH_BLOCK,
    suggestion,
    suggestions: [suggestion],
    message: `Detected English block; page expected ${expectedLabel}`,
    rule: 'langcheck/franc-block',
    location: block.location || block.element,
    element: block.element,
    offset: 0,
    length: block.text.length,
    severity: SEVERITY.ERROR,
  });
}

function getBlockSentences(block) {
  if (block.sentences?.length) {
    return block.sentences.map((sentence) => sentence.text);
  }
  return splitIntoSentences(block.text);
}

function groupBlocksByUrl(blocks) {
  const map = new Map();

  for (const block of blocks) {
    if (!block.url) continue;
    if (!map.has(block.url)) {
      map.set(block.url, []);
    }
    map.get(block.url).push(block);
  }

  return map;
}

function detectLanguageFromContent(blocksForUrl, config) {
  const francMinLength = config.francMinLength || 10;
  const minContentLength = config.minContentDetectLength || config.minBlockLength || 40;
  const text = blocksForUrl.map((block) => block.text).filter(Boolean).join(' ').trim();

  if (text.length < minContentLength) {
    return null;
  }

  const code = franc(text, { minLength: francMinLength });
  if (!code || code === 'und') {
    return null;
  }

  return code;
}

function buildUrlLanguageMap(blocks, config) {
  const map = new Map();
  const blocksByUrl = groupBlocksByUrl(blocks);

  for (const [url, urlBlocks] of blocksByUrl) {
    let meta = resolveExpectedLanguage(url, config);

    if (config.languageMode === 'from-url' && meta.source === 'fallback') {
      const contentCode = detectLanguageFromContent(urlBlocks, config);
      if (contentCode === 'eng') {
        meta = {
          code: 'eng',
          source: 'content-english',
          label: 'English',
        };
      }
    }

    map.set(url, meta);
  }

  return map;
}

function shouldSkipLangCheck(meta) {
  return meta?.code === 'eng' || meta?.source === 'content-english';
}

function resolveBlockLanguage(block, urlLanguageMap, config) {
  if (block.url && urlLanguageMap.has(block.url)) {
    return urlLanguageMap.get(block.url);
  }

  const code = config.expectedLanguage || 'fra';
  return {
    code,
    source: config.languageMode === 'manual' ? 'manual' : 'fallback',
    label: getLanguageLabel(code),
  };
}

async function isUnexpectedEnglishWord(word, expectedCode) {
  if (!isDictionaryValid(word)) {
    return false;
  }

  if (hasLanguageDictionary(expectedCode)) {
    const validInExpected = await isValidInLanguage(word, expectedCode);
    if (validInExpected) {
      return false;
    }
  }

  return true;
}

async function preloadLanguageDictionaries(codes) {
  const unique = [...new Set(codes.filter(hasLanguageDictionary))];
  await Promise.all(unique.map((code) => ensureLanguageDictionary(code)));
}

async function checkLangContent(blocks, config) {
  await ensureLocale(config.englishVariant || 'en-GB');

  const levels = config.detectionLevels || { words: true, sentences: true, blocks: true };
  const francMinLength = config.francMinLength || 10;
  const issues = [];
  const flaggedBlocks = new Set();
  const urlLanguageMap = buildUrlLanguageMap(blocks, config);

  if (config.languageMode === 'from-url') {
    for (const [url, meta] of urlLanguageMap) {
      if (meta.source === 'content-english') {
        issues.push(createEnglishPageIssue(url));
      } else if (meta.source === 'fallback') {
        issues.push(createLocaleFallbackIssue(url, meta));
      }
    }
  }

  const expectedCodes = [...new Set(
    blocks
      .map((block) => resolveBlockLanguage(block, urlLanguageMap, config))
      .filter((meta) => !shouldSkipLangCheck(meta))
      .map((meta) => meta.code),
  )];
  await preloadLanguageDictionaries(expectedCodes);

  if (levels.blocks) {
    for (const block of blocks) {
      const meta = resolveBlockLanguage(block, urlLanguageMap, config);
      if (shouldSkipLangCheck(meta)) continue;

      const expectedLabel = meta.label;
      const suggestion = `Translate to ${expectedLabel}`;

      if (!block.text || block.text.length < (config.minBlockLength || 40)) continue;
      if (isEnglishText(block.text, francMinLength)) {
        flaggedBlocks.add(block);
        issues.push(createBlockIssue(block, expectedLabel, suggestion));
      }
    }
  }

  if (levels.sentences) {
    for (const block of blocks) {
      const meta = resolveBlockLanguage(block, urlLanguageMap, config);
      if (shouldSkipLangCheck(meta)) continue;

      const expectedLabel = meta.label;
      const suggestion = `Translate to ${expectedLabel}`;

      if (config.suppressNestedWhenBlockFlagged !== false && flaggedBlocks.has(block)) continue;

      for (const sentenceText of getBlockSentences(block)) {
        if (!sentenceText || sentenceText.length < (config.minSentenceLength || 20)) continue;
        if (isEnglishText(sentenceText, francMinLength)) {
          issues.push(createSentenceIssue(block, sentenceText, expectedLabel, suggestion));
        }
      }
    }
  }

  if (levels.words) {
    for (const block of blocks) {
      const meta = resolveBlockLanguage(block, urlLanguageMap, config);
      if (shouldSkipLangCheck(meta)) continue;

      const expectedLabel = meta.label;
      const suggestion = `Translate to ${expectedLabel}`;
      const words = tokeniseStandaloneLatinWords(block.text);

      for (let i = 0; i < words.length; i += 1) {
        const word = words[i];
        if (shouldSkipWord(word, config) || shouldSkipNamedOrHyphen(word, words, i)) continue;

        const unexpected = await isUnexpectedEnglishWord(word, meta.code);
        if (!unexpected) continue;

        if (
          config.suppressNestedWhenBlockFlagged !== false
          && flaggedBlocks.has(block)
          && block.text.trim().toLowerCase() === word.toLowerCase()
        ) {
          continue;
        }

        const offset = findWordOffset(block.text, word, i, words);
        issues.push(createWordIssue(block, word, offset, expectedLabel, suggestion));
      }
    }
  }

  return issues;
}

module.exports = {
  checkLangContent,
  isEnglishText,
  shouldSkipWord,
  shouldSkipNamedOrHyphen,
  getLanguageLabel,
  tokeniseStandaloneLatinWords,
  isUnexpectedEnglishWord,
  detectLanguageFromContent,
  buildUrlLanguageMap,
  shouldSkipLangCheck,
};
