const cheerio = require('cheerio');
const { DEFAULT_CONTENT_TAGS, DEFAULT_IGNORE_TAGS } = require('../shared/defaultConfig');

const SPA_ROOT_SELECTORS = ['#root', '#app', '#__next', '#__nuxt'];
const MIN_CONTENT_CHARS = 80;
const EMPTY_SPA_ROOT_CHARS = 40;

function isSparseHtml(html) {
  if (!html || typeof html !== 'string') return true;

  const $ = cheerio.load(html);
  $(DEFAULT_IGNORE_TAGS.join(',')).remove();

  const contentText = DEFAULT_CONTENT_TAGS
    .map((tag) => $(tag).text())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (contentText.length >= MIN_CONTENT_CHARS) return false;

  const hasEmptySpaRoot = SPA_ROOT_SELECTORS.some((selector) => {
    const el = $(selector);
    if (!el.length) return false;
    const text = el.text().replace(/\s+/g, ' ').trim();
    return text.length < EMPTY_SPA_ROOT_CHARS;
  });

  return hasEmptySpaRoot || contentText.length < MIN_CONTENT_CHARS;
}

module.exports = {
  isSparseHtml,
  SPA_ROOT_SELECTORS,
  MIN_CONTENT_CHARS,
};
