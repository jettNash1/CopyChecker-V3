import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseAddressList } from './addresses';
import { COUNTRIES, countryById } from './countries';
import {
  buildIssueRows,
  filterIssueRows,
  groupIntoSections,
  highlightSpans,
  elementLabel,
  locationUrl,
  sortIssueRows,
  toExportText,
} from './issue-rows';
import { buildExcelReport } from './excel-report';

const URLS_KEY = 'copychecker-v3-urls';
const LANGUAGE_KEY = 'copychecker-v3-language';
const ALLOWED_KEY = 'copychecker-v3-allowed-words';
const COUNTRY_KEY = 'copychecker-v3-country';
const COUNTRY_LANGUAGES_KEY = 'copychecker-v3-country-languages';
const PASSWORD_KEY = 'copychecker-v3-site-password';
const USERNAME_KEY = 'copychecker-v3-site-username';

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function outcomeText(pages, outcome) {
  const issues = pages.reduce((sum, page) => sum + page.issues.length, 0);
  const pagesLabel = countLabel(pages.length, 'page', 'pages');
  const issuesLabel = countLabel(issues, 'issue', 'issues');
  if (outcome === 'cancelled') {
    return `Stopped. ${pagesLabel} checked. ${issuesLabel}.`;
  }
  return `Checked ${pagesLabel}. ${issuesLabel}.`;
}

function progressText(progress) {
  if (!progress) return '';
  if (progress.status === 'started') {
    return `Starting ${countLabel(progress.total, 'page', 'pages')}`;
  }
  const position = `${progress.index + 1} of ${progress.total}`;
  if (progress.status === 'checking') return `Checking ${position}: ${progress.url}`;
  if (progress.status === 'page-done') {
    return `Checked ${progress.completed} of ${progress.total}`;
  }
  return `Loading ${position}: ${progress.url}`;
}

function downloadFile(filename, contents, type) {
  const blob = contents instanceof Blob ? contents : new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function BookmarkIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path d="M7 4.5h10a1 1 0 0 1 1 1V20l-6-3.5L6 20V5.5a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.2 2.4 3.3 5.1 3.3 8s-1.1 5.6-3.3 8c-2.2-2.4-3.3-5.1-3.3-8s1.1-5.6 3.3-8z" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="8" cy="14" r="3.2" />
      <path d="M11 14h9l-2 2M17 14v2" />
    </svg>
  );
}

const SIDE_MENU = [
  { id: 'flagged-words', label: 'Flagged words', Icon: BookmarkIcon },
  { id: 'country', label: 'Country', Icon: GlobeIcon },
  { id: 'site-password', label: 'Site password', Icon: KeyIcon },
];

