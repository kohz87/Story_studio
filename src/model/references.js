// Typed references in a pack document, in traversal order.
//
// The reference walk is unchanged from model.js; lookups resolve the pack-local names it encounters.

import { safeClone } from './safe-clone.js';
import { referenceLookups } from './references/lookups.js';
import { identity } from '../identity.js';

/** Helper to push a reference if targetId is present. */
function addRef(refs, kind, id, path, targetKind, targetId) {
    if (typeof targetId === 'string' && targetId) {
        refs.push({ kind, id, path, targetKind, targetId });
    }
}

/** Indexes typed references in a pack document in traversal order. Returns an array of { kind, id, path, targetKind, targetId }. */
export function indexReferences(document) {
    if (!document || typeof document !== 'object') return [];

    const safeDoc = safeClone(document);
    if (!safeDoc || typeof safeDoc !== 'object') return [];

    const { prefix, toFull, resolvePlaceRef, resolveStartItemRef, resolveRaceRef, resolveTalentRef, resolveLegacySkillRef } = referenceLookups(safeDoc);
    const refs = [];

    if (Array.isArray(safeDoc.content?.creatures)) {
        for (let cIdx = 0; cIdx < safeDoc.content.creatures.length; cIdx++) {
            const foe = safeDoc.content.creatures[cIdx];
            if (!foe || typeof foe !== 'object') continue;
            const ownerId = toFull(identity(foe, 'creatures') || `creature-${cIdx}`);

            if (Array.isArray(foe.skills)) {
                for (let sIdx = 0; sIdx < foe.skills.length; sIdx++) {
                    const sRef = foe.skills[sIdx];
                    if (typeof sRef === 'string') {
                        addRef(refs, 'creatures', ownerId, ['content', 'creatures', cIdx, 'skills', sIdx], 'skills', toFull(sRef));
                    }
                }
            }

            if (Array.isArray(foe.loot)) {
                for (let lIdx = 0; lIdx < foe.loot.length; lIdx++) {
                    const loot = foe.loot[lIdx];
                    if (loot && typeof loot === 'object' && loot.def) {
                        addRef(refs, 'creatures', ownerId, ['content', 'creatures', cIdx, 'loot', lIdx, 'def'], 'items', toFull(loot.def));
                    }
                }
            }
        }
    }

    if (Array.isArray(safeDoc.content?.quests)) {
        for (let qIdx = 0; qIdx < safeDoc.content.quests.length; qIdx++) {
            const q = safeDoc.content.quests[qIdx];
            if (!q || typeof q !== 'object') continue;
            const ownerId = toFull(identity(q, 'quests') || `quest-${qIdx}`);

            // quest.giver is explicitly an external NSD NPC ID (§7), NOT a creature reference.
            if (q.giver) {
                addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'giver'], 'npcs', q.giver);
            }

            if (q.turnInPlace) {
                addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'turnInPlace'], 'places', resolvePlaceRef(q.turnInPlace));
            }

            if (Array.isArray(q.requirements)) {
                for (let rIdx = 0; rIdx < q.requirements.length; rIdx++) {
                    const req = q.requirements[rIdx];
                    if (!req || typeof req !== 'object') continue;

                    if (req.kind === 'item' && req.def) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'requirements', rIdx, 'def'], 'items', toFull(req.def));
                    } else if (req.kind === 'quest' && req.template) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'requirements', rIdx, 'template'], 'quests', toFull(req.template));
                    } else if (req.kind === 'place' && req.place) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'requirements', rIdx, 'place'], 'places', resolvePlaceRef(req.place));
                    } else if (req.kind === 'thread' && req.thread) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'requirements', rIdx, 'thread'], 'threads', req.thread);
                    }
                }
            }

            if (Array.isArray(q.objectives)) {
                for (let oIdx = 0; oIdx < q.objectives.length; oIdx++) {
                    const obj = q.objectives[oIdx];
                    if (!obj || typeof obj !== 'object') continue;

                    if (obj.kind === 'kill' && obj.foe) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'objectives', oIdx, 'foe'], 'creatures', toFull(obj.foe));
                    } else if (obj.kind === 'collect' && obj.def) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'objectives', oIdx, 'def'], 'items', toFull(obj.def));
                    } else if (obj.kind === 'visit' && obj.place) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'objectives', oIdx, 'place'], 'places', resolvePlaceRef(obj.place));
                    }
                }
            }

            if (Array.isArray(q.reward?.items)) {
                for (let riIdx = 0; riIdx < q.reward.items.length; riIdx++) {
                    const ri = q.reward.items[riIdx];
                    if (ri && typeof ri === 'object' && ri.def) {
                        addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'reward', 'items', riIdx, 'def'], 'items', toFull(ri.def));
                    }
                }
            }

            if (q.chain && typeof q.chain === 'object') {
                if (q.chain.previous) {
                    addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'chain', 'previous'], 'quests', toFull(q.chain.previous));
                }
                if (q.chain.next) {
                    addRef(refs, 'quests', ownerId, ['content', 'quests', qIdx, 'chain', 'next'], 'quests', toFull(q.chain.next));
                }
            }
        }
    }

    if (Array.isArray(safeDoc.content?.shops)) {
        for (let sIdx = 0; sIdx < safeDoc.content.shops.length; sIdx++) {
            const shp = safeDoc.content.shops[sIdx];
            if (!shp || typeof shp !== 'object') continue;
            const ownerId = toFull(identity(shp, 'shops') || `shop-${sIdx}`);

            if (shp.place) {
                addRef(refs, 'shops', ownerId, ['content', 'shops', sIdx, 'place'], 'places', resolvePlaceRef(shp.place));
            }

            if (Array.isArray(shp.stock)) {
                for (let stIdx = 0; stIdx < shp.stock.length; stIdx++) {
                    const stock = shp.stock[stIdx];
                    const itemRef = typeof stock === 'string' ? stock : (stock && typeof stock === 'object' ? stock.item : null);
                    if (itemRef) {
                        addRef(
                            refs,
                            'shops',
                            ownerId,
                            typeof stock === 'string'
                                ? ['content', 'shops', sIdx, 'stock', stIdx]
                                : ['content', 'shops', sIdx, 'stock', stIdx, 'item'],
                            'items',
                            toFull(itemRef)
                        );
                    }
                }
            }
        }
    }

    if (Array.isArray(safeDoc.content?.recipes)) {
        for (let rIdx = 0; rIdx < safeDoc.content.recipes.length; rIdx++) {
            const rcp = safeDoc.content.recipes[rIdx];
            if (!rcp || typeof rcp !== 'object') continue;
            const ownerId = toFull(identity(rcp, 'recipes') || `recipe-${rIdx}`);

            if (rcp.makes) {
                addRef(refs, 'recipes', ownerId, ['content', 'recipes', rIdx, 'makes'], 'items', toFull(rcp.makes));
            }

            if (Array.isArray(rcp.materials)) {
                for (let mIdx = 0; mIdx < rcp.materials.length; mIdx++) {
                    const mat = rcp.materials[mIdx];
                    if (mat && typeof mat === 'object' && mat.item) {
                        addRef(refs, 'recipes', ownerId, ['content', 'recipes', rIdx, 'materials', mIdx, 'item'], 'items', toFull(mat.item));
                    }
                }
            }
        }
    }

    if (Array.isArray(safeDoc.content?.routes)) {
        for (let rtIdx = 0; rtIdx < safeDoc.content.routes.length; rtIdx++) {
            const route = safeDoc.content.routes[rtIdx];
            if (!route || typeof route !== 'object') continue;
            const ownerId = toFull(identity(route, 'routes') || `route-${rtIdx}`);

            if (route.from) {
                addRef(refs, 'routes', ownerId, ['content', 'routes', rtIdx, 'from'], 'places', resolvePlaceRef(route.from));
            }
            if (route.to) {
                addRef(refs, 'routes', ownerId, ['content', 'routes', rtIdx, 'to'], 'places', resolvePlaceRef(route.to));
            }
        }
    }

    if (Array.isArray(safeDoc.content?.events)) {
        for (let eIdx = 0; eIdx < safeDoc.content.events.length; eIdx++) {
            const evt = safeDoc.content.events[eIdx];
            if (!evt || typeof evt !== 'object') continue;
            const ownerId = toFull(identity(evt, 'events') || `event-${eIdx}`);

            if (evt.after) {
                addRef(refs, 'events', ownerId, ['content', 'events', eIdx, 'after'], 'events', toFull(evt.after));
            }
        }
    }

    if (Array.isArray(safeDoc.content?.presets)) {
        for (let pIdx = 0; pIdx < safeDoc.content.presets.length; pIdx++) {
            const prs = safeDoc.content.presets[pIdx];
            if (!prs || typeof prs !== 'object') continue;
            const ownerId = toFull(identity(prs, 'presets') || `preset-${pIdx}`);

            if (prs.race && typeof prs.race === 'string') {
                addRef(refs, 'presets', ownerId, ['content', 'presets', pIdx, 'race'], 'races', resolveRaceRef(prs.race));
            }

            if (Array.isArray(prs.talents)) {
                for (let tIdx = 0; tIdx < prs.talents.length; tIdx++) {
                    const tRef = prs.talents[tIdx];
                    if (typeof tRef === 'string') {
                        addRef(refs, 'presets', ownerId, ['content', 'presets', pIdx, 'talents', tIdx], 'talents', resolveTalentRef(tRef));
                    }
                }
            }

            // Presets refer to the host's content.skills collection.
            if (Array.isArray(prs.skills)) {
                for (let sIdx = 0; sIdx < prs.skills.length; sIdx++) {
                    const sRef = prs.skills[sIdx];
                    if (typeof sRef === 'string') {
                        addRef(refs, 'presets', ownerId, ['content', 'presets', pIdx, 'skills', sIdx], 'legacySkills', resolveLegacySkillRef(sRef));
                    }
                }
            }
        }
    }

    if (Array.isArray(safeDoc.start?.inventory?.items)) {
        const ownerId = `${prefix}start`;
        for (let iIdx = 0; iIdx < safeDoc.start.inventory.items.length; iIdx++) {
            const entry = safeDoc.start.inventory.items[iIdx];
            const itemRef = typeof entry === 'string' ? entry : (entry && typeof entry === 'object' ? entry.item : null);
            if (itemRef && typeof itemRef === 'string') {
                addRef(
                    refs,
                    'start',
                    ownerId,
                    typeof entry === 'string'
                        ? ['start', 'inventory', 'items', iIdx]
                        : ['start', 'inventory', 'items', iIdx, 'item'],
                    'items',
                    resolveStartItemRef(itemRef)
                );
            }
        }
    }

    return refs;
}
