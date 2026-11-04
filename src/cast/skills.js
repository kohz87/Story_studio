// A cast member's signature skills (`cast[].skills`, Story Block 2.22.0): fixed skills that fill the member's skill slots when they join.
// `[{ name, about, stat, uses?, rank? }]`, 1 to SKILL_SLOTS of them, a name once per person; `stat` is one of Story Block's seven,
// `uses` stamina (the default) or mana, `rank` novice (the default), adept, expert or master.
//
// The vendored Story Block copy that does not yet know the field is told nothing of it: `checkCastSkills` is Studio's reading of the
// same rules and `withCastSkillsChecked` (model.js) lets it stand in until the vendored checker has them (see VENDOR_CHECKS_SKILLS).
// Once a sync brings Story Block's own check, both give way to it and this file keeps only the form's constants.

import { CAST_FIELDS, LEAN_RPG_LIMITS } from '../../vendor/story-block/src/v2/packs/limits.js';
import { foldKey, oneLine } from '../../vendor/story-block/src/text.js';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** True when the vendored Story Block copy reads `cast[].skills` itself; then Studio checks nothing of its own. */
export const VENDOR_CHECKS_SKILLS = CAST_FIELDS.includes('skills');

// One constant: 5 slots today, 8 once the extra skill slots land in Story Block (LEAN_RPG_LIMITS.skills follows it after a sync).
export const SKILL_SLOTS = LEAN_RPG_LIMITS.skills;
export const SKILL_FIELDS = Object.freeze(['name', 'about', 'stat', 'uses', 'rank']);
export const SKILL_STATS = Object.freeze(LEAN_RPG_LIMITS.stats.map(stat => stat.toUpperCase()));
export const SKILL_USES = Object.freeze(['stamina', 'mana']);
export const SKILL_RANKS = Object.freeze(['novice', 'adept', 'expert', 'master']);
export const SKILL_LIMITS = Object.freeze({ name: LEAN_RPG_LIMITS.skillName, about: LEAN_RPG_LIMITS.skillAbout });

const titleCase = word => word.charAt(0).toUpperCase() + word.slice(1);
export const usesLabel = uses => titleCase(uses);
export const rankLabel = rank => titleCase(rank);

/** The skill as the form shows it: the defaults filled in, the stat in capitals. */
export function skillView(skill) {
    const stat = typeof skill?.stat === 'string' ? skill.stat.trim().toUpperCase() : '';
    const uses = typeof skill?.uses === 'string' ? skill.uses.trim().toLowerCase() : skill?.uses === undefined ? SKILL_USES[0] : '';
    const rank = typeof skill?.rank === 'string' ? skill.rank.trim().toLowerCase() : skill?.rank === undefined ? SKILL_RANKS[0] : '';
    return { name: typeof skill?.name === 'string' ? skill.name : '', about: typeof skill?.about === 'string' ? skill.about : '', stat, uses, rank };
}

/** A new skill for the form to start from, its name one the person does not have yet. */
export function newSkill(existing) {
    const taken = new Set((Array.isArray(existing) ? existing : []).map(skill => foldKey(skill?.name)));
    let name = 'New skill';
    for (let n = 2; taken.has(foldKey(name)); n++) name = `New skill ${n}`;
    return { name, about: '[WHAT IT DOES]', stat: SKILL_STATS[0], uses: SKILL_USES[0], rank: SKILL_RANKS[0] };
}

/**
 * Problems with one person's `skills`, in Story Block's checker wording: `[{ code, path, message }]`, `path` like `content.cast[2].skills[1].name`.
 * `label` is the person ("Cast \"Harrak\"") and `base` their path.
 */
export function checkCastSkills(skills, base, label) {
    const out = [];
    const say = (field, message, code = 'BAD_RECORD') => out.push({ code, path: `${base}.${field}`, message: `${label}: ${message}` });
    if (!Array.isArray(skills) || !skills.length || skills.length > SKILL_SLOTS) {
        say('skills', `skills must be a list of 1 to ${SKILL_SLOTS} skills: [{ "name": "Spark", "about": "A small burst of magic.", "stat": "int", "uses": "mana", "rank": "novice" }].`);
        return out;
    }
    const seen = [];
    skills.forEach((skill, index) => {
        const at = `skills[${index}]`;
        if (!isRecord(skill)) return say(at, `${at} must be an object.`);
        for (const key of Object.keys(skill)) if (!SKILL_FIELDS.includes(key)) say(`${at}.${key}`, `"${key}" is not a skill field (expected ${SKILL_FIELDS.join(', ')}).`, 'UNKNOWN_FIELD');
        const name = typeof skill.name === 'string' ? oneLine(skill.name) : '';
        if (!name || [...name].length > SKILL_LIMITS.name) say(`${at}.name`, `${at}.name must be text of 1 to ${SKILL_LIMITS.name} characters.`);
        else if (seen.includes(foldKey(name))) say(`${at}.name`, `${at}.name repeats "${name}"; a person names each skill once.`, 'DUPLICATE');
        else seen.push(foldKey(name));
        const about = typeof skill.about === 'string' ? oneLine(skill.about) : '';
        if (!about || [...about].length > SKILL_LIMITS.about) say(`${at}.about`, `${at}.about must be text of 1 to ${SKILL_LIMITS.about} characters (what the skill does; the story reads it).`);
        const view = skillView(skill);
        if (!SKILL_STATS.includes(view.stat)) say(`${at}.stat`, `${at}.stat must be one of ${SKILL_STATS.join(', ').toLowerCase()}.`);
        if (!SKILL_USES.includes(view.uses)) say(`${at}.uses`, `${at}.uses must be ${SKILL_USES.join(' or ')}.`);
        if (!SKILL_RANKS.includes(view.rank)) say(`${at}.rank`, `${at}.rank must be one of ${SKILL_RANKS.join(', ')}.`);
    });
    return out;
}

/** The skills problems of a whole pack document (the people of `content.cast` that carry `skills`). */
export function castSkillsProblems(document) {
    const cast = document?.content?.cast;
    if (!Array.isArray(cast)) return [];
    return cast.flatMap((person, index) => {
        if (!isRecord(person) || person.skills === undefined) return [];
        const label = typeof person.name === 'string' && person.name.trim() ? `Cast "${oneLine(person.name, 80)}"` : `content.cast[${index}]`;
        return checkCastSkills(person.skills, `content.cast[${index}]`, label);
    });
}
