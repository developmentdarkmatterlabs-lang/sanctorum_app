/* ---------------------------------------------------------------------------
 * DOM -> a numbered text snapshot the model can reason about.
 *
 * This is the whole reason the browser is a WebContentsView rather than a
 * screenshot pipeline. A page becomes:
 *
 *     [link 12] Wikipedia
 *     [button 18] Search
 *     [input text 30] Search Wikipedia
 *
 * so the agent says `click(18)` — a SEMANTIC reference, not a coordinate. Two
 * things follow. It is ~10x cheaper than a vision model per page. And the
 * approval the user sees reads `click [button 18] "Buy now"` instead of
 * `click at (840, 612)`, which is the difference between supervision and
 * theatre.
 *
 * The source below is stringified and run with executeJavaScript, so it must be
 * self-contained: no imports, no TypeScript, no closure over anything here.
 * ------------------------------------------------------------------------- */

/** One interactive element the agent may address by index. */
export type SnapshotNode = {
  index: number;
  role: string;
  text: string;
  /** Present for inputs, so the agent knows what is already filled in. */
  value?: string;
};

export type PageSnapshot = {
  url: string;
  title: string;
  /** The readable page text, truncated. */
  text: string;
  nodes: SnapshotNode[];
};

/** Caps, applied in-page so a huge document never crosses the IPC boundary. */
const MAX_NODES = 200;
const MAX_TEXT = 12_000;

/**
 * The injected script. Returns a PageSnapshot and leaves a
 * `window.__sanctorumNodes` array behind, so a later click(n) resolves the same
 * element this snapshot numbered.
 */
export const SNAPSHOT_JS = `
(() => {
  const MAX_NODES = ${MAX_NODES};
  const MAX_TEXT = ${MAX_TEXT};
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','SVG','HEAD','META','LINK']);

  const visible = (el) => {
    if (!el.getClientRects || el.getClientRects().length === 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };

  const roleOf = (el) => {
    const tag = el.tagName;
    const explicit = el.getAttribute('role');
    if (tag === 'A' && el.href) return 'link';
    if (tag === 'BUTTON') return 'button';
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA') return 'input text';
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
      if (t === 'checkbox' || t === 'radio') return t;
      if (t === 'hidden') return '';
      return 'input ' + t;
    }
    if (explicit === 'button' || explicit === 'link' || explicit === 'tab') return explicit;
    // Anything the page made clickable itself.
    if (el.onclick || el.getAttribute('onclick')) return 'clickable';
    if (el.tabIndex >= 0 && (explicit || el.getAttribute('aria-label'))) return 'clickable';
    return '';
  };

  const labelOf = (el) => {
    const aria = el.getAttribute('aria-label');
    if (aria) return aria.trim();
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const ph = el.getAttribute('placeholder');
      if (ph) return ph.trim();
      if (el.id) {
        const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (lab && lab.textContent) return lab.textContent.trim();
      }
      const t = el.getAttribute('title') || el.getAttribute('name');
      if (t) return t.trim();
    }
    const text = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
    return text.slice(0, 120);
  };

  const nodes = [];
  const kept = [];
  const all = document.body ? document.body.querySelectorAll('*') : [];
  for (const el of all) {
    if (nodes.length >= MAX_NODES) break;
    if (SKIP.has(el.tagName)) continue;
    const role = roleOf(el);
    if (!role) continue;
    if (el.disabled) continue;
    if (!visible(el)) continue;
    const label = labelOf(el);
    // An unlabelled control is unaddressable in words, so it is not offered.
    if (!label && role.indexOf('input') !== 0) continue;
    const index = nodes.length + 1;
    const entry = { index: index, role: role, text: label };
    if (el.value !== undefined && el.value !== '') entry.value = String(el.value).slice(0, 120);
    nodes.push(entry);
    kept.push(el);
  }

  window.__sanctorumNodes = kept;

  let text = '';
  try {
    text = (document.body ? document.body.innerText : '') || '';
  } catch (e) { text = ''; }
  text = text.replace(/\\n{3,}/g, '\\n\\n').trim();
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + '\\n\\n[truncated]';

  return { url: location.href, title: document.title || '', text: text, nodes: nodes };
})()
`;

/** Click the element a snapshot numbered. Returns why it failed, or ''. */
export const clickJs = (index: number): string => `
(() => {
  const list = window.__sanctorumNodes || [];
  const el = list[${index} - 1];
  if (!el) return 'no element ${index} on this page — take a fresh snapshot';
  el.scrollIntoView({ block: 'center' });
  el.click();
  return '';
})()
`;

/** Type into the element a snapshot numbered, firing the events frameworks need. */
export const typeJs = (index: number, value: string): string => `
(() => {
  const list = window.__sanctorumNodes || [];
  const el = list[${index} - 1];
  if (!el) return 'no element ${index} on this page — take a fresh snapshot';
  if (el.value === undefined) return 'element ${index} is not a text field';
  el.focus();
  el.value = ${JSON.stringify(value)};
  // React and friends listen for these; setting .value alone is invisible to them.
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return '';
})()
`;

export const scrollJs = (amount: number): string =>
  `(() => { window.scrollBy(0, ${amount}); return ''; })()`;
