// Browser entry: the reference runs SB's real registry, mount data resolution and screen renderer.
import { createScreens, validateScreen } from '../../vendor/story-block/src/v2/view/screens.js';
import { drawScreen, dispose } from '../../vendor/story-block/src/v2/view/mounts/common.js';
import { createScreenRenderer } from '../../vendor/story-block/src/v2/view/render-screen.js';
import { standardWidgets } from '../../vendor/story-block/src/v2/view/widgets/index.js';
import { createPreview } from '../../src/preview.js';

globalThis.comparePreview = (screen, sample) => {
    const host = document.createElement('div');
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin');
    document.body.append(host, frame);
    const query = name => Object.hasOwn(sample.queries ?? {}, name) ? sample.queries[name] : null;
    const screens = createScreens();
    screens.setPack('parity', [screen]);
    const renderer = createScreenRenderer({ queryAt: query, widgets: () => standardWidgets });
    const result = drawScreen(host, screen.id, screen.mounts[0], {
        deps: { screens, query, render: renderer.render, document, settings: sample.settings },
        state: sample.state, draft: sample.draft,
    });
    let warnings = [];
    const preview = createPreview(frame, next => { warnings = next; });
    preview.update(screen, sample);
    const output = {
        host: { ok: result.ok, text: host.innerText, errors: validateScreen(screen) },
        studio: { text: frame.contentDocument.body.innerText, warnings },
        hostLayout: host.querySelector('[data-layout]')?.getAttribute('data-layout') ?? null,
        studioLayout: frame.contentDocument.querySelector('[data-layout]')?.getAttribute('data-layout') ?? null,
        hostTheme: host.querySelector('.ss-l-root')?.style.getPropertyValue('--ss-l-accent') ?? '',
        studioTheme: frame.contentDocument.querySelector('.ss-l-root')?.style.getPropertyValue('--ss-l-accent') ?? '',
    };
    preview.destroy(); dispose(host); host.remove(); frame.remove();
    return output;
};
