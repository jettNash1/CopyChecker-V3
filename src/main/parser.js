const cheerio = require('cheerio');

const SMART_QUOTES = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u2013': '-',
  '\u2014': '-',
};

const DEFAULT_CONTENT_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'td', 'th', 'blockquote', 'figcaption', 'caption',
];

const BLOCK_NEST_TAGS = new Set([
  'article', 'section', 'div', 'aside', 'main', 'header', 'figure', 'ul', 'ol',
  'table', 'tbody', 'thead', 'tr', 'dl', 'form', 'fieldset',
]);

const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'e.g', 'i.e',
  'inc', 'ltd', 'st', 'ave', 'dept', 'no', 'fig', 'vol', 'pp', 'ed', 'eds',
]);

function normaliseText(text) {
  let result = text;
  for (const [from, to] of Object.entries(SMART_QUOTES)) {
    result = result.split(from).join(to);
  }
  return result.replace(/\s+/g, ' ').trim();
}

function splitIntoSentences(text) {
  const sentences = [];
  const parts = text.split(/(?<=[.!?])\s+(?=[A-Z"'])/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      sentences.push(trimmed);
    }
  }

  if (sentences.length === 0 && text.trim().length > 0) {
    sentences.push(text.trim());
  }

  return sentences;
}

function isLikelyAbbreviation(wordBeforePeriod) {
  const lower = wordBeforePeriod.toLowerCase().replace(/\.$/, '');
  return ABBREVIATIONS.has(lower) || (lower.length === 1 && /[a-z]/i.test(lower));
}

function extractInlineText($, el) {
  const parts = [];

  $(el).contents().each((_i, node) => {
    if (node.type === 'text') {
      const text = normaliseText($(node).text());
      if (text) parts.push(text);
      return;
    }

    if (node.type !== 'tag') return;

    const tag = node.tagName?.toLowerCase();
    if (BLOCK_NEST_TAGS.has(tag)) {
      return;
    }

    const nested = extractInlineText($, node);
    if (nested) parts.push(nested);
  });

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function getElementPath($, el) {
  const path = [];
  let current = el;

  while (current && current.type === 'tag') {
    let selector = current.tagName?.toLowerCase() || 'unknown';
    const id = $(current).attr('id');
    const className = $(current).attr('class');

    if (id) {
      selector += `#${id}`;
    } else if (className) {
      const classes = className.trim().split(/\s+/).filter(Boolean);
      if (classes.length > 0) {
        selector += `.${classes.join('.')}`;
      }
    }

    path.unshift(selector);
    current = current.parent;
  }

  return path.join(' > ');
}

function hasNestedContentTag($, el, contentTagSet) {
  let found = false;
  $(el).children().each((_i, child) => {
    const tag = child.tagName?.toLowerCase();
    if (contentTagSet.has(tag)) {
      found = true;
      return false;
    }
    if (hasNestedContentTag($, child, contentTagSet)) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}

function looksLikeMergedUiText(text) {
  if (/[a-z][A-Z]/.test(text)) return true;
  if (/Attribution[A-Z]/.test(text)) return true;
  if (/Posted\d|\d+h\d+|\d+ hours ago/i.test(text)) return true;
  if (/^Video,\s*\d{2}:\d{2}:\d{2}/.test(text)) return true;
  if ((text.match(/\d{2}:\d{2}/g) || []).length >= 2) return true;
  if (!/\s/.test(text) && /(?:[A-Z][a-z]+){3,}/.test(text)) return true;
  return false;
}

function sentenceMetadata(text, element) {
  const words = text.split(/\s+/).filter(Boolean);
  return {
    wordCount: words.length,
    isHeadline: /^h[1-6]$/.test(element),
  };
}

function parseHtml(html, url, config, { xmlMode = false } = {}) {
  const $ = cheerio.load(html, { xmlMode });

  for (const tag of config.ignoreTags || []) {
    $(tag).remove();
  }

  for (const selector of config.ignoreSelectors || []) {
    if (selector.trim()) {
      try {
        $(selector.trim()).remove();
      } catch {
        // Invalid selector — skip silently
      }
    }
  }

  const contentTags = config.contentTags?.length
    ? config.contentTags.map((t) => t.toLowerCase())
    : DEFAULT_CONTENT_TAGS;
  const contentTagSet = new Set(contentTags);

  const sentences = [];
  const blocks = [];
  const seen = new Set();

  $(contentTags.join(',')).each((_i, el) => {
    const tagName = el.tagName?.toLowerCase();
    if (!tagName || !contentTagSet.has(tagName)) return;

    if (hasNestedContentTag($, el, contentTagSet)) {
      return;
    }

    const text = extractInlineText($, el);
    if (!text || text.length < 2) return;
    if (looksLikeMergedUiText(text)) return;

    const location = getElementPath($, el);
    const blockKey = `${tagName}:${text}`;
    if (seen.has(blockKey)) return;
    seen.add(blockKey);

    const sentenceParts = splitIntoSentences(text).filter((s) => !looksLikeMergedUiText(s));
    const blockSentences = sentenceParts.map((sentence) => ({
      text: sentence,
      paragraph: text,
      element: tagName,
      url,
      location,
      ...sentenceMetadata(sentence, tagName),
    }));

    blocks.push({
      text,
      url,
      element: tagName,
      location,
      sentences: blockSentences,
    });

    sentences.push(...blockSentences);
  });

  return { sentences, blocks };
}

module.exports = {
  parseHtml,
  normaliseText,
  splitIntoSentences,
  isLikelyAbbreviation,
  getElementPath,
  DEFAULT_CONTENT_TAGS,
  looksLikeMergedUiText,
  extractInlineText,
};
