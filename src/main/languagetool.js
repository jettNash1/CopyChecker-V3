const axios = require('axios');
const { SEVERITY, ISSUE_TYPES, CHECK_MODES } = require('../shared/constants');

const DEFAULT_LT_URL = 'https://api.languagetool.org/v2/check';
const LT_DELAY_MS = 100;

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldIncludeMatch(match, blockText) {
  const ruleId = (match.rule?.id || '').toLowerCase();
  const message = (match.message || '').toLowerCase();
  const description = (match.rule?.description || '').toLowerCase();
  const categoryId = (match.rule?.category?.id || '').toLowerCase();

  const isWhitespaceIssue = ruleId.includes('whitespace')
    || message.includes('whitespace')
    || description.includes('whitespace')
    || categoryId.includes('typography');

  if (isWhitespaceIssue) return false;

  if (ruleId.includes('uppercase_sentence_start')) {
    const offset = match.context?.offset ?? 0;
    const precedingText = blockText.slice(0, offset);
    const lastChar = precedingText.trim().slice(-1);
    if (lastChar && !'.!?'.includes(lastChar)) {
      return false;
    }
  }

  return true;
}

function mapCategoryToIssueType(match) {
  const categoryId = (match.rule?.category?.id || '').toUpperCase();
  const ruleId = (match.rule?.id || '').toUpperCase();

  if (categoryId.includes('TYPOS') || ruleId.includes('MORFOLOGIK') || ruleId.includes('SPELL')) {
    return ISSUE_TYPES.SPELLING;
  }
  if (categoryId.includes('GRAMMAR')) {
    return ISSUE_TYPES.GRAMMAR;
  }
  if (categoryId.includes('STYLE') || categoryId.includes('REDUNDANCY')) {
    return ISSUE_TYPES.STYLE;
  }
  return ISSUE_TYPES.GRAMMAR;
}

function mapCategoryToSeverity(issueType) {
  if (issueType === ISSUE_TYPES.SPELLING) return SEVERITY.ERROR;
  if (issueType === ISSUE_TYPES.STYLE) return SEVERITY.INFO;
  return SEVERITY.WARNING;
}

function findFlaggedTextOffset(blockText, flaggedText, contextText, contextOffset) {
  if (!blockText || !flaggedText) return -1;

  let idx = blockText.indexOf(flaggedText);
  if (idx >= 0) return idx;

  idx = blockText.toLowerCase().indexOf(flaggedText.toLowerCase());
  if (idx >= 0) return idx;

  if (contextText && typeof contextOffset === 'number' && contextOffset >= 0) {
    const snippetIndex = blockText.indexOf(contextText);
    if (snippetIndex >= 0) {
      return snippetIndex + contextOffset;
    }
  }

  return -1;
}

function mapMatchToIssue(match, block) {
  const contextText = match.context?.text || block.text;
  const contextOffset = match.context?.offset ?? 0;
  const contextLength = match.context?.length ?? 0;
  const flaggedText = contextText.substring(contextOffset, contextOffset + contextLength);
  const blockOffset = findFlaggedTextOffset(block.text, flaggedText, contextText, contextOffset);
  const suggestions = (match.replacements || [])
    .map((r) => r.value)
    .filter(Boolean)
    .slice(0, 5);
  const issueType = mapCategoryToIssueType(match);

  return {
    id: generateId(),
    url: block.url,
    context: block.text,
    flaggedText,
    issueType,
    suggestion: suggestions[0] || '',
    suggestions,
    message: match.message || '',
    rule: match.rule?.description || match.rule?.id || '',
    location: block.location || block.element,
    element: block.element,
    offset: blockOffset,
    length: flaggedText.length,
    severity: mapCategoryToSeverity(issueType),
  };
}

async function checkTextWithLanguageTool(text, config, blockContext = null) {
  const url = config.languageToolUrl || DEFAULT_LT_URL;
  const language = config.locale === 'en-US' ? 'en-US' : 'en-GB';

  const response = await axios.post(
    url,
    new URLSearchParams({
      text,
      language,
      enabledOnly: 'false',
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: config.fetchTimeoutMs || 30000,
    },
  );

  const matches = response.data?.matches || [];
  return matches
    .filter((match) => shouldIncludeMatch(match, text))
    .map((match) => mapMatchToIssue(match, blockContext || { text, url: '', element: '', location: '' }));
}

async function checkBlockWithLanguageTool(block, config) {
  const maxChars = config.languageToolMaxChars || 20000;
  const text = block.text.slice(0, maxChars);

  if (!text.trim()) return [];

  try {
    const issues = await checkTextWithLanguageTool(text, config, block);
    return issues.map((issue) => ({
      ...issue,
      url: block.url,
      location: block.location || block.element,
      element: block.element,
      context: block.text,
    }));
  } catch (error) {
    return [{
      id: generateId(),
      url: block.url,
      context: block.text.slice(0, 120),
      flaggedText: block.url,
      issueType: 'LanguageTool error',
      suggestion: '',
      message: error.response?.data?.message || error.message || 'LanguageTool request failed',
      rule: 'API error',
      location: block.location || block.element,
      element: block.element,
      severity: SEVERITY.ERROR,
    }];
  }
}

async function checkWithLanguageTool(blocks, config) {
  const issues = [];
  const delayMs = config.languageToolDelayMs ?? LT_DELAY_MS;

  for (let i = 0; i < blocks.length; i += 1) {
    const blockIssues = await checkBlockWithLanguageTool(blocks[i], config);
    issues.push(...blockIssues);

    if (i < blocks.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  return issues;
}

module.exports = {
  checkWithLanguageTool,
  checkTextWithLanguageTool,
  shouldIncludeMatch,
  mapMatchToIssue,
  mapCategoryToIssueType,
  findFlaggedTextOffset,
  CHECK_MODES,
};
