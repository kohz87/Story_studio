// On a phone (600 px and below) the pack parts list is a disclosure that starts collapsed and collapses again after a part is
// picked. Opens it when it is collapsed; does nothing when it is open or when the page is wider and the list is always there.
export async function openParts(page) {
    const summary = page.locator('.rail .parts > summary');
    if (!(await summary.isVisible())) return;
    if (await page.locator('.rail .parts').evaluate(node => !node.open)) await summary.click();
}
