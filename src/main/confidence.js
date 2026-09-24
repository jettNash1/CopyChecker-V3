const path = require('path');
const fs = require('fs');
const { ISSUE_TYPES } = require('../shared/constants');

const GEO_PREPOSITIONS = new Set([
  'in', 'at', 'near', 'from', 'to', 'across', 'outside', 'into', 'through',
  'around', 'via', 'between', 'within', 'along', 'towards', 'toward',
]);

const NAME_PARTICLES = new Set([
  'la', 'le', 'el', 'de', 'du', 'des', 'van', 'von', 'st', 'ste', 'saint',
  'san', 'santa', 'los', 'las', 'del', 'da', 'di', 'der', 'den', 'ten', 'ter',
  'mc', 'mac', "o'", "d'", 'l',
]);

const COMMON_TYPOS = new Set([
  'teh', 'recieved', 'occured', 'occurence', 'seperate', 'definately',
  'accomodate', 'occassion', 'neccessary', 'wierd', 'beleive', 'goverment',
  'enviroment', 'untill', 'sucessful', 'succesful', 'sentance', 'mispelling',
  'adress', 'calender', 'collegue', 'commited', 'concious', 'embarass',
  'existance', 'foriegn', 'harrass', 'independant', 'liason', 'maintainance',
  'millenium', 'noticable', 'paralell', 'persistant', 'priviledge', 'recomend',
  'refered', 'relevent', 'resistence', 'tommorow', 'truely', 'wether',
]);

let placeNameSet = null;

function loadPlaceNames() {
  if (placeNameSet) return placeNameSet;

  try {
    const placesPath = path.join(__dirname, '../shared/common-places.json');
    const raw = fs.readFileSync(placesPath, 'utf-8');
    const places = JSON.parse(raw);
    placeNameSet = new Set(places.map((p) => p.toLowerCase()));
  } catch {
    placeNameSet = new Set();
  }

  return placeNameSet;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[m][n];
}

function isTitleCase(word) {
  return /^[A-Z][a-z]+$/.test(word);
}

function isCapitalizedNotStart(word, wordIndex) {
  if (wordIndex === 0) return false;
  return /^[A-Z]/.test(word) && !/^[A-Z]+$/.test(word);
}

function isConsecutiveCapitalizedBigram(words, wordIndex) {
  if (wordIndex === 0) return false;
  const prev = words[wordIndex - 1];
  const curr = words[wordIndex];
  return /^[A-Z]/.test(prev) && /^[A-Z]/.test(curr);
}

function isPossessiveOnlySuggestion(word, suggestion) {
  if (!suggestion) return false;
  const wLower = word.toLowerCase();
  const sLower = suggestion.toLowerCase();
  return sLower === `${wLower}'s` || sLower === `${wLower}s`
    || wLower === `${sLower}'s` || wLower === `${sLower}s`;
}

function isCaseOnlySuggestion(word, suggestion) {
  if (!suggestion) return false;
  return word.toLowerCase() === suggestion.toLowerCase() && word !== suggestion;
}

function confidenceLabelFromScore(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreSpellingIssue(issue, context) {
  let score = 100;
  const reasons = [];
  const { word, wordIndex, words, sentence } = context;
  const suggestion = issue.suggestion || '';
  const prevWord = wordIndex > 0 ? words[wordIndex - 1] : null;
  const prevLower = prevWord ? prevWord.toLowerCase().replace(/'/g, '') : '';

  if (isCapitalizedNotStart(word, wordIndex)) {
    score -= 25;
    reasons.push('capitalized_mid_sentence');
  }

  if (prevWord && GEO_PREPOSITIONS.has(prevLower)) {
    score -= 20;
    reasons.push('geo_preposition_context');
    if (isCapitalizedNotStart(word, wordIndex)) {
      score -= 20;
      reasons.push('geo_proper_noun_pattern');
    }
  }

  if (prevWord && NAME_PARTICLES.has(prevLower)) {
    score -= 30;
    reasons.push('name_particle_context');
  }

  if (isConsecutiveCapitalizedBigram(words, wordIndex)) {
    score -= 25;
    reasons.push('consecutive_capitalized');
  }

  if (sentence.isHeadline && isTitleCase(word)) {
    score -= 15;
    reasons.push('headline_title_case');
  }

  if (isPossessiveOnlySuggestion(word, suggestion)) {
    score -= 35;
    reasons.push('possessive_only_suggestion');
  }

  if (isCaseOnlySuggestion(word, suggestion)) {
    score -= 40;
    reasons.push('case_only_suggestion');
  }

  if (suggestion && levenshtein(word.toLowerCase(), suggestion.toLowerCase()) === 1 && word.length <= 4) {
    score -= 15;
    reasons.push('short_word_ambiguity');
  }

  const places = loadPlaceNames();
  if (places.has(word.toLowerCase())) {
    score -= 30;
    reasons.push('known_place_name');
  }

  if ((sentence.wordCount || words.length) < 4) {
    score -= 10;
    reasons.push('short_sentence');
  }

  if (sentence.element === 'p' || sentence.element === 'li') {
    if (word === word.toLowerCase()) {
      score += 10;
      reasons.push('lowercase_body_text');
    }
  }

  if (suggestion && levenshtein(word.toLowerCase(), suggestion.toLowerCase()) >= 3) {
    score += 10;
    reasons.push('high_edit_distance');
  }

  if (COMMON_TYPOS.has(word.toLowerCase())) {
    score += 15;
    reasons.push('common_typo_pattern');
  }

  const finalScore = clampScore(score);
  return {
    confidence: finalScore,
    confidenceLabel: confidenceLabelFromScore(finalScore),
    confidenceReasons: reasons,
  };
}

function scoreGrammarIssue(issue, sentence) {
  let score = 100;
  const reasons = [];

  if (issue.issueType === ISSUE_TYPES.READABILITY && sentence.isHeadline) {
    score -= 40;
    reasons.push('readability_in_headline');
  }

  if ((sentence.wordCount || 0) < 8) {
    score -= 20;
    reasons.push('short_sentence_grammar');
  }

  if (issue.issueType === ISSUE_TYPES.PASSIVE_VOICE && sentence.isHeadline) {
    score -= 15;
    reasons.push('passive_in_headline');
  }

  if (issue.issueType === ISSUE_TYPES.REPEATED_WORD) {
    score += 5;
    reasons.push('repeated_word_high_signal');
  }

  const finalScore = clampScore(score);
  return {
    confidence: finalScore,
    confidenceLabel: confidenceLabelFromScore(finalScore),
    confidenceReasons: reasons,
  };
}

function applyConfidence(issue, context) {
  const scoring = issue.issueType === ISSUE_TYPES.SPELLING
    ? scoreSpellingIssue(issue, context)
    : scoreGrammarIssue(issue, context.sentence || context);

  return {
    ...issue,
    ...scoring,
  };
}

module.exports = {
  applyConfidence,
  scoreSpellingIssue,
  scoreGrammarIssue,
  confidenceLabelFromScore,
  loadPlaceNames,
  levenshtein,
  COMMON_TYPOS,
  GEO_PREPOSITIONS,
  NAME_PARTICLES,
};
