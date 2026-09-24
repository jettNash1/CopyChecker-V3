const { IPC } = require('../shared/ipc');
const { CHECK_DEFAULTS } = require('../shared/check-defaults');
const { parseAddressList, resolvePageCheck, decisionsForLanguages, CHECK_KINDS } = require('./page-plan');
const { fetchPageHtml, closeRenderedBrowser, createHostFetchPolicy } = require('./fetcher');
const { parseHtml } = require('./parser');
const { checkContent } = require('./checker');
const { checkLangContent } = require('./langcheck');

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

let activeRun = null;

function issueRank(issueType) {
  return ISSUE_RANK[issueType] ?? 10;
}

function cleanIssueText(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function presentIssue(issue) {
  const suggestion = issue.suggestion && issue.suggestion !== issue.flaggedText
    ? issue.suggestion
    : '';

  return {
    id: issue.id,
    flaggedText: issue.flaggedText || issue.issueType || 'Issue',
    message: issue.message || issue.issueType || 'Issue',
    suggestion,
    issueType: issue.issueType || '',
    severity: issue.severity || 'warning',
    context: cleanIssueText(issue.context, 280),
    paragraph: cleanIssueText(issue.paragraph || issue.context, 2000),
    element: String(issue.location || issue.element || '').trim(),
  };
}

function sortIssues(issues) {
  return [...issues].sort((left, right) => issueRank(left.issueType) - issueRank(right.issueType));
}

function errorMessage(error) {
  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }
  return 'Could not load this page.';
}

function isCancelled(error, signal) {
  return error?.code === 'CANCELLED' || signal?.aborted;
}

function sendProgress(getWindow, payload) {
  const win = typeof getWindow === 'function' ? getWindow() : null;
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IPC.PROGRESS, payload);
}

function failedPage(url, index, message) {
  return {
    index,
    url,
    decision: resolvePageCheck(url),
    language: '',
    languageLabel: '',
    error: message,
    empty: false,
    issues: [],
  };
}

function tagLanguage(page, decision) {
  return {
    ...page,
    language: decision?.code || '',
    languageLabel: decision?.label || '',
  };
}

function normaliseAllowList(value) {
  if (!Array.isArray(value)) return [];
  const words = value
    .map((word) => String(word || '').trim().toLowerCase())
    .filter((word) => word && word.length <= 40);
  return [...new Set(words)];
}

function buildPageConfig(decision, allowList) {
  return {
    ...CHECK_DEFAULTS,
    allowList,
    ignoreTags: [...CHECK_DEFAULTS.ignoreTags],
    ignoreSelectors: [...CHECK_DEFAULTS.ignoreSelectors],
    contentTags: [...CHECK_DEFAULTS.contentTags],
    grammarRules: { ...CHECK_DEFAULTS.grammarRules },
    detectionLevels: { ...CHECK_DEFAULTS.detectionLevels },
    locale: 'en-GB',
    englishVariant: 'en-GB',
    checkMode: 'offline',
    fetchMode: 'auto',
    authProfiles: [],
    sitePassword: '',
    // Fixed language so LangCheck does not add notes about a missing locale.
    languageMode: 'manual',
    expectedLanguage: decision.code,
  };
}

