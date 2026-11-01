// Studio's own drawn assets as strings, so the single-file build can inline them (the files in icons/ and empty/ are
// the source; tests/assets.test.js fails when a string here differs from its file). Names are the file names without .svg.
// Line icons draw in currentColor so the theme colours them. See docs/ASSETS.md.

export const ASSETS = Object.freeze({
    'app-mark': '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><path fill="#7b6cf0" fill-rule="evenodd" d="M14 0h36a14 14 0 0 1 14 14v36a14 14 0 0 1-14 14H14A14 14 0 0 1 0 50V14A14 14 0 0 1 14 0zM32 14C33.8 26.6 37.4 30.2 50 32C37.4 33.8 33.8 37.4 32 50C30.2 37.4 26.6 33.8 14 32C26.6 30.2 30.2 26.6 32 14z"/></svg>',
    'cascade-remove': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="4.5" r="2.5"/><path d="M12 7v3.5M6 15v-4.5h12V12"/><circle cx="6" cy="17.5" r="2.5"/><circle cx="18" cy="19.5" r="2"/><path d="M14 15.5l8-3.5"/></svg>',
    'chevron-down': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    'copy': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 9h11v11H9zM5 15H4V4h11v1"/></svg>',
    'export-file': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 17.5v-6M9.5 14L12 11.5 14.5 14"/></svg>',
    'kind-shops': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9l2-5h12l2 5M5 9v11h14V9M9 20v-6h6v6"/></svg>',
    'logo-mark': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.8" y="2.8" width="18.4" height="18.4" rx="5"/><path d="M12 6C12.6 10.2 13.8 11.4 18 12C13.8 12.6 12.6 13.8 12 18C11.4 13.8 10.2 12.6 6 12C10.2 11.4 11.4 10.2 12 6z"/></svg>',
    'open-file': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 18V6a1 1 0 0 1 1-1h5l2 2.2h7a1 1 0 0 1 1 1V10M3 18l2.4-7.4a1 1 0 0 1 .95-.7H21.2l-2.5 7.8a1 1 0 0 1-.95.7H4a1 1 0 0 1-1-.4z"/></svg>',
    'redo': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
    'undo': '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
    'no-pack': '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M42 40a6 6 0 0 1 6-6h22l8 9h34a6 6 0 0 1 6 6v44a6 6 0 0 1-6 6H48a6 6 0 0 1-6-6zM42 54h76M54 106h52"/><circle cx="80" cy="77" r="12" stroke="#7b6cf0"/><path d="M80 71v12M74 77h12" stroke="#7b6cf0"/><path d="M130 18C130.8 23.6 132.4 25.2 138 26C132.4 26.8 130.8 28.4 130 34C129.2 28.4 127.6 26.8 122 26C127.6 25.2 129.2 23.6 130 18z" stroke="#7b6cf0"/><path d="M28 36h.1M36 24h.1M24 74h.1"/></svg>',
    'no-problems': '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="120" viewBox="0 0 160 120" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M80 14l30 11v24c0 21-13 35-30 43-17-8-30-22-30-43V25zM56 108h48"/><path d="M66 54l10 10 20-22" stroke="#7b6cf0"/><path d="M128 22C128.8 27.6 130.4 29.2 136 30C130.4 30.8 128.8 32.4 128 38C127.2 32.4 125.6 30.8 120 30C125.6 29.2 127.2 27.6 128 22z" stroke="#7b6cf0"/><path d="M30 40h.1M38 28h.1M130 78h.1"/></svg>',
});

// Studio marks that are Story Block's own icons, taken by id from the vendored set (vendor/story-block/src/v2/view/icons)
// instead of being drawn again. Render them with that module's svgIcon(); they are not duplicated here.
export const SB_ICONS = Object.freeze({
    'kind-skills': 'ph-lightning',
    'kind-items': 'ph-package',
    'kind-foes': 'ph-skull',
    'kind-places': 'ph-map-pin',
    'kind-cast': 'ph-user',
    'kind-quests': 'ph-scroll',
    'kind-more': 'ph-dots-three-outline',
    info: 'ph-info',
    warning: 'ph-warning',
    ready: 'ph-check-circle',
});

export default ASSETS;
