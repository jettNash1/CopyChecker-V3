const ISSUE_RANK = {
  Spelling: 0,
  'Translation: Unexpected English (word)': 1,
  'Translation: Unexpected English (sentence)': 2,
  'Translation: Unexpected English (block)': 3,
  Grammar: 4,
  'Grammar: Repeated word': 5,
  'Grammar: Passive voice': 6,
  'Style: Double space': 7,
  Style: 8,
  'Grammar: Readability': 9,
};

const FETCH_RANK = 10;

function issueRank(issueType) {
  return ISSUE_RANK[issueType] ?? FETCH_RANK;
}

export function issueDescription(issue) {
  const message = issue.message || issue.issueType || 'Issue';
  if (!issue.suggestion) return message;
  return `${message} Suggestion: ${issue.suggestion}`;
}

export function buildIssueRows(pages) {
  const groups = new Map();

  for (const page of pages || []) {
    if (page.error) {
      addToGroup(groups, {
        url: page.url,
        word: '',
        quote: '',
        paragraph: '',
        description: page.error,
        issueType: 'Fetch error',
        rank: FETCH_RANK,
      });
      continue;
    }

    for (const issue of page.issues || []) {
      addToGroup(groups, {
        url: page.url,
        word: issue.flaggedText || '',
        quote: String(issue.context || '').replace(/\s+/g, ' ').trim(),
        paragraph: String(issue.paragraph || issue.context || '').replace(/\s+/g, ' ').trim(),
        element: String(issue.element || '').trim(),
        description: issueDescription(issue),
        issueType: issue.issueType || '',
        rank: issueRank(issue.issueType),
      });
    }
  }

  return [...groups.values()].sort((left, right) => (
    left.rank - right.rank || left.word.localeCompare(right.word)
  ));
}

function addPlace(places, item) {
  if (!item.url) return places;
  const quote = item.quote || '';
  const paragraph = item.paragraph || quote;
  const element = item.element || '';
  const already = places.some((place) => (
    place.url === item.url && place.quote === quote && place.element === element
  ));
  if (already) return places;
  return [...places, { url: item.url, quote, paragraph, element }];
}

function addToGroup(groups, item) {
  const key = `${item.word.toLowerCase()}|${item.description.toLowerCase()}`;
  const existing = groups.get(key);

  if (!existing) {
    groups.set(key, {
      id: key,
      word: item.word,
      description: item.description,
      issueType: item.issueType || '',
      places: addPlace([], item),
      rank: item.rank,
    });
    return;
  }

  existing.places = addPlace(existing.places, item);
  existing.rank = Math.min(existing.rank, item.rank);
}

export function filterIssueRows(rows, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return rows;

  return rows.filter((row) => (
    row.places.some((place) => (
      place.url.toLowerCase().includes(needle)
      || place.quote.toLowerCase().includes(needle)
      || String(place.paragraph || '').toLowerCase().includes(needle)
    ))
    || row.word.toLowerCase().includes(needle)
    || row.description.toLowerCase().includes(needle)
  ));
}

function encodeFragmentText(value) {
  return encodeURIComponent(value).replace(/-/g, '%2D');
}

function textFragment(quote, word) {
  const sentence = String(quote || '').replace(/\s+/g, ' ').trim();
  const needle = String(word || '').trim();
  if (!sentence && !needle) return '';
  if (!sentence) return encodeFragmentText(needle);
  if (!needle) return encodeFragmentText(sentence.slice(0, 80));

  const index = sentence.toLowerCase().indexOf(needle.toLowerCase());
  if (index < 0) return encodeFragmentText(sentence.slice(0, 80));

  const start = sentence.slice(index, index + needle.length);
  const prefix = sentence.slice(Math.max(0, index - 40), index).trim();
  const suffix = sentence.slice(index + needle.length, index + needle.length + 40).trim();
  if (prefix && suffix) {
    return `${encodeFragmentText(prefix)}-,${encodeFragmentText(start)},-${encodeFragmentText(suffix)}`;
  }
  if (prefix) return `${encodeFragmentText(prefix)}-,${encodeFragmentText(start)}`;
  if (suffix) return `${encodeFragmentText(start)},-${encodeFragmentText(suffix)}`;
  return encodeFragmentText(start);
}

