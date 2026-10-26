// Scan the finished page verbatim: no code paths are exempt, including vendored defaults.
export const NETWORK = /\bfetch\s*\(|\.\s*fetch\b|XMLHttpRequest|WebSocket|EventSource|sendBeacon|https?:\/\//;
export const LOADERS = /<script[^>]+src\s*=|<link|type\s*=\s*["']module["']|\bimport\s*(?:\/\*[\s\S]*?\*\/\s*)*\(|innerHTML|insertAdjacentHTML|outerHTML|DOMParser|\beval\b|\bFunction\b|["'`](?:data:(?:text|application)\/|blob:)/;

/** The first network or loader reference in the page, as text, or null. */
export function firstReference(html) {
    const found = NETWORK.exec(html) ?? LOADERS.exec(html);
    return found ? html.slice(Math.max(0, found.index - 40), found.index + 60) : null;
}
