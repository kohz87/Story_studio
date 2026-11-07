// Playing a scenario on the sample host: its steps as replies, Continues, time advances and the edits made after the fact.
import { fail, TEXT } from './util.js';
import { messageIndex } from './read.js';

// ---- playing a scenario -----------------------------------------------------------------------------------------

export function stepText(step) {
    if (step.type === 'advance') return `<Changes>\n! time +${step.minutes}m\n</Changes>`;
    return String(step.text ?? '');
}

/** The text of the message step `i` lives in: its reply and every Continue after it, in order. */
export function messageTexts(steps, texts) {
    const groups = [];
    steps.forEach((step, i) => {
        if (step.type === 'continue' && groups.length) groups.at(-1).steps.push(i);
        else groups.push({ steps: [i] });
    });
    return groups.map((group, n) => ({ ...group, number: n + 1, text: group.steps.map(i => texts[i]).join('\n') }));
}

export async function play(host, steps) {
    let reply = 0;
    for (const step of steps) {
        const text = stepText(step);
        const continuing = step.type === 'continue' && reply > 0;
        host.beginCapture();
        if (continuing) await host.cont(`\n${text}`);
        else { reply += 1; await host.send(`Go on (${reply}).`, `${TEXT(reply)}\n${text}`); }
        host.endCapture(host.ctx.chat.length - 1, text, continuing);
    }
}

export async function apply(host, steps, action, texts, deleted) {
    const groups = messageTexts(steps, texts);
    const group = groups.find(item => item.steps.includes(action.step));
    if (!group && action.type !== 'reload') return fail('SIMULATOR', 'Choose a step of the scenario.');
    const replyText = list => `${TEXT(group.number)}\n${list}`;
    if (action.type === 'reload') {
        await host.store.flush();
        await host.st.loadChat(host.ctx.chat);
        return null;
    }
    const at = messageIndex(host, group.number);
    if (at < 0) return fail('SIMULATOR', 'That reply is not in the sample chat.');
    if (action.type === 'delete') {
        if (steps[action.step].type === 'continue') {
            const left = group.steps.filter(i => i !== action.step).map(i => texts[i]).join('\n');
            host.beginCapture();
            await host.st.editMessage(at, replyText(left));
            await host.sdk.reread(at);
            host.endCapture(at, left);
            deleted.add(action.step);
        } else {
            await host.st.deleteMessage(at);
            for (const index of group.steps) deleted.add(index);
        }
        return null;
    }
    const edited = { ...texts, [action.step]: String(action.text ?? texts[action.step]) };
    const combined = replyText(group.steps.map(i => edited[i]).join('\n'));
    if (action.type === 'reread') {
        host.beginCapture();
        await host.st.editMessage(at, combined);
        await host.sdk.reread(at);
        texts[action.step] = edited[action.step];
        host.endCapture(at, combined);
        return null;
    }
    if (action.type === 'swipe') {
        if (at !== host.ctx.chat.length - 1) return fail('SIMULATOR', 'A swipe replaces the latest reply: choose the last reply of the scenario.');
        host.beginCapture();
        await host.swipe(combined);
        texts[action.step] = edited[action.step];
        host.endCapture(at, combined);
        return null;
    }
    return fail('SIMULATOR', `Unknown action ${action.type}.`);
}
