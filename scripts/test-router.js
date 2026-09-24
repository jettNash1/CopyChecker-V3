const assert = require('assert');
const { resolvePageCheck, CHECK_KINDS, parseAddressList, decisionsForLanguages } = require('../src/main/page-plan');
const { isTooManyRedirects, redirectOutcome, promptAnswer, REDIRECT_MESSAGE } = require('../src/main/fetcher');

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

test('a /fr/ address uses French LangCheck', () => {
  const actual = resolvePageCheck('https://example.com/fr/about');
  assert.strictEqual(actual.code, 'fra');
  assert.strictEqual(actual.kind, CHECK_KINDS.LANGCHECK);
  assert.strictEqual(actual.source, 'url');
  assert.strictEqual(actual.summary, 'French, from the address');
});

test('an address with no language uses English spelling', () => {
  const actual = resolvePageCheck('https://example.com/about');
  assert.strictEqual(actual.code, 'eng');
  assert.strictEqual(actual.kind, CHECK_KINDS.SPELLING);
  assert.strictEqual(actual.source, 'fallback');
  assert.strictEqual(actual.summary, 'English');
});

test('a de.example.com address uses German', () => {
  const actual = resolvePageCheck('https://de.example.com/');
  assert.strictEqual(actual.code, 'deu');
  assert.strictEqual(actual.kind, CHECK_KINDS.LANGCHECK);
  assert.strictEqual(actual.source, 'url');
  assert.strictEqual(actual.summary, 'German, from the address');
});

test('an /en/ address uses English spelling', () => {
  const actual = resolvePageCheck('https://example.com/en/pricing');
  assert.strictEqual(actual.code, 'eng');
  assert.strictEqual(actual.kind, CHECK_KINDS.SPELLING);
  assert.strictEqual(actual.source, 'url');
  assert.strictEqual(actual.summary, 'English, from the address');
});

test('invalid lines are reported with their line number', () => {
  const actual = parseAddressList('https://example.com\nnot a url\n');
  assert.strictEqual(actual.errors.length, 1);
  assert.strictEqual(actual.errors[0].line, 2);
  assert.strictEqual(actual.valid[0], 'https://example.com/');
});

test('a chosen country checks English spelling and French unexpected English', () => {
  const actual = decisionsForLanguages(['eng', 'fra']);
  assert.strictEqual(actual[0].kind, CHECK_KINDS.SPELLING);
  assert.strictEqual(actual[0].label, 'English');
  assert.strictEqual(actual[1].kind, CHECK_KINDS.LANGCHECK);
  assert.strictEqual(actual[1].label, 'French');
});

test('too many redirects are retried in the browser, then reported plainly', () => {
  const error = { message: 'Maximum number of redirects exceeded' };
  assert.strictEqual(isTooManyRedirects(error), true);
  assert.strictEqual(redirectOutcome(error, false), 'browser');
  assert.strictEqual(redirectOutcome(error, true), 'fail');
  assert.strictEqual(REDIRECT_MESSAGE, 'This address redirects too many times.');
});

test('a username prompt is answered before the password prompt', () => {
  const used = { username: false, password: false };
  assert.strictEqual(promptAnswer('Enter username', 'ada', 'secret', used), 'ada');
  assert.strictEqual(promptAnswer('Enter password', 'ada', 'secret', used), 'secret');
});

test('a blank list asks for an address', () => {
  const actual = parseAddressList(' \n ');
  assert.deepStrictEqual(actual.valid, []);
  assert.strictEqual(actual.errors[0].message, 'Enter at least one page address.');
});

