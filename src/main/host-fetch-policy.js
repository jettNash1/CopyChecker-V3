const { FETCH_ACCESS_CODES } = require('../shared/constants');

const RESET_CODES = new Set([
  'ECONNRESET',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_ABORTED',
]);

const RENDERED_STREAK_TO_PREFER = 2;
const STATIC_STREAK_TO_RELAX = 2;
const MAX_DELAY_MS = 12000;
const MIN_PRESSURE_DELAY_MS = 800;
const SUCCESS_DECAY_AFTER = 3;

function hostKey(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return String(url || '');
  }
}

function sleep(ms, signal) {
  const waitMs = Math.max(0, ms);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject({ code: 'CANCELLED', message: 'Request was cancelled' });
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, waitMs);

    function onAbort() {
      clearTimeout(timer);
      reject({ code: 'CANCELLED', message: 'Request was cancelled' });
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isResetCode(code) {
  return RESET_CODES.has(code);
}

function isPressureError(error, policy, url) {
  if (!error) return false;
  if (error.code === FETCH_ACCESS_CODES.RATE_LIMITED) return true;
  if (error.code === 'HTTP_ERROR' && (error.status === 429 || error.status === 503)) return true;
  if (!isResetCode(error.networkCode) && !isResetCode(error.code)) return false;
  return Boolean(policy?.hasSuccess(url));
}

function createHostFetchPolicy({ maxConcurrency = 3 } = {}) {
  const ceiling = Math.max(1, Math.min(maxConcurrency, 10));
  const hosts = new Map();

  function getHost(url) {
    const key = hostKey(url);
    if (!hosts.has(key)) {
      hosts.set(key, {
        delayMs: 0,
        concurrency: ceiling,
        inFlight: 0,
        nextStartAt: 0,
        successCount: 0,
        successesSincePressure: 0,
        renderedStreak: 0,
        staticStreak: 0,
        preferRendered: false,
      });
    }
    return hosts.get(key);
  }

  async function acquire(url, signal) {
    const host = getHost(url);

    while (true) {
      if (signal?.aborted) {
        throw { code: 'CANCELLED', url, message: 'Request was cancelled' };
      }

      const now = Date.now();
      const waitForSlot = host.nextStartAt - now;
      if (host.inFlight < host.concurrency && waitForSlot <= 0) {
        host.inFlight += 1;
        host.nextStartAt = Date.now() + host.delayMs;
        return;
      }

      await sleep(host.inFlight >= host.concurrency ? 40 : Math.max(waitForSlot, 10), signal);
    }
  }

  function release(url) {
    const host = getHost(url);
    host.inFlight = Math.max(0, host.inFlight - 1);
  }

  function notePressure(url, error = {}) {
    const host = getHost(url);
    const retryAfter = Number(error.retryAfterMs) || 0;
    host.concurrency = 1;
    host.delayMs = Math.min(
      Math.max(host.delayMs * 2, retryAfter || MIN_PRESSURE_DELAY_MS),
      MAX_DELAY_MS,
    );
    host.nextStartAt = Date.now() + host.delayMs;
    host.successesSincePressure = 0;
    return host.delayMs;
  }

  function noteSuccess(url) {
    const host = getHost(url);
    host.successCount += 1;
    host.successesSincePressure += 1;

    if (host.successesSincePressure < SUCCESS_DECAY_AFTER || host.delayMs === 0) {
      return;
    }

    host.delayMs = Math.floor(host.delayMs / 2);
    if (host.delayMs < 100) host.delayMs = 0;
    if (host.delayMs === 0) {
      host.concurrency = Math.min(ceiling, host.concurrency + 1);
    }
    host.successesSincePressure = 0;
  }

  function noteRendered(url) {
    const host = getHost(url);
    host.renderedStreak += 1;
    host.staticStreak = 0;
    if (host.renderedStreak >= RENDERED_STREAK_TO_PREFER) {
      host.preferRendered = true;
    }
  }

  function noteStatic(url) {
    const host = getHost(url);
    host.staticStreak += 1;
    host.renderedStreak = 0;
    if (host.staticStreak >= STATIC_STREAK_TO_RELAX) {
      host.preferRendered = false;
    }
  }

  function prefersRendered(url) {
    return getHost(url).preferRendered;
  }

  function hasSuccess(url) {
    return getHost(url).successCount > 0;
  }

  function snapshot(url) {
    return { ...getHost(url) };
  }

  async function waitBeforeRetry(url, error, signal) {
    const host = getHost(url);
    const waitMs = Math.min(
      Math.max(Number(error?.retryAfterMs) || host.delayMs || MIN_PRESSURE_DELAY_MS, 0),
      MAX_DELAY_MS,
    );
    await sleep(waitMs, signal);
  }

  return {
    acquire,
    release,
    notePressure,
    noteSuccess,
    noteRendered,
    noteStatic,
    prefersRendered,
    hasSuccess,
    snapshot,
    waitBeforeRetry,
  };
}

module.exports = {
  createHostFetchPolicy,
  isPressureError,
  isResetCode,
  hostKey,
  sleep,
  RENDERED_STREAK_TO_PREFER,
  MIN_PRESSURE_DELAY_MS,
  MAX_DELAY_MS,
};
