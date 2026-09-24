// Same rules as src/main/page-plan.js, so mistakes show before a check starts.
const ADDRESS_HINT = 'Use an address that starts with http:// or https://.';

export function parseAddressList(input) {
  const lines = Array.isArray(input) ? input : String(input || '').split(/\r?\n/);
  const valid = [];
  const errors = [];
  const seen = new Set();

  lines.forEach((raw, index) => {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return;

    let parsedUrl = null;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        parsedUrl = parsed.href;
      }
    } catch {
      parsedUrl = null;
    }

    if (!parsedUrl) {
      errors.push({ line: index + 1, url: trimmed, message: ADDRESS_HINT });
      return;
    }

    if (seen.has(parsedUrl)) return;
    seen.add(parsedUrl);
    valid.push(parsedUrl);
  });

  if (valid.length === 0 && errors.length === 0) {
    errors.push({ line: 0, url: '', message: 'Enter at least one page address.' });
  }

  return { valid, errors };
}
