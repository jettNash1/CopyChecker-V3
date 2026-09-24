const axios = require('axios');
const {
  USER_AGENT,
  FETCH_ACCESS_CODES,
  FETCH_ACCESS_MESSAGES,
  FETCH_MODES,
} = require('../shared/constants');
const { isSparseHtml } = require('./sparse-html');
const { createHostFetchPolicy, isPressureError } = require('./host-fetch-policy');

const DOMAIN_BLOCKED_ERROR_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_FAIL',
  'EAI_NODATA',
  'EAI_NONAME',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_CONNECTION_REFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_ABORTED',
  'ERR_ADDRESS_UNREACHABLE',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NETWORK_ACCESS_DENIED',
]);

const BOT_PROTECTION_BODY_SIGNALS = [
  'cf-browser-verification',
  'cf-challenge',
  'challenge-platform',
  'cdn-cgi/challenge',
  'just a moment...',
  'attention required! | cloudflare',
  'sorry, you have been blocked',
  'enable javascript and cookies to continue',
  'checking your browser before accessing',
  'why have i been blocked',
  'cf-error-details',
  '_incapsula_resource',
  'incapsula incident id',
  'datadome',
  'px-captcha',
  'perimeterx',
  'sucuri website firewall',
];

const DOMAIN_BLOCKED_BODY_SIGNALS = [
  'newly registered domain',
  'this domain is blocked',
  'this website has been blocked',
  'this site is blocked',
  'this website is blocked',
  'blocked by your organisation',
  'blocked by your organization',
  'your organization\'s security policy',
  'your organisation\'s security policy',
  'cisco umbrella',
  'zscaler',
  'palo alto networks',
  'forcepoint',
  'websense',
  'blue coat',
  'requested url was rejected',
  'web filtering',
];

function sampleHtml(html) {
  if (typeof html !== 'string') return '';
  return html.slice(0, 20000).toLowerCase();
}

function getHeader(headers, name) {
  if (!headers) return '';
  const lower = name.toLowerCase();
  if (typeof headers.get === 'function') {
    return String(headers.get(name) || headers.get(lower) || '');
  }
  const key = Object.keys(headers).find((headerName) => headerName.toLowerCase() === lower);
  return key ? String(headers[key] || '') : '';
}

function extractNetworkCode(error) {
  if (!error) return '';

  if (error.code && DOMAIN_BLOCKED_ERROR_CODES.has(error.code)) {
    return error.code;
  }

  const causeCode = error.cause?.code;
  if (causeCode && DOMAIN_BLOCKED_ERROR_CODES.has(causeCode)) {
    return causeCode;
  }

  const message = String(error.message || '');
  const chromeMatch = message.match(/net::(ERR_[A-Z0-9_]+)/);
  if (chromeMatch && DOMAIN_BLOCKED_ERROR_CODES.has(chromeMatch[1])) {
    return chromeMatch[1];
  }

  for (const code of DOMAIN_BLOCKED_ERROR_CODES) {
    if (message.includes(code)) return code;
  }

  return '';
}

function hasBotProtectionHeaders(headers) {
  const cfMitigated = getHeader(headers, 'cf-mitigated').toLowerCase();
  if (cfMitigated.includes('challenge') || cfMitigated.includes('error')) {
    return true;
  }

  const server = getHeader(headers, 'server').toLowerCase();
  const hasCfRay = Boolean(getHeader(headers, 'cf-ray'));
  const isCloudflare = server.includes('cloudflare') || hasCfRay;
  return isCloudflare;
}

function hasBotProtectionBody(body) {
  return BOT_PROTECTION_BODY_SIGNALS.some((signal) => body.includes(signal));
}

function hasDomainSecurityBody(body) {
  return DOMAIN_BLOCKED_BODY_SIGNALS.some((signal) => body.includes(signal));
}

function isBotProtection({ status, headers, body }) {
  if (hasBotProtectionBody(body)) return true;

  const cfMitigated = getHeader(headers, 'cf-mitigated').toLowerCase();
  if (cfMitigated.includes('challenge') || cfMitigated.includes('error')) {
    return true;
  }

  if (status === 403 && hasBotProtectionHeaders(headers)) {
    return true;
  }

  return false;
}

