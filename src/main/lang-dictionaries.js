const nspell = require('nspell');

const DICTIONARY_PACKAGES = {
  fra: 'dictionary-fr',
  deu: 'dictionary-de',
  spa: 'dictionary-es',
  ita: 'dictionary-it',
  nld: 'dictionary-nl',
  por: 'dictionary-pt',
  swe: 'dictionary-sv',
  dan: 'dictionary-da',
  nor: 'dictionary-nb',
  ces: 'dictionary-cs',
  pol: 'dictionary-pl',
  hun: 'dictionary-hu',
  ron: 'dictionary-ro',
  tur: 'dictionary-tr',
  rus: 'dictionary-ru',
  ukr: 'dictionary-uk',
};

const spellCheckerCache = {};
const loadPromises = {};

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

function hasLanguageDictionary(code) {
  return Boolean(DICTIONARY_PACKAGES[code]);
}

async function ensureLanguageDictionary(code) {
  if (!hasLanguageDictionary(code)) {
    return null;
  }

  if (spellCheckerCache[code]) {
    return spellCheckerCache[code];
  }

  if (!loadPromises[code]) {
    loadPromises[code] = (async () => {
      const moduleName = DICTIONARY_PACKAGES[code];
      try {
        const dictModule = await import(moduleName);
        const dict = dictModule.default || dictModule;
        spellCheckerCache[code] = nspell(dict);
        return spellCheckerCache[code];
      } catch (error) {
        console.error(`Failed to load language dictionary ${moduleName}:`, error.message);
        spellCheckerCache[code] = null;
        return null;
      }
    })();
  }

  return loadPromises[code];
}

function isValidInChecker(spellChecker, word) {
  if (!spellChecker) return false;
  return wordForms(word).some((form) => spellChecker.correct(form));
}

function isValidInCheckerStrict(spellChecker, word) {
  if (!spellChecker) return false;
  const lower = word.toLowerCase();
  return spellChecker.correct(word) || spellChecker.correct(lower);
}

async function isValidInLanguage(word, code) {
  const checker = await ensureLanguageDictionary(code);
  if (!checker) return false;
  return isValidInCheckerStrict(checker, word);
}

module.exports = {
  DICTIONARY_PACKAGES,
  hasLanguageDictionary,
  ensureLanguageDictionary,
  isValidInLanguage,
  isValidInChecker,
  isValidInCheckerStrict,
  wordForms,
};