async function testIssueRows() {
  const {
    buildIssueRows,
    filterIssueRows,
    groupIntoSections,
    highlightSpans,
    elementLabel,
    locationUrl,
    sortIssueRows,
    toClientRows,
    toExportCsv,
    toExportText,
  } = await import('../src/renderer/issue-rows.js');

  const pages = [
    {
      url: 'https://example.com/a',
      error: null,
      issues: [
        { flaggedText: 'Recieve', message: 'Spelling', suggestion: 'receive', issueType: 'Spelling', context: 'Please Recieve this.' },
      ],
    },
    {
      url: 'https://example.com/b',
      error: null,
      issues: [
        { flaggedText: 'recieve', message: 'Spelling', suggestion: 'receive', issueType: 'Spelling', context: 'Please recieve that.' },
        { flaggedText: 'the the', message: 'Repeated word', suggestion: '', issueType: 'Grammar: Repeated word', context: 'See the the notes.' },
        { flaggedText: 'Settings', message: 'English word', suggestion: '', issueType: 'Translation: Unexpected English (word)' },
        { flaggedText: 'was written', message: 'Use active voice', suggestion: '', issueType: 'Grammar: Passive voice' },
        { flaggedText: 'This sentence is hard', message: 'Hard to read', suggestion: '', issueType: 'Grammar: Readability' },
      ],
    },
    {
      url: 'https://example.com/missing',
      error: 'Could not load this page.',
      issues: [],
    },
  ];

  test('the same word and description on two pages is one row', () => {
    const rows = buildIssueRows(pages);
    const spelling = rows.find((row) => row.word.toLowerCase() === 'recieve');
    assert.ok(spelling);
    assert.deepStrictEqual(spelling.places.map((place) => place.url), ['https://example.com/a', 'https://example.com/b']);
    assert.strictEqual(spelling.places[0].quote, 'Please Recieve this.');
    assert.strictEqual(spelling.description, 'Spelling Suggestion: receive');
    assert.strictEqual(rows[0].word.toLowerCase(), 'recieve');
  });

  test('a failed page is its own row with no word', () => {
    const rows = buildIssueRows(pages);
    const failedPage = rows.find((row) => row.description === 'Could not load this page.');
    assert.deepStrictEqual(failedPage.places.map((place) => place.url), ['https://example.com/missing']);
    assert.strictEqual(failedPage.word, '');
  });

  test('search matches the address, word, or description', () => {
    const rows = buildIssueRows(pages);
    assert.strictEqual(filterIssueRows(rows, 'settings').length, 1);
    assert.strictEqual(filterIssueRows(rows, 'example.com/missing').length, 1);
    assert.strictEqual(filterIssueRows(rows, 'suggestion: receive').length, 1);
  });

  test('issues open in spelling, readability, and passive sections', () => {
    const titles = groupIntoSections(buildIssueRows(pages)).map((section) => section.title);
    assert.deepStrictEqual(titles, [
      'Pages that could not be checked',
      'Pure spelling mistakes',
      'Unexpected hard to read sentences',
      'Unexpected use of passive voice',
      'Unexpected English',
      'Repeated words and double spaces',
    ]);
  });

  test('each section keeps its own sort', () => {
    const rows = buildIssueRows(pages).filter((row) => row.issueType === 'Spelling');
    const sorted = sortIssueRows(rows, { field: 'word', direction: 'asc' });
    assert.strictEqual(sorted[0].word, 'Recieve');
  });

  test('the element under a result is the tag, and the path can be expanded', () => {
    const path = 'html > body > div#consent > p#privacy-note';
    assert.strictEqual(elementLabel(path), '<p id="privacy-note"></p>');
    assert.ok(path.includes(' > '));
  });

  test('the flagged word is marked inside its sentence', () => {
    const spans = highlightSpans('Please Recieve this form.', 'Recieve');
    assert.deepStrictEqual(spans.filter((span) => span.marked).map((span) => span.text), ['Recieve']);
  });

  test('a result link jumps to the sentence around the word', () => {
    assert.strictEqual(
      locationUrl('https://example.com/a', 'Recieve', 'Please Recieve this.'),
      'https://example.com/a#:~:text=Please-,Recieve,-this.',
    );
    assert.strictEqual(
      locationUrl('https://example.com/missing', '', ''),
      'https://example.com/missing',
    );
  });

  test('the excel rows keep the section, element, and paragraph for each page', () => {
    const clientRows = toClientRows(groupIntoSections(buildIssueRows(pages)));
    const spelling = clientRows.find((row) => row.word === 'Recieve');
    assert.strictEqual(spelling.section, 'Pure spelling mistakes');
    assert.strictEqual(spelling.url, 'https://example.com/a');
    assert.strictEqual(spelling.paragraph, 'Please Recieve this.');
    assert.ok(spelling.link.includes('#:~:text='));
  });

  test('text and csv exports use one line per visible row', () => {
    const rows = filterIssueRows(buildIssueRows(pages), 'recieve');
    assert.strictEqual(
      toExportText(rows),
      'https://example.com/a | https://example.com/b\tRecieve\tSpelling Suggestion: receive\tPlease Recieve this. | Please recieve that.',
    );
    assert.strictEqual(
      toExportCsv(rows),
      'URL,Word at issue,Description and the paragraph it’s in,Paragraph\nhttps://example.com/a | https://example.com/b,Recieve,Spelling Suggestion: receive,Please Recieve this. | Please recieve that.',
    );
  });
}

testIssueRows().then(() => {
  if (failed > 0) process.exit(1);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