async function checkPage(url, index, signal, policy, allowList, languages, siteUsername, sitePassword, onChecking) {
  const decisions = languages.length > 0 ? languages : [resolvePageCheck(url)];
  const config = buildPageConfig(decisions[0], allowList);
  if (siteUsername || sitePassword) {
    config.fetchMode = 'rendered';
    config.siteUsername = siteUsername;
    config.sitePassword = sitePassword;
  }

  let html;
  try {
    html = await fetchPageHtml(url, {
      timeoutMs: config.fetchTimeoutMs,
      signal,
      config,
      policy,
    });
  } catch (error) {
    if (isCancelled(error, signal)) throw error;
    return [failedPage(url, index, errorMessage(error))];
  }

  if (signal?.aborted) {
    const cancelError = new Error('Request was cancelled');
    cancelError.code = 'CANCELLED';
    throw cancelError;
  }

  onChecking();

  let blocks = [];
  try {
    blocks = parseHtml(html, url, config).blocks || [];
  } catch {
    return [failedPage(url, index, 'This page could not be read.')];
  }

  if (blocks.length === 0) {
    return decisions.map((decision) => tagLanguage({
      index,
      url,
      decision,
      error: null,
      empty: true,
      issues: [],
    }, decision));
  }

  const checked = [];
  for (const decision of decisions) {
    const languageConfig = buildPageConfig(decision, allowList);
    try {
      const rawIssues = decision.kind === CHECK_KINDS.SPELLING
        ? await checkContent(blocks, languageConfig)
        : await checkLangContent(blocks, languageConfig);

      if (signal?.aborted) {
        const cancelError = new Error('Request was cancelled');
        cancelError.code = 'CANCELLED';
        throw cancelError;
      }

      checked.push(tagLanguage({
        index,
        url,
        decision,
        error: null,
        empty: false,
        issues: sortIssues(rawIssues).map(presentIssue),
      }, decision));
    } catch (error) {
      if (isCancelled(error, signal)) throw error;
      checked.push(failedPage(url, index, 'This page could not be checked.'));
    }
  }

  return checked;
}

async function runPages(urls, getWindow, signal, allowList, languages, siteUsername, sitePassword) {
  const policy = createHostFetchPolicy({ maxConcurrency: CHECK_DEFAULTS.fetchConcurrency });
  const pages = new Array(urls.length);
  let nextIndex = 0;
  let completed = 0;
  const workerCount = Math.min(CHECK_DEFAULTS.fetchConcurrency, urls.length);

  sendProgress(getWindow, {
    status: 'started',
    url: '',
    index: 0,
    total: urls.length,
    completed: 0,
  });

  async function worker() {
    while (!signal.aborted) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= urls.length) return;

      const url = urls[index];
      sendProgress(getWindow, {
        status: 'fetching',
        url,
        index,
        total: urls.length,
        completed,
      });

      try {
        const page = await checkPage(url, index, signal, policy, allowList, languages, siteUsername, sitePassword, () => {
          sendProgress(getWindow, {
            status: 'checking',
            url,
            index,
            total: urls.length,
            completed,
          });
        });

        if (signal.aborted) return;

        const results = Array.isArray(page) ? page : [page];
        pages[index] = results;
        completed += 1;
        sendProgress(getWindow, {
          status: 'page-done',
          url,
          index,
          total: urls.length,
          completed,
          page: results[0],
          pages: results,
        });
      } catch (error) {
        if (isCancelled(error, signal)) return;

        const results = [failedPage(url, index, errorMessage(error))];
        pages[index] = results;
        completed += 1;
        sendProgress(getWindow, {
          status: 'page-done',
          url,
          index,
          total: urls.length,
          completed,
          page: results[0],
          pages: results,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return pages.flat().filter(Boolean);
}

function cancelRun() {
  if (!activeRun) return;
  activeRun.cancelled = true;
  activeRun.abortController.abort();
}

async function shutdown() {
  cancelRun();
  await closeRenderedBrowser();
}

async function executeRun(payload, getWindow) {
  if (activeRun) {
    return {
      ok: false,
      errors: [{ line: 0, url: '', message: 'A check is already running.' }],
    };
  }

  const parsed = parseAddressList(payload?.addresses);
  if (parsed.errors.length > 0) {
    return { ok: false, errors: parsed.errors };
  }

  const abortController = new AbortController();
  activeRun = { cancelled: false, abortController };

  try {
    const pages = await runPages(
      parsed.valid,
      getWindow,
      abortController.signal,
      normaliseAllowList(payload?.allowList),
      decisionsForLanguages(payload?.languages),
      String(payload?.siteUsername || ''),
      String(payload?.sitePassword || ''),
    );

    return {
      ok: true,
      cancelled: activeRun.cancelled,
      pages,
    };
  } finally {
    activeRun = null;
  }
}

module.exports = {
  executeRun,
  cancelRun,
  shutdown,
  presentIssue,
  sortIssues,
  decisionsForLanguages,
};
