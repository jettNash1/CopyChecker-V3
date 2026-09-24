const assert = require('assert');
const { shouldSkipSpellingWord, spellingCandidates, stripTrailingApostrophe, limitReadabilityIssues } = require('../src/main/checker');
const { shouldSkipNamedOrHyphen } = require('../src/main/langcheck');

let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

test('a trailing apostrophe is grammar, not part of the word', () => {
  assert.strictEqual(stripTrailingApostrophe("countries'"), 'countries');
  assert.strictEqual(stripTrailingApostrophe('chemicals’'), 'chemicals');
});

test('only the ten longest hard sentences are kept', () => {
  const longSentences = Array.from({ length: 12 }, (_, index) => ({
    issueType: 'Grammar: Readability',
    context: `word ${'long '.repeat(40 + index)}end`,
  }));
  const kept = limitReadabilityIssues([
    ...longSentences,
    { issueType: 'Grammar: Readability', context: 'Too short to keep.' },
    { issueType: 'Spelling', context: 'Recieve', flaggedText: 'Recieve' },
  ]);
  assert.strictEqual(kept.filter((issue) => issue.issueType === 'Grammar: Readability').length, 10);
  assert.strictEqual(kept.filter((issue) => issue.issueType === 'Spelling').length, 1);
});

test('a hyphenated name is not checked', () => {
  assert.deepStrictEqual(spellingCandidates('Jean-Pierre', 1, ['met', 'Jean-Pierre']), []);
});

test('a lowercase typo is still checked', () => {
  const words = ['please', 'recieve', 'this'];
  assert.strictEqual(shouldSkipSpellingWord('recieve', 1, words), false);
  assert.deepStrictEqual(spellingCandidates('recieve', 1, words), ['recieve']);
});

test('a capitalised word in the middle of a sentence is skipped', () => {
  const words = ['The', 'Pleo', 'office'];
  assert.strictEqual(shouldSkipSpellingWord('Pleo', 1, words), true);
  assert.deepStrictEqual(spellingCandidates('Pleo', 1, words), []);
});

test('a hyphenated token is skipped on a translated page', () => {
  assert.strictEqual(shouldSkipNamedOrHyphen('Jean-Pierre', ['met', 'Jean-Pierre'], 1), true);
});

test('a lone capitalised word is still checked on a translated page', () => {
  assert.strictEqual(shouldSkipNamedOrHyphen('Settings', ['the', 'Settings', 'menu'], 1), false);
});

test('a capitalised word beside another capitalised word is skipped', () => {
  assert.strictEqual(shouldSkipNamedOrHyphen('Holdings', ['Acme', 'Holdings'], 1), true);
});

if (failed > 0) process.exit(1);
process.exit(0);
