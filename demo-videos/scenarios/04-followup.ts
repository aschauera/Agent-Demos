// Captures scenes 11-12: the follow-up prompt (Jira -> In Progress, diagram links -> Confluence), the agent's answer,
// and the resulting state in Jira and Confluence. Sends a real prompt that changes KAN-6 and the Confluence page.
// Set CAPTURE_ONLY=1 to re-capture without sending again.
import { attach, pageFor } from '../lib/browser.ts';
import { dismissIfVisible, emulate, rectOf, saveScene, settle, shoot, type Shot } from '../lib/capture.ts';
import { composer, likeButtons, waitForResponse } from '../lib/copilot.ts';

const PROMPT = "Set the JIRA ticket to 'In Progress' and add the diagram links to the confluence specification";
const CAPTURE_ONLY = process.env.CAPTURE_ONLY === '1';
const KEY = process.env.JIRA_ISSUE_KEY!;

const { ctx } = await attach();
try {
  const page = await pageFor(ctx, 'copilot.cloud.microsoft');
  page.setDefaultTimeout(30000);
  await page.bringToFront();
  await emulate(page);
  const main = page.locator('main');

  if (!CAPTURE_ONLY) {
    const box = composer(page);
    await box.click();
    await page.keyboard.type(PROMPT, { delay: 15 });
    await settle(page, 800);
    const typed = await shoot(page, '11-followup-prompt');
    const composerFocus = await rectOf(box.locator('xpath=ancestor::*[.//button][1]'));
    await saveScene({
      slug: '11-followup-prompt',
      shots: [{ image: typed, duration: 3, focus: composerFocus, zoom: true, highlight: true, maxZoom: 2, startZoomed: true }],
    });
    const before = await likeButtons(page).count();
    await page.keyboard.press('Enter');
    await waitForResponse(page, before);
  }
  await settle(page, 2000);
  await likeButtons(page).last().evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await settle(page, 1200);
  const answer = await shoot(page, '12-followup-answer');
  const done = main.getByText('Both are done', { exact: false }).last();
  const answerFocus = await rectOf(done, done.locator('xpath=following::table[1]'));
  console.log((await main.innerText()).slice(-2500));

  // Resulting state in Jira and Confluence.
  const atl = await pageFor(ctx, 'atlassian.net');
  atl.setDefaultTimeout(30000);
  await atl.bringToFront();
  await emulate(atl);
  await atl.goto(process.env.JIRA_LIST_URL!);
  const link = atl.locator(`a[href="/browse/${KEY}"]`).first();
  await link.waitFor();
  await dismissIfVisible(atl.getByText('Dismiss Quickstart', { exact: true }));
  await settle(atl, 2500);
  const row = link.locator('xpath=ancestor::*[self::tr or @role="row"][1]');
  const jira = await shoot(atl, '12-jira-in-progress');
  const rowFocus = await rectOf(row);
  const sh = await atl.getByRole('columnheader', { name: /Status/ }).first().boundingBox().catch(() => null);
  if (sh) rowFocus.w = sh.x + sh.width - rowFocus.x;

  await atl.goto(process.env.CONFLUENCE_PAGE_URL!);
  await atl.locator('h1').first().waitFor();
  await settle(atl, 3000);
  const heading = atl.getByRole('heading', { name: /Architecture diagrams/i }).first();
  let confShots: Shot[] = [];
  if (await heading.count()) {
    const table = atl.locator('table:visible').filter({ hasText: 'Solution & integration architecture' }).last();
    await heading.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    // Leave room for Confluence's sticky page header.
    await atl.mouse.move(1200, 600);
    await atl.mouse.wheel(0, -120);
    await settle(atl, 1500);
    const conf = await shoot(atl, '12-confluence-links');
    const focus = await rectOf(heading, table.getByRole('link').first(), table.getByRole('link').last());
    const tableBox = await rectOf(table);
    focus.w = tableBox.x + tableBox.w - focus.x;
    confShots = [{ image: conf, duration: 2.8, focus, zoom: true, highlight: true, maxZoom: 1.8 }];
  } else {
    console.warn('No diagram link found on the Confluence page');
    confShots = [{ image: await shoot(atl, '12-confluence-links'), duration: 3 }];
  }

  await saveScene({
    slug: '12-followup-result',
    shots: [
      { image: answer, duration: 2.8, focus: answerFocus, zoom: true, highlight: true, maxZoom: 1.6 },
      { image: jira, duration: 2.4, focus: rowFocus, zoom: true, highlight: true, maxZoom: 1.8 },
      ...confShots,
    ],
  });
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}