export function highlightSpans(text, word) {
  const source = String(text || '');
  const needle = String(word || '').trim();
  if (!source || !needle) return [{ text: source, marked: false }];

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(needle.includes(' ') ? escaped : `\\b${escaped}\\b`, 'gi');
  const spans = [];
  let last = 0;

  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) spans.push({ text: source.slice(last, index), marked: false });
    spans.push({ text: match[0], marked: true });
    last = index + match[0].length;
  }

  if (last < source.length) spans.push({ text: source.slice(last), marked: false });
  return spans.length > 0 ? spans : [{ text: source, marked: false }];
}

export function elementLabel(path) {
  const last = String(path || '').split(' > ').map((part) => part.trim()).filter(Boolean).pop() || '';
  const idMatch = last.match(/^([a-z0-9]+)#([^.\s]+)/i);
  if (idMatch) return `<${idMatch[1]} id="${idMatch[2]}"></${idMatch[1]}>`;
  const classMatch = last.match(/^([a-z0-9]+)\.(.+)$/i);
  if (classMatch) {
    return `<${classMatch[1]} class="${classMatch[2].split('.').join(' ')}"></${classMatch[1]}>`;
  }
  if (/^[a-z0-9]+$/i.test(last)) return `<${last}></${last}>`;
  return last;
}

export function locationUrl(url, word, quote) {
  if (!url) return '';
  const fragment = textFragment(quote, word);
  if (!fragment) return url;
  return `${url}#:~:text=${fragment}`;
}

export function sortIssueRows(rows, sort) {
  if (!sort) return rows;
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftValue = sort.field === 'url'
      ? left.places.map((place) => place.url).join(' ')
      : left[sort.field];
    const rightValue = sort.field === 'url'
      ? right.places.map((place) => place.url).join(' ')
      : right[sort.field];
    return String(leftValue || '').localeCompare(String(rightValue || '')) * direction;
  });
}

const RESULT_SECTIONS = [
  { id: 'failed', title: 'Pages that could not be checked', types: ['Fetch error'] },
  { id: 'spelling', title: 'Pure spelling mistakes', types: ['Spelling'] },
  { id: 'readability', title: 'Unexpected hard to read sentences', types: ['Grammar: Readability'] },
  { id: 'passive', title: 'Unexpected use of passive voice', types: ['Grammar: Passive voice'] },
  {
    id: 'english',
    title: 'Unexpected English',
    types: [
      'Translation: Unexpected English (word)',
      'Translation: Unexpected English (sentence)',
      'Translation: Unexpected English (block)',
    ],
  },
  {
    id: 'style',
    title: 'Repeated words and double spaces',
    types: ['Grammar: Repeated word', 'Style: Double space', 'Style'],
  },
];

export function groupIntoSections(rows) {
  const assigned = new Set(RESULT_SECTIONS.flatMap((section) => section.types));
  const sections = RESULT_SECTIONS.map((section) => ({
    id: section.id,
    title: section.title,
    rows: rows.filter((row) => section.types.includes(row.issueType)),
  }));
  const other = {
    id: 'other',
    title: 'Other issues',
    rows: rows.filter((row) => !assigned.has(row.issueType)),
  };
  return [...sections, other].filter((section) => section.rows.length > 0);
}

export function urlsText(row) {
  return [...new Set(row.places.map((place) => place.url))].join(' | ');
}

export function quotesText(row) {
  return row.places.map((place) => place.quote).filter(Boolean).join(' | ');
}

export function toClientRows(sections) {
  return (sections || []).flatMap((section) => (section.rows || []).flatMap((row) => {
    const places = row.places?.length
      ? row.places
      : [{ url: '', quote: '', paragraph: '', element: '' }];
    return places.map((place) => ({
      section: section.title,
      url: place.url || '',
      element: elementLabel(place.element),
      path: place.element || '',
      word: row.word || '',
      description: row.description || '',
      paragraph: place.paragraph || place.quote || '',
      link: place.url ? locationUrl(place.url, row.word, place.quote || place.paragraph) : '',
    }));
  }));
}

export function toExportText(rows) {
  return rows
    .map((row) => [urlsText(row), row.word, row.description, quotesText(row)].join('\t'))
    .join('\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toExportCsv(rows) {
  const header = ['URL', 'Word at issue', 'Description and the paragraph it’s in', 'Paragraph'];
  const lines = [
    header.map(csvCell).join(','),
    ...rows.map((row) => [urlsText(row), row.word, row.description, quotesText(row)].map(csvCell).join(',')),
  ];
  return lines.join('\n');
}
