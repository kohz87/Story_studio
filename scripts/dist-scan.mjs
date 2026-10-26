// The static scan of the finished page that proves it loads no code and calls no network (build.mjs runs it on every
// build and tests/build.test.js runs it again on the committed file).
//
// The page bundles Story Block's runtime for the simulator. That code carries two injected defaults Studio never calls:
// SillyTavern's chat-file client takes `fetch = (...args) => globalThis.fetch(...args)` and its branch helpers take
// `importer = path => import(path)`. With the page's policy (`connect-src 'none'`, no script source) neither can run, and
// the browser tests fail on any request. They are removed from the text before scanning, by shape, and nothing else is.
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const INERT_DEFAULTS = [/\(\.\.\.(\w+)\)=>globalThis\.fetch\(\.\.\.\1\)/g, /\b(\w+)=>import\(\1\)/g];

export const NETWORK = /fetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\//;
export const LOADERS = /<script[^>]+src=|<link|type="module"|\bimport\s*\(|innerHTML|insertAdjacentHTML|outerHTML|DOMParser|\beval\s*\(|new Function/;

/** The page text without its SVG namespace strings and the inert Story Block defaults above. */
export function scannable(html) {
    return INERT_DEFAULTS.reduce((text, pattern) => text.replace(pattern, ''), html.replaceAll(SVG_NAMESPACE, ''));
}

/** The first network or loader reference left in the page, as text, or null. */
export function firstReference(html) {
    const text = scannable(html);
    const found = NETWORK.exec(text) ?? LOADERS.exec(text);
    return found ? text.slice(Math.max(0, found.index - 40), found.index + 60) : null;
}