function parseRetryAfterMs(headers) {
  const raw = getHeader(headers, 'retry-after').trim();
  if (!raw) return 0;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 20000);
  }

  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) {
    return Math.min(Math.max(dateMs - Date.now(), 0), 20000);
  }

  return 0;
}

function isRateLimitedResponse({ status, headers, body }) {
  if (hasBotProtectionBody(body)) return false;

  if (status === 429) return true;

  const retryAfterMs = parseRetryAfterMs(headers);
  if (retryAfterMs > 0 && (status === 503 || status === 408 || status === 425)) {
    return true;
  }

  if (status === 503 && !hasBotProtectionHeaders(headers)) {
    return true;
  }

  return false;
}

function classifyFetchAccess({ error, status, headers, html } = {}) {
  const networkCode = extractNetworkCode(error);
  if (networkCode) {
    return {
      code: FETCH_ACCESS_CODES.DOMAIN_BLOCKED,
      message: FETCH_ACCESS_MESSAGES.DOMAIN_BLOCKED,
      networkCode,
    };
  }

  const httpStatus = status ?? error?.status ?? error?.response?.status;
  const responseHeaders = headers || error?.response?.headers;
  const body = sampleHtml(html || error?.response?.data);

  if (isBotProtection({ status: httpStatus, headers: responseHeaders, body })) {
    return {
      code: FETCH_ACCESS_CODES.BOT_PROTECTION,
      message: FETCH_ACCESS_MESSAGES.BOT_PROTECTION,
    };
  }

  if (isRateLimitedResponse({ status: httpStatus, headers: responseHeaders, body })) {
    return {
      code: FETCH_ACCESS_CODES.RATE_LIMITED,
      message: FETCH_ACCESS_MESSAGES.RATE_LIMITED,
      retryAfterMs: parseRetryAfterMs(responseHeaders),
    };
  }

  if (hasDomainSecurityBody(body)) {
    return {
      code: FETCH_ACCESS_CODES.DOMAIN_BLOCKED,
      message: FETCH_ACCESS_MESSAGES.DOMAIN_BLOCKED,
    };
  }

  return null;
}

function toAccessError(url, classified, status) {
  return {
    code: classified.code,
    url,
    message: classified.message,
    ...(status ? { status } : {}),
    ...(classified.retryAfterMs ? { retryAfterMs: classified.retryAfterMs } : {}),
    ...(classified.networkCode ? { networkCode: classified.networkCode } : {}),
  };
}

function throwIfAccessBlocked(url, payload) {
  const classified = classifyFetchAccess(payload);
  if (!classified) return;
  throw toAccessError(url, classified, payload.status);
}

const RENDERED_FETCH_MIN_TIMEOUT_MS = 30000;

let sharedBrowser = null;
let sharedLaunchPromise = null;
let browserEpoch = 0;

function getAuthHeaders(url, config) {
  const authProfiles = config.authProfiles || [];
  if (authProfiles.length === 0) return {};

  try {
    const parsed = new URL(url);
    const profile = authProfiles.find((p) => {
      if (!p.domain) return false;
      return parsed.hostname === p.domain || parsed.hostname.endsWith(`.${p.domain}`);
    });

    if (!profile) return {};

    if (profile.type === 'basic' && profile.username) {
      const token = Buffer.from(`${profile.username}:${profile.password || ''}`).toString('base64');
      return { Authorization: `Basic ${token}` };
    }

    if (profile.type === 'cookie' && profile.cookieHeader) {
      return { Cookie: profile.cookieHeader };
    }

    return {};
  } catch {
    return {};
  }
}

function getHttpCredentials(config) {
  if (config?.siteUsername) {
    return { username: config.siteUsername, password: config.sitePassword || '' };
  }
  const profile = config?.authProfiles?.[0];
  if (profile?.type === 'basic' && profile.username) {
    return { username: profile.username, password: profile.password || '' };
  }
  return undefined;
}

function normalizePlaywrightError(error, url, timeoutMs) {
  const message = error.message || '';

  if (message.includes("Executable doesn't exist")) {
    return {
      code: 'PLAYWRIGHT_BROWSER_MISSING',
      url,
      message: 'Bundled Chromium was not found. Reinstall WebCheck or use static HTML fetch mode.',
    };
  }

  if (message.includes('Timeout') || error.name === 'TimeoutError') {
    return {
      code: 'TIMEOUT',
      url,
      message: `Page did not finish loading within ${Math.round(timeoutMs / 1000)}s in JavaScript render mode. Try static mode or a longer timeout.`,
    };
  }

  return {
    code: 'RENDER_ERROR',
    url,
    message: message.split('\n')[0] || 'Playwright failed to load page',
  };
}

