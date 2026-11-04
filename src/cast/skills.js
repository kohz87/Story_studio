// A cast member's signature skills (`cast[].skills`, Story Block 2.22.0): fixed skills that fill the member's skill slots when they join.
// `[{ name, about, stat, uses?, rank? }]`, 1 to SKILL_SLOTS of them, a name once per person; `stat` is one of Story Block's seven,
// `uses` stamina (the default) or mana, `rank` novice (the default), adept, expert or master.
//
// The check itself is the vendored Story Block's (`validatePack`); this file keeps only what the form needs.

import { CAST_LIMITS, LEAN_RPG_LIMITS } from '../../vendor/story-block/src/v2/packs/limits.js';
import { foldKey } from '../../vendor/story-block/src/text.js';

// One constant, Story Block's CAST_LIMITS.skills (a cast member's own limit, not the skill-set one).
export const SKILL_SLOTS = CAST_LIMITS.skills;
// Stored lowercase, as Story Block's checker has them; the form shows them in capitals (statLabel).
export const SKILL_STATS = Object.freeze([...LEAN_RPG_LIMITS.stats]);
export const SKILL_USES = Object.freeze(['stamina', 'mana']);
export const SKILL_RANKS = Object.freeze(['novice', 'adept', 'expert', 'master']);
export const SKILL_LIMITS = Object.freeze({ name: LEAN_RPG_LIMITS.skillName, about: LEAN_RPG_LIMITS.skillAbout });

const titleCase = word => word.charAt(0).toUpperCase() + word.slice(1);
export const usesLabel = uses => titleCase(uses);
export const rankLabel = rank => titleCase(rank);
export const statLabel = stat => stat.toUpperCase();

/** The skill as the form shows it: the defaults filled in, every value as written. */
export function skillView(skill) {
    const stat = typeof skill?.stat === 'string' ? skill.stat : '';
    const uses = typeof skill?.uses === 'string' ? skill.uses : skill?.uses === undefined ? SKILL_USES[0] : '';
    const rank = typeof skill?.rank === 'string' ? skill.rank : skill?.rank === undefined ? SKILL_RANKS[0] : '';
    return { name: typeof skill?.name === 'string' ? skill.name : '', about: typeof skill?.about === 'string' ? skill.about : '', stat, uses, rank };
}

/** A new skill for the form to start from, its name one the person does not have yet. */
export function newSkill(existing) {
    const taken = new Set((Array.isArray(existing) ? existing : []).map(skill => foldKey(skill?.name)));
    let name = 'New skill';
    for (let n = 2; taken.has(foldKey(name)); n++) name = `New skill ${n}`;
    return { name, about: '[WHAT IT DOES]', stat: SKILL_STATS[0], uses: SKILL_USES[0], rank: SKILL_RANKS[0] };
}