function AddressErrors({ errors }) {
  if (errors.length === 0) return null;

  return (
    <div role="alert" className="rounded-md bg-sand px-4 py-3">
      <p className="font-semibold">Fix these addresses before running.</p>
      <ul className="mt-2 list-disc pl-5">
        {errors.map((error) => (
          <li key={`${error.line}-${error.url || error.message}`}>
            {error.line > 0 ? `Line ${error.line}: ` : ''}
            {error.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HighlightedText({ text, word }) {
  return highlightSpans(text, word).map((span, index) => (
    span.marked
      ? <mark key={index} className="bg-coral px-0.5">{span.text}</mark>
      : <span key={index}>{span.text}</span>
  ));
}

function ParagraphQuote({ place, word, showPage }) {
  const [open, setOpen] = useState(false);
  const sentence = place.quote || '';
  const paragraph = place.paragraph || sentence;
  const canExpand = Boolean(paragraph) && paragraph !== sentence;
  const shown = open && canExpand ? paragraph : sentence;
  if (!shown) return null;

  return (
    <div className="mt-2">
      {showPage ? <p className="break-all text-sm font-semibold">{place.url}</p> : null}
      <p className="text-sm">
        <HighlightedText text={shown} word={word} />
      </p>
      {canExpand ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="mt-1 text-sm font-semibold underline"
          aria-expanded={open}
        >
          {open ? 'Show the sentence' : 'Show the full paragraph'}
        </button>
      ) : null}
    </div>
  );
}

function ElementPath({ path }) {
  const [open, setOpen] = useState(false);
  const fullPath = String(path || '').trim();
  const label = elementLabel(fullPath);
  if (!label) return null;
  const canExpand = fullPath.includes(' > ');

  return (
    <div className="mt-1">
      <p className="font-mono text-sm">{label}</p>
      {canExpand ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="mt-1 text-sm font-semibold underline"
          aria-expanded={open}
        >
          {open ? 'Hide the full path' : 'Show the full path'}
        </button>
      ) : null}
      {open ? <p className="mt-1 break-all font-mono text-sm">{fullPath}</p> : null}
    </div>
  );
}

function UrlCell({ places, word }) {
  const label = word ? `Open the page at “${word}”` : 'Open this page';
  const links = places.map((place, index) => (
    <div key={`${place.url}-${index}`}>
      <a
        href={locationUrl(place.url, word, place.quote)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        className="break-all underline"
      >
        {place.url}
      </a>
      <ElementPath path={place.element} />
    </div>
  ));

  if (links.length <= 1) return links[0] || null;

  return (
    <details className="break-all">
      <summary className="inline-block cursor-pointer rounded-full bg-lilac px-2 py-0.5 text-sm">
        {countLabel(places.length, 'page', 'pages')}
      </summary>
      <ul className="mt-2 space-y-2">
        {links.map((link) => (
          <li key={link.key}>{link}</li>
        ))}
      </ul>
    </details>
  );
}

export function ResultsTable({ rows, onDismiss, onAllow, sort, onSort, caption = 'Check results' }) {
  const columns = [
    { id: 'url', label: 'URL' },
    { id: 'word', label: 'Word at issue' },
    { id: 'description', label: 'Description and the paragraph it’s in' },
  ];

  return (
    <div className="overflow-x-auto rounded-md border border-sand bg-paper text-ink">
      <table className="w-full border-collapse bg-paper text-left text-ink">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-lilac">
          <tr>
            {columns.map((column) => {
              const active = sort?.field === column.id;
              const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none';
              return (
                <th key={column.id} scope="col" aria-sort={ariaSort} className="px-3 py-2 font-semibold">
                  <button
                    type="button"
                    onClick={() => onSort(column.id)}
                    className="font-semibold underline-offset-2 hover:underline"
                  >
                    {column.label}
                    {active ? (sort.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              );
            })}
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">Dismiss</span>
            </th>
          </tr>
        </thead>
        <tbody className="bg-paper">
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-sand bg-paper align-top">
              <td className="px-3 py-3">
                <UrlCell places={row.places} word={row.word} />
              </td>
              <td className="px-3 py-3">
                {row.word ? <mark className="bg-coral px-1">{row.word}</mark> : null}
              </td>
              <td className="px-3 py-3">
                <p>{row.description}</p>
                {row.places.filter((place) => place.quote || place.paragraph).map((place, index) => (
                  <ParagraphQuote
                    key={`${place.url}-${index}`}
                    place={place}
                    word={row.word}
                    showPage={row.places.length > 1}
                  />
                ))}
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap gap-2">
                  {row.issueType === 'Spelling' && row.word ? (
                    <button
                      type="button"
                      onClick={() => onAllow(row.word)}
                      className="rounded-md border border-pine px-3 py-1 font-semibold text-pine hover:bg-coral"
                      aria-label={`Don't flag ${row.word} again`}
                    >
                      Don't flag this word
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onDismiss(row.id)}
                    className="rounded-md border border-pine px-3 py-1 font-semibold text-pine hover:bg-coral"
                    aria-label={row.word ? `Dismiss ${row.word}` : 'Dismiss this issue'}
                  >
                    Dismiss
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function App() {
  const [addresses, setAddresses] = useState('');
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const [errors, setErrors] = useState([]);
  const [progress, setProgress] = useState(null);
  const [pages, setPages] = useState([]);
  const [outcome, setOutcome] = useState(null);
  const [query, setQuery] = useState('');
  const [dismissedIds, setDismissedIds] = useState(() => new Set());
  const [allowedWords, setAllowedWords] = useState(() => new Set());
  const [sorts, setSorts] = useState({});
  const [runId, setRunId] = useState(0);
  const [menuId, setMenuId] = useState(null);
  const [countryId, setCountryId] = useState('');
  const [enabledLanguages, setEnabledLanguages] = useState([]);
  const [sitePassword, setSitePassword] = useState('');
  const [siteUsername, setSiteUsername] = useState('');
  const [exportError, setExportError] = useState('');
  const [activeLanguage, setActiveLanguage] = useState('');

  useEffect(() => {
    setAddresses(localStorage.getItem(URLS_KEY) || '');
    localStorage.removeItem(LANGUAGE_KEY);
    try {
      const stored = JSON.parse(localStorage.getItem(ALLOWED_KEY) || '[]');
      if (Array.isArray(stored)) {
        setAllowedWords(new Set(stored.map((word) => String(word).toLowerCase())));
      }
    } catch {
      setAllowedWords(new Set());
    }
    setCountryId(localStorage.getItem(COUNTRY_KEY) || '');
    try {
      const storedLanguages = JSON.parse(localStorage.getItem(COUNTRY_LANGUAGES_KEY) || '[]');
      if (Array.isArray(storedLanguages)) setEnabledLanguages(storedLanguages.map(String));
    } catch {
      setEnabledLanguages([]);
    }
    setSitePassword(localStorage.getItem(PASSWORD_KEY) || '');
    setSiteUsername(localStorage.getItem(USERNAME_KEY) || '');
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(URLS_KEY, addresses);
  }, [ready, addresses]);

  useEffect(() => {
    if (!window.copychecker) return undefined;

    return window.copychecker.onProgress((payload) => {
      setProgress(payload);
      if (payload.status === 'started') {
        setPages([]);
        setOutcome(null);
        setErrors([]);
        setQuery('');
        setDismissedIds(new Set());
        setRunId((current) => current + 1);
      }
      const incoming = payload.pages || (payload.page ? [payload.page] : []);
      if (payload.status !== 'page-done' || incoming.length === 0) return;

      setPages((current) => {
        const next = current.filter((page) => page.index !== incoming[0].index);
        next.push(...incoming);
        next.sort((left, right) => left.index - right.index || String(left.language).localeCompare(String(right.language)));
        return next;
      });
    });
  }, []);

  const languageTabs = useMemo(() => {
    const seen = [];
    for (const page of pages) {
      if (page.error || !page.language) continue;
      if (seen.some((item) => item.code === page.language)) continue;
      seen.push({ code: page.language, label: page.languageLabel || page.language });
    }
    return seen;
  }, [pages]);
  const selectedLanguage = languageTabs.some((item) => item.code === activeLanguage)
    ? activeLanguage
    : (languageTabs[0]?.code || '');
  const tabPages = languageTabs.length > 1
    ? pages.filter((page) => !page.error && page.language === selectedLanguage)
    : pages.filter((page) => !page.error);
  const failedPages = pages.filter((page) => page.error);
  const rows = useMemo(() => (
    buildIssueRows(tabPages).filter((row) => (
      row.issueType !== 'Spelling' || !allowedWords.has(row.word.toLowerCase())
    ))
  ), [tabPages, allowedWords]);
  const failedRows = useMemo(() => buildIssueRows(failedPages), [failedPages]);
  const visibleFailedRows = useMemo(() => filterIssueRows(failedRows, query), [failedRows, query]);
  const visibleRows = useMemo(() => {
    const kept = rows.filter((row) => !dismissedIds.has(row.id));
    return filterIssueRows(kept, query);
  }, [rows, dismissedIds, query]);
  const failedSections = useMemo(() => (
    groupIntoSections(visibleFailedRows).map((section) => ({
      ...section,
      rows: sortIssueRows(section.rows, sorts[section.id]),
    }))
  ), [visibleFailedRows, sorts]);
  const sections = useMemo(() => (
    groupIntoSections(visibleRows).map((section) => ({
      ...section,
      rows: sortIssueRows(section.rows, sorts[section.id]),
    }))
  ), [visibleRows, sorts]);

  const handleSubmit = useCallback(async (event) => {
    event.preventDefault();
    if (runningRef.current) return;

    setErrors([]);
    setProgress(null);

    const parsed = parseAddressList(addresses);
    if (parsed.errors.length > 0) {
      setErrors(parsed.errors);
      return;
    }

    if (!window.copychecker) {
      setErrors([{
        line: 0,
        url: '',
        message: 'Open the CopyChecker desktop window to run a check.',
      }]);
      return;
    }

    runningRef.current = true;
    setRunning(true);
    try {
      const result = await window.copychecker.run({
        addresses,
        allowList: [...allowedWords],
        languages: countryId ? enabledLanguages : [],
        siteUsername,
        sitePassword,
      });
      if (!result?.ok) {
        setErrors(result?.errors || [{
          line: 0,
          url: '',
          message: 'The check could not be started.',
        }]);
        return;
      }

      setPages(result.pages || []);
      setOutcome(result.cancelled ? 'cancelled' : 'done');
    } catch {
      setErrors([{
        line: 0,
        url: '',
        message: 'The check could not be started.',
      }]);
    } finally {
      runningRef.current = false;
      setRunning(false);
      setProgress(null);
    }
  }, [addresses, allowedWords, countryId, enabledLanguages, siteUsername, sitePassword]);

  const handleCancel = useCallback(() => {
    window.copychecker?.cancel();
  }, []);

  const handleSort = useCallback((sectionId, field) => {
    setSorts((current) => {
      const previous = current[sectionId];
      const next = !previous || previous.field !== field
        ? { field, direction: 'asc' }
        : { field, direction: previous.direction === 'asc' ? 'desc' : 'asc' };
      return { ...current, [sectionId]: next };
    });
  }, []);

  const handleAllow = useCallback((word) => {
    const saved = String(word || '').trim().toLowerCase();
    if (!saved) return;
    setAllowedWords((current) => {
      const next = new Set(current);
      next.add(saved);
      localStorage.setItem(ALLOWED_KEY, JSON.stringify([...next]));
      return next;
    });
    setMenuId('flagged-words');
  }, []);

  const handleCountry = useCallback((id) => {
    const country = countryById(id);
    const codes = country ? country.languages.map((language) => language.code) : [];
    setCountryId(id);
    setEnabledLanguages(codes);
    localStorage.setItem(COUNTRY_KEY, id);
    localStorage.setItem(COUNTRY_LANGUAGES_KEY, JSON.stringify(codes));
  }, []);

  const handleToggleLanguage = useCallback((code) => {
    setEnabledLanguages((current) => {
      const next = current.includes(code)
        ? current.filter((item) => item !== code)
        : [...current, code];
      localStorage.setItem(COUNTRY_LANGUAGES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const handleUsername = useCallback((value) => {
    setSiteUsername(value);
    localStorage.setItem(USERNAME_KEY, value);
  }, []);

  const handlePassword = useCallback((value) => {
    setSitePassword(value);
    localStorage.setItem(PASSWORD_KEY, value);
  }, []);

  const handleForget = useCallback((word) => {
    setAllowedWords((current) => {
      const next = new Set(current);
      next.delete(String(word || '').toLowerCase());
      localStorage.setItem(ALLOWED_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const handleDismiss = useCallback((id) => {
    setDismissedIds((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }, []);

  const exportRows = sections.flatMap((section) => section.rows);
  const reportSections = [...failedSections, ...sections];
  const reportLanguage = languageTabs.length > 1
    ? (languageTabs.find((tab) => tab.code === selectedLanguage)?.label || '')
    : '';

  const handleExportText = useCallback(() => {
    downloadFile('copychecker-results.txt', toExportText(exportRows), 'text/plain;charset=utf-8');
  }, [exportRows]);

  const handleExportExcel = useCallback(async () => {
    setExportError('');
    try {
      const buffer = await buildExcelReport({
        sections: reportSections,
        languageLabel: reportLanguage,
      });
      const bytes = new Uint8Array(buffer);
      downloadFile(
        'copychecker-results.xlsx',
        new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      );
    } catch (error) {
      setExportError('The Excel file could not be created.');
    }
  }, [reportSections, reportLanguage]);

  const foundNothing = Boolean(outcome) && pages.length > 0 && rows.length === 0 && failedRows.length === 0;
  const nothingMatches = rows.length > 0 && visibleRows.length === 0 && query.trim().length > 0;
  const allDismissed = rows.length > 0 && visibleRows.length === 0 && query.trim().length === 0;
  const canExport = visibleRows.length > 0 || visibleFailedRows.length > 0;

  return (
    <div className="flex min-h-screen w-full bg-paper text-ink">
      <div className="sticky top-0 flex h-screen shrink-0 self-start overflow-y-auto border-r border-sand">
        <nav aria-label="Menu" className="flex w-14 flex-col items-center gap-2 px-2 py-4">
          {SIDE_MENU.map((item) => {
            const selected = menuId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setMenuId((current) => (current === item.id ? null : item.id))}
                className={`relative rounded-md border border-pine p-2 text-pine hover:bg-lilac ${selected ? 'bg-lilac' : 'bg-paper'}`}
                aria-expanded={selected}
                aria-controls={item.id}
                aria-label={item.label}
                title={item.label}
              >
                <item.Icon />
                {item.id === 'flagged-words' && allowedWords.size > 0 ? (
                  <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-coral px-1 text-center text-xs font-semibold text-pine">
                    {allowedWords.size}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        {menuId === 'flagged-words' ? (
          <aside id="flagged-words" className="w-72 px-4 py-6">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-xl font-semibold text-pine">Flagged words</h2>
              <button
                type="button"
                onClick={() => setMenuId(null)}
                className="rounded-md border border-pine px-2 py-1 text-sm font-semibold text-pine hover:bg-lilac"
                aria-label="Close flagged words"
              >
                Close
              </button>
            </div>
            <p className="mt-2 text-sm">
              Words you have set aside. They are skipped on later checks. Removing one brings it back on the next run.
            </p>
            {allowedWords.size === 0 ? (
              <p className="mt-4 rounded-md bg-sand px-3 py-2 text-sm">No flagged words yet.</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {[...allowedWords].sort((left, right) => left.localeCompare(right)).map((word) => (
                  <li key={word} className="flex items-center justify-between gap-2 rounded-md border border-sand px-3 py-2">
                    <span>{word}</span>
                    <button
                      type="button"
                      onClick={() => handleForget(word)}
                      className="rounded-md border border-pine px-2 py-1 text-sm font-semibold text-pine hover:bg-coral"
                      aria-label={`Check ${word} again`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        ) : null}
        {menuId === 'country' ? (
          <aside id="country" className="w-72 px-4 py-6">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-xl font-semibold text-pine">Country</h2>
              <button
                type="button"
                onClick={() => setMenuId(null)}
                className="rounded-md border border-pine px-2 py-1 text-sm font-semibold text-pine hover:bg-lilac"
                aria-label="Close country"
              >
                Close
              </button>
            </div>
            <p className="mt-2 text-sm">
              Choose a country to check each language you turn on. Leave this unset to use the language in the address.
            </p>
            <label htmlFor="country-choice" className="mt-4 block text-sm font-semibold">Country</label>
            <select
              id="country-choice"
              value={countryId}
              onChange={(event) => handleCountry(event.target.value)}
              className="mt-2 w-full rounded-md border border-sand bg-paper p-2 text-ink"
            >
              <option value="">No country selected</option>
              {COUNTRIES.map((country) => (
                <option key={country.id} value={country.id}>{country.label}</option>
              ))}
            </select>
            {countryById(countryId) ? (
              <ul className="mt-4 space-y-2">
                {countryById(countryId).languages.map((language) => (
                  <li key={language.code}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={enabledLanguages.includes(language.code)}
                        onChange={() => handleToggleLanguage(language.code)}
                      />
                      {language.label}
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}
          </aside>
        ) : null}
        {menuId === 'site-password' ? (
          <aside id="site-password" className="w-72 px-4 py-6">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-xl font-semibold text-pine">Site password</h2>
              <button
                type="button"
                onClick={() => setMenuId(null)}
                className="rounded-md border border-pine px-2 py-1 text-sm font-semibold text-pine hover:bg-lilac"
                aria-label="Close site password"
              >
                Close
              </button>
            </div>
            <p className="mt-2 text-sm">
              Used when a page asks for a username and password in JavaScript prompts. The username is answered first. Both stay on this computer.
            </p>
            <label htmlFor="site-username-field" className="mt-4 block text-sm font-semibold">Username</label>
            <input
              id="site-username-field"
              type="text"
              value={siteUsername}
              onChange={(event) => handleUsername(event.target.value)}
              autoComplete="off"
              className="mt-2 w-full rounded-md border border-sand bg-paper p-2 text-ink"
            />
            <label htmlFor="site-password-field" className="mt-4 block text-sm font-semibold">Password</label>
            <input
              id="site-password-field"
              type="password"
              value={sitePassword}
              onChange={(event) => handlePassword(event.target.value)}
              autoComplete="off"
              className="mt-2 w-full rounded-md border border-sand bg-paper p-2 text-ink"
            />
          </aside>
        ) : null}
      </div>
      <main className="min-w-0 flex-1 px-6 py-6">
        <h1 className="text-3xl font-semibold text-pine">CopyChecker</h1>
        <p className="mt-2 max-w-2xl">
          Paste page addresses and run a check. A language in the address, such as /fr/, is used
          automatically. Choose a country in the menu when a site uses more than one language.
        </p>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="addresses" className="block font-semibold">
              Page addresses
            </label>
            <textarea
              id="addresses"
              name="addresses"
              value={addresses}
              onChange={(event) => setAddresses(event.target.value)}
              disabled={running}
              rows={8}
              spellCheck="false"
              autoCapitalize="off"
              autoCorrect="off"
              aria-describedby="addresses-help"
              className="mt-2 w-full rounded-md border border-sand bg-paper p-3 text-ink disabled:bg-sand"
            />
            <p id="addresses-help" className="mt-2 text-sm">
              One address per line. A language in the address, such as /fr/, is detected automatically.
            </p>
          </div>

          <AddressErrors errors={errors} />

          {running ? (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-md bg-pine px-5 py-3 font-semibold text-paper"
            >
              Cancel
            </button>
          ) : (
            <button
              type="submit"
              className="rounded-md bg-coral px-5 py-3 font-semibold text-pine"
            >
              Run Check
            </button>
          )}
        </form>

        <section className="mt-6" aria-busy={running}>
          <h2 className="text-2xl font-semibold text-pine">Results</h2>

          <p
            className={`break-all font-semibold ${
              (running && progress) || (!running && outcome) ? 'mt-3' : 'sr-only'
            }`}
            aria-live="polite"
          >
            {running && progress ? progressText(progress) : ''}
            {!running && outcome ? outcomeText(pages, outcome) : ''}
          </p>

          {!running && pages.length === 0 && !outcome ? (
            <p className="mt-4 rounded-md bg-sand px-4 py-3">
              Results appear here after you run a check.
            </p>
          ) : null}

          {foundNothing ? (
            <p className="mt-4 rounded-md bg-lime px-4 py-3">No issues</p>
          ) : null}

          {rows.length > 0 || failedRows.length > 0 ? (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div className="min-w-64 flex-1">
                <label htmlFor="result-search" className="block text-sm font-semibold">
                  Search results
                </label>
                <input
                  id="result-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="mt-2 w-full rounded-md border border-sand bg-paper p-3 text-ink"
                />
              </div>
              <button
                type="button"
                onClick={handleExportText}
                disabled={!canExport}
                className="rounded-md border border-pine px-4 py-3 font-semibold text-pine disabled:border-sand disabled:text-ink"
              >
                Export text
              </button>
              <button
                type="button"
                onClick={handleExportExcel}
                disabled={!canExport}
                className="rounded-md border border-pine px-4 py-3 font-semibold text-pine disabled:border-sand disabled:text-ink"
              >
                Export Excel
              </button>
            </div>
          ) : null}

          {exportError ? (
            <p className="mt-4 rounded-md bg-sand px-4 py-3" role="alert">{exportError}</p>
          ) : null}

          {nothingMatches ? (
            <p className="mt-4 rounded-md bg-sand px-4 py-3">No issues match that search.</p>
          ) : null}

          {allDismissed ? (
            <p className="mt-4 rounded-md bg-sand px-4 py-3">All issues dismissed.</p>
          ) : null}

          {failedSections.length > 0 ? (
            <div className="mt-4 space-y-3">
              {failedSections.map((section) => (
                <details key={section.id} open className="rounded-md border border-sand">
                  <summary className="cursor-pointer bg-sand px-4 py-3 font-semibold">
                    {section.title} ({section.rows.length})
                  </summary>
                  <ResultsTable
                    rows={section.rows}
                    onDismiss={handleDismiss}
                    onAllow={handleAllow}
                    sort={sorts[section.id]}
                    onSort={(field) => handleSort(section.id, field)}
                    caption={section.title}
                  />
                </details>
              ))}
            </div>
          ) : null}

          {languageTabs.length > 1 ? (
            <div role="tablist" aria-label="Languages" className="mt-4 flex flex-wrap gap-2">
              {languageTabs.map((tab) => {
                const selected = tab.code === selectedLanguage;
                return (
                  <button
                    key={tab.code}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setActiveLanguage(tab.code)}
                    className={`rounded-md border border-pine px-4 py-2 font-semibold ${selected ? 'bg-lilac text-pine' : 'bg-paper text-pine'}`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {sections.length > 0 ? (
            <div key={runId} className="mt-4 space-y-3">
              {sections.map((section, index) => (
                <details
                  key={section.id}
                  className="rounded-md border border-sand"
                  ref={(element) => {
                    if (element && element.dataset.ready !== '1') {
                      element.open = index === 0;
                      element.dataset.ready = '1';
                    }
                  }}
                >
                  <summary className="cursor-pointer bg-sand px-4 py-3 font-semibold">
                    {section.title} ({section.rows.length})
                  </summary>
                  <ResultsTable
                    rows={section.rows}
                    onDismiss={handleDismiss}
                    onAllow={handleAllow}
                    sort={sorts[section.id]}
                    onSort={(field) => handleSort(section.id, field)}
                    caption={section.title}
                  />
                </details>
              ))}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

export default App;