const REDIRECT_MESSAGE = 'This address redirects too many times.';

function isTooManyRedirects(error) {
  const message = String(error?.message || '');
  return error?.code === 'ERR_FR_TOO_MANY_REDIRECTS'
    || error?.code === 'TOO_MANY_REDIRECTS'
    || /maximum number of redirects exceeded/i.test(message)
    || /too many redirects/i.test(message)
    || /ERR_TOO_MANY_REDIRECTS/i.test(message);
}

function redirectOutcome(error, usedBrowser) {
  if (!isTooManyRedirects(error)) return null;
  if (!usedBrowser) return 'browser';
  return 'fail';
}

function promptAnswer(message, username, password, used) {
  const text = String(message || '').toLowerCase();
  if (username && /user|login|name/.test(text) && !used.username) {
    used.username = true;
    return username;
  }
  if (password && /pass|pin|code/.test(text) && !used.password) {
    used.password = true;
    return password;
  }
  if (username && !used.username) {
    used.username = true;
    return username;
  }
  if (password && !used.password) {
    used.password = true;
    return password;
  }
  return '';
}

function watchPasswordDialogs(page, username, password) {
  const state = { missing: false };
  const used = { username: false, password: false };
  page.on('dialog', async (dialog) => {
    try {
      if (dialog.type() === 'prompt') {
        const answer = promptAnswer(dialog.message(), username, password, used);
        if (answer) {
          await dialog.accept(answer);
          return;
        }
        state.missing = true;
        await dialog.dismiss();
        return;
      }
      await dialog.dismiss();
    } catch {
      // The dialog can close before accept or dismiss finishes.
    }
  });
  return state;
}

