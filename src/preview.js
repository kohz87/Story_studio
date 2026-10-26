// The host compiler, condition language and renderers run in a separate, script-disabled document.
import { compileTemplate, renderTemplate } from '../vendor/story-block/src/v2/view/template/index.js';
import { validateScreen, resolveData } from '../vendor/story-block/src/v2/view/screens.js';
import { createScreenRenderer } from '../vendor/story-block/src/v2/view/render-screen.js';
import { standardWidgets } from '../vendor/story-block/src/v2/view/widgets/index.js';
import { themeTokens } from '../vendor/story-block/src/v2/view/theme.js';
import { scopeCss, themeVars } from '../vendor/story-block/src/v2/view/css.js';
import { LAYOUT_CSS } from '../vendor/story-block/src/v2/layout/styles.js';

const RESOURCE = /(?:url\s*\(|@import|@font-face|image-set\s*\()/i;
const LOCAL_IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i;

// Guard resource writes before they reach the DOM, including attributes filled by bindings and widgets.
// This realm belongs only to the preview; the editor's DOM interfaces are untouched.
function offlineDocument(doc, warn) {
    const proto = doc.defaultView.Element.prototype;
    const set = proto.setAttribute;
    const permitted = (node, name, value) => {
        const key = String(name).toLowerCase();
        const text = String(value);
        if (['src', 'href', 'xlink:href'].includes(key) && text && !(key !== 'src' && node.localName !== 'image' && text.startsWith('#')) && !LOCAL_IMAGE.test(text)) {
            warn('Preview omitted an external resource or navigation link.');
            return false;
        }
        if ((key === 'style' || ['fill', 'stroke', 'filter', 'mask', 'clip-path'].includes(key)) && RESOURCE.test(text)) {
            warn('Preview omitted resource-bearing inline styling.');
            return false;
        }
        return true;
    };
    proto.setAttribute = function(name, value) { if (permitted(this, name, value)) set.call(this, name, value); };
    const setNS = proto.setAttributeNS;
    proto.setAttributeNS = function(ns, name, value) { if (permitted(this, name, value)) setNS.call(this, ns, name, value); };
    const style = doc.defaultView.CSSStyleDeclaration.prototype;
    const property = style.setProperty;
    style.setProperty = function(name, value, priority) {
        if (RESOURCE.test(String(value))) { warn('Preview omitted resource-bearing style variables.'); return; }
        property.call(this, name, value, priority);
    };
    doc.addEventListener('click', event => { if (event.target.closest?.('a')) event.preventDefault(); }, true);
    doc.addEventListener('submit', event => event.preventDefault(), true);
}

export function createPreview(frame, onWarnings) {
    let view = null;
    let target = null;
    let current = null;
    let disposed = false;
    let messages = [];
    const warn = text => {
        if (!messages.includes(text)) messages.push(text);
        onWarnings([...messages]);
    };
    const destroyView = () => { view?.(); view = null; };
    const paint = () => {
        if (disposed || !current || !target) return;
        destroyView();
        messages = [];
        const { screen, sample, step } = current;
        target.replaceChildren();
        const doc = target.ownerDocument;
        for (const style of doc.head.querySelectorAll('[id^="ss-css-"]')) style.remove();
        const host = doc.createElement('div');
        host.setAttribute('data-ss-screen', screen.id);
        const scheme = frame.ownerDocument.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
        for (const [name, value] of themeTokens({ scheme })) host.style.setProperty(name, value);
        host.style.setProperty('color', 'var(--ss-text)');
        target.append(host);
        const query = name => Object.hasOwn(sample.queries ?? {}, name) ? sample.queries[name] : null;
        const command = () => { warn('Preview only: game commands are inactive.'); return { ok: false, message: 'Preview only: game commands are inactive.' }; };
        try {
            const errors = validateScreen(screen);
            if (errors.length) { for (const text of errors) warn(text); return; }
            const data = resolveData(screen.data, query);
            if (!data.ok) { warn(data.message); return; }
            for (const text of data.problems) warn(text);
            const theme = themeVars(screen.theme);
            for (const [name, value] of theme.vars) host.style.setProperty(name, value);
            const renderer = createScreenRenderer({
                queryAt: query, widgets: () => standardWidgets,
                templates: {
                    compileTemplate,
                    renderTemplate(el, compiled, scope, options) {
                        for (const text of compiled.warnings) warn(text);
                        return renderTemplate(el, compiled, scope, { ...options, onWarn: warn });
                    },
                    scopeCss(text, id) {
                        const scoped = scopeCss(text, id);
                        for (const message of scoped.warnings) warn(message);
                        if (RESOURCE.test(scoped.css)) {
                            warn('Preview omitted CSS containing resource loaders; the authored CSS is retained.');
                            return '';
                        }
                        return scoped;
                    },
                },
            });
            let drawn = screen;
            if (step !== null) {
                const { template, layout, steps, ...rest } = screen;
                drawn = { ...rest, ...steps[step] };
                // A step keeps the screen's identity, styling and data.
                drawn.id = screen.id;
            }
            view = renderer.render(host, drawn, {
                state: sample.state, q: data.q, draft: sample.draft, settings: sample.settings,
                ops: sample.ops, api: { command },
            });
            for (const line of host.querySelectorAll('.ss-l-invalid li')) warn(line.textContent);
        } catch (err) { warn(`Preview: ${err.message}`); }
        onWarnings([...messages]);
    };
    let initialized = null;
    const init = () => {
        const doc = frame.contentDocument;
        if (disposed || !doc?.body || doc === initialized) return;
        initialized = doc;
        offlineDocument(doc, warn);
        const style = doc.createElement('style');
        style.textContent = `:root { color-scheme: light dark; font: 15px system-ui; } body { margin: 16px; overflow-wrap: anywhere; } img { max-width: 100%; } ${LAYOUT_CSS}\n${typeof __STUDIO_GLASS_CSS__ === 'string' ? __STUDIO_GLASS_CSS__ : ''}`;
        doc.head.append(style);
        target = doc.body;
        paint();
    };
    frame.addEventListener('load', init);
    init();
    return {
        update(screen, sample, step = null) { current = { screen, sample, step }; paint(); },
        destroy() { disposed = true; destroyView(); frame.removeEventListener('load', init); },
    };
}