function mergeCookies(existing, setCookie) {
  const jar = new Map();
  for (const part of String(existing || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    jar.set(trimmed.split('=')[0], trimmed);
  }
  for (const header of setCookie || []) {
    const pair = String(header).split(';')[0].trim();
    if (!pair || !pair.includes('=')) continue;
    jar.set(pair.split('=')[0], pair);
  }
  return [...jar.values()].join('; ');
}

async function fetchHtml(url, { timeoutMs = 15000, signal, config } = {}) {
  try {
    const authHeaders = config ? getAuthHeaders(url, config) : {};
    let current = url;
    let cookie = '';
    const seen = new Set();

    for (let hop = 0; hop <= 15; hop += 1) {
      const response = await axios.get(current, {
        timeout: timeoutMs,
        signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
          ...authHeaders,
          ...(cookie ? { Cookie: cookie } : {}),
        },
        responseType: 'text',
        maxRedirects: 0,
        validateStatus: () => true,
      });

      cookie = mergeCookies(cookie, response.headers['set-cookie']);
      const location = response.headers.location;
      if (response.status >= 300 && response.status < 400 && location) {
        const next = new URL(location, current).href;
        if (seen.has(next) || hop === 15) {
          throw { code: 'TOO_MANY_REDIRECTS', url, message: REDIRECT_MESSAGE };
        }
        seen.add(next);
        current = next;
        continue;
      }

      if (response.status >= 400) {
        const classified = classifyFetchAccess({
          status: response.status,
          headers: response.headers,
          html: response.data,
        });
        if (classified) throw toAccessError(url, classified, response.status);
        throw {
          code: 'HTTP_ERROR',
          url,
          status: response.status,
          message: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      throwIfAccessBlocked(url, {
        status: response.status,
        headers: response.headers,
        html: response.data,
      });

      return response.data;
    }

    throw { code: 'TOO_MANY_REDIRECTS', url, message: REDIRECT_MESSAGE };
  } catch (error) {
    if (
      error.code === FETCH_ACCESS_CODES.DOMAIN_BLOCKED
      || error.code === FETCH_ACCESS_CODES.BOT_PROTECTION
      || error.code === FETCH_ACCESS_CODES.RATE_LIMITED
    ) {
      throw error;
    }

    if (error.code === 'ERR_CANCELED') {
      throw { code: 'CANCELLED', url, message: 'Request was cancelled' };
    }

    if (error.code === 'ECONNABORTED') {
      throw { code: 'TIMEOUT', url, message: `Request timed out after ${timeoutMs}ms` };
    }

    const classified = classifyFetchAccess({
      error,
      status: error.response?.status,
      headers: error.response?.headers,
      html: error.response?.data,
    });
    if (classified) {
      throw toAccessError(url, classified, error.response?.status);
    }

    if (isTooManyRedirects(error)) {
      throw { code: 'TOO_MANY_REDIRECTS', url, message: REDIRECT_MESSAGE };
    }

    if (error.response) {
      throw {
        code: 'HTTP_ERROR',
        url,
        status: error.response.status,
        message: `HTTP ${error.response.status}: ${error.response.statusText}`,
      };
    }

    throw {
      code: 'NETWORK_ERROR',
      url,
      message: error.message || 'Network request failed',
    };
  }
}

function cancelledError(url) {
  return { code: 'CANCELLED', url, message: 'Request was cancelled' };
}

function isAbortError(error, signal) {
  if (signal?.aborted) return true;
  if (error?.code === 'CANCELLED') return true;
  const message = String(error?.message || '');
  return message.includes('Target closed')
    || message.includes('has been closed')
    || message.includes('browser has been closed');
}

async function getRenderedBrowser() {
  if (sharedBrowser) return sharedBrowser;

  const epoch = browserEpoch;
  if (!sharedLaunchPromise) {
    sharedLaunchPromise = (async () => {
      let playwright;
      try {
        playwright = require('playwright');
      } catch {
        throw {
          code: 'PLAYWRIGHT_MISSING',
          message: 'Playwright is not available in this build. Reinstall from source or use static HTML fetch mode.',
        };
      }

      const browser = await playwright.chromium.launch({ headless: true });
      if (epoch !== browserEpoch) {
        await browser.close().catch(() => {});
        throw cancelledError();
      }

      sharedBrowser = browser;
      return browser;
    })().finally(() => {
      sharedLaunchPromise = null;
    });
  }

  return sharedLaunchPromise;
}

async function closeRenderedBrowser() {
  browserEpoch += 1;
  const browser = sharedBrowser;
  sharedBrowser = null;
  const pending = sharedLaunchPromise;
  sharedLaunchPromise = null;

  if (browser) {
    await browser.close().catch(() => {});
  }

  if (pending) {
    await pending
      .then((launched) => launched?.close?.().catch(() => {}))
      .catch(() => {});
  }
}

async function fetchRenderedHtml(url, { timeoutMs = RENDERED_FETCH_MIN_TIMEOUT_MS, config, signal } = {}) {
  if (signal?.aborted) {
    throw cancelledError(url);
  }

  const authHeaders = config ? getAuthHeaders(url, config) : {};
  const httpCredentials = config ? getHttpCredentials(config) : undefined;
  let context;
  let page;

  const abortHandler = () => {
    page?.close().catch(() => {});
    context?.close().catch(() => {});
    closeRenderedBrowser();
  };

  try {
    const browser = await getRenderedBrowser();
    if (signal?.aborted) {
      throw cancelledError(url);
    }

    context = await browser.newContext({
      userAgent: USER_AGENT,
      extraHTTPHeaders: authHeaders,
      httpCredentials,
    });
    page = await context.newPage();
    const passwordAsked = watchPasswordDialogs(page, config?.siteUsername || '', config?.sitePassword || '');
    signal?.addEventListener('abort', abortHandler, { once: true });

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });

    if (passwordAsked.missing) {
      throw { code: 'PASSWORD_REQUIRED', url, message: 'This page asks for a password.' };
    }

    const html = await page.content();
    throwIfAccessBlocked(url, {
      status: response?.status(),
      headers: response?.headers(),
      html,
    });
    return html;
  } catch (error) {
    if (isAbortError(error, signal)) {
      throw cancelledError(url);
    }
    if (
      error.code === FETCH_ACCESS_CODES.DOMAIN_BLOCKED
      || error.code === FETCH_ACCESS_CODES.BOT_PROTECTION
      || error.code === FETCH_ACCESS_CODES.RATE_LIMITED
    ) {
      throw error;
    }
    if (error.code === 'PLAYWRIGHT_MISSING' || error.code === 'PLAYWRIGHT_BROWSER_MISSING') {
      throw { ...error, url };
    }

    const classified = classifyFetchAccess({ error });
    if (classified) {
      throw toAccessError(url, classified);
    }

    if (isTooManyRedirects(error)) {
      throw { code: 'TOO_MANY_REDIRECTS', url, message: REDIRECT_MESSAGE };
    }
    if (error.code) throw error;
    throw normalizePlaywrightError(error, url, timeoutMs);
  } finally {
    signal?.removeEventListener('abort', abortHandler);
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

function resolveFetchTimeout(config, timeoutMs, mode = config?.fetchMode) {
  const configured = timeoutMs ?? config?.fetchTimeoutMs ?? 15000;
  if (mode === FETCH_MODES.RENDERED) {
    return Math.max(configured, RENDERED_FETCH_MIN_TIMEOUT_MS);
  }
  return configured;
}

const MAX_PRESSURE_RETRIES = 2;

async function fetchPageHtmlOnce(url, options, policy) {
  const { config } = options;
  const mode = config?.fetchMode || FETCH_MODES.AUTO;
  const preferRendered = mode === FETCH_MODES.AUTO && policy.prefersRendered(url);

  if (mode === FETCH_MODES.RENDERED || preferRendered) {
    const html = await fetchRenderedHtml(url, {
      ...options,
      timeoutMs: resolveFetchTimeout(config, options.timeoutMs, FETCH_MODES.RENDERED),
    });
    if (mode === FETCH_MODES.AUTO) policy.noteRendered(url);
    return html;
  }

  let html;
  try {
    html = await fetchHtml(url, {
      ...options,
      timeoutMs: resolveFetchTimeout(config, options.timeoutMs, FETCH_MODES.STATIC),
    });
  } catch (error) {
    if (redirectOutcome(error, false) !== 'browser') throw error;
    try {
      const rendered = await fetchRenderedHtml(url, {
        ...options,
        timeoutMs: resolveFetchTimeout(config, options.timeoutMs, FETCH_MODES.RENDERED),
      });
      policy.noteRendered(url);
      return rendered;
    } catch (renderedError) {
      if (redirectOutcome(renderedError, true) === 'fail') {
        throw { code: 'TOO_MANY_REDIRECTS', url, message: REDIRECT_MESSAGE };
      }
      throw renderedError;
    }
  }

  if (mode !== FETCH_MODES.AUTO || !isSparseHtml(html)) {
    if (mode === FETCH_MODES.AUTO) policy.noteStatic(url);
    return html;
  }

  const rendered = await fetchRenderedHtml(url, {
    ...options,
    timeoutMs: resolveFetchTimeout(config, options.timeoutMs, FETCH_MODES.RENDERED),
  });
  policy.noteRendered(url);
  return rendered;
}

async function fetchPageHtml(url, options = {}) {
  const policy = options.policy || createHostFetchPolicy({
    maxConcurrency: options.config?.fetchConcurrency || 1,
  });

  await policy.acquire(url, options.signal);
  try {
    let lastError;
    for (let attempt = 0; attempt <= MAX_PRESSURE_RETRIES; attempt += 1) {
      if (options.signal?.aborted) {
        throw cancelledError(url);
      }

      try {
        const html = await fetchPageHtmlOnce(url, options, policy);
        policy.noteSuccess(url);
        return html;
      } catch (error) {
        lastError = error;
        if (error.code === 'CANCELLED' || options.signal?.aborted) {
          throw error;
        }
        if (!isPressureError(error, policy, url) || attempt === MAX_PRESSURE_RETRIES) {
          throw error;
        }
        policy.notePressure(url, error);
        await policy.waitBeforeRetry(url, error, options.signal);
      }
    }
    throw lastError;
  } finally {
    policy.release(url);
  }
}

module.exports = {
  fetchHtml,
  fetchRenderedHtml,
  fetchPageHtml,
  closeRenderedBrowser,
  createHostFetchPolicy,
  getAuthHeaders,
  resolveFetchTimeout,
  classifyFetchAccess,
  isTooManyRedirects,
  redirectOutcome,
  promptAnswer,
  REDIRECT_MESSAGE,
  isSparseHtml,
  parseRetryAfterMs,
  RENDERED_FETCH_MIN_TIMEOUT_MS,
};
