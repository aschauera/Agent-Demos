// Captures scenes 01-05: Jira backlog, KAN-6 details, Confluence spec, Copilot Studio instructions + tools.
import { attach, pageFor } from '../lib/browser.ts';
import { dismissIfVisible, emulate, rectOf, saveScene, settle, shoot } from '../lib/capture.ts';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env ${k}`);
  return v;
};
const KEY = env('JIRA_ISSUE_KEY');
const REQ = env('REQ_ID');

const { ctx } = await attach();
try {
  // --- Jira ---
  const jira = await pageFor(ctx, 'atlassian.net');
  await jira.bringToFront();
  await emulate(jira);
  await jira.goto(env('JIRA_LIST_URL'));
  const link = jira.locator(`a[href="/browse/${KEY}"]`).first();
  await link.waitFor({ timeout: 30000 });
  await dismissIfVisible(jira.getByText('Dismiss Quickstart', { exact: true }));
  await settle(jira, 2500);
  const row = link.locator('xpath=ancestor::*[self::tr or @role="row"][1]');
  const listShot = await shoot(jira, '01-jira-list');
  const statusHeader = jira.getByRole('columnheader', { name: /Status/ }).first();
  const rowFocus = await rectOf(row);
  const sh = await statusHeader.boundingBox().catch(() => null);
  if (sh) rowFocus.w = sh.x + sh.width - rowFocus.x;
  await saveScene({
    slug: '01-jira-backlog',
    shots: [{ image: listShot, duration: 6, focus: rowFocus, zoom: true, highlight: true, maxZoom: 1.8 }],
  });

  await link.click();
  const dialog = jira.getByRole('dialog').filter({ hasText: REQ }).first();
  await dialog.waitFor({ timeout: 30000 });
  await jira.getByText('Acceptance criteria', { exact: false }).first().waitFor({ timeout: 20000 }).catch(() => {});
  await settle(jira, 3000);
  const issueShot = await shoot(jira, '02-jira-issue');
  const title = dialog.getByRole('heading', { level: 1 }).first();
  const desc = dialog.getByText('Acceptance criteria', { exact: false }).first();
  let focus;
  try {
    focus = await rectOf(title, desc);
    focus.w = Math.max(focus.w, 900);
    focus.h += 160;
  } catch {
    focus = await rectOf(dialog);
  }
  await saveScene({
    slug: '02-jira-kan6-details',
    shots: [
      { image: listShot, duration: 1.8 },
      { image: issueShot, duration: 5.2, focus, zoom: true, highlight: true, maxZoom: 1.6 },
    ],
  });

  // --- Confluence ---
  await jira.goto(env('CONFLUENCE_PAGE_URL'));
  const h1 = jira.locator('h1').filter({ hasText: REQ }).first();
  await h1.waitFor({ timeout: 30000 });
  await settle(jira, 3000);
  const confShot = await shoot(jira, '03-confluence');
  const ac = jira.getByRole('heading', { name: /Acceptance criteria/i }).first();
  const confFocus = await rectOf(h1, ac);
  confFocus.h += 140;
  await saveScene({
    slug: '03-confluence-spec',
    shots: [{ image: confShot, duration: 7, focus: confFocus, zoom: true, highlight: true, maxZoom: 1.7 }],
  });

  // --- Copilot Studio ---
  const mcs = await pageFor(ctx, 'copilotstudio');
  await mcs.bringToFront();
  await emulate(mcs);
  await mcs.goto(env('MCS_AGENT_URL'));
  const instr = mcs.getByText('Instructions', { exact: true }).first();
  await instr.waitFor({ timeout: 60000 });
  const tools = mcs.getByText('Tools', { exact: true }).first();
  await tools.waitFor({ timeout: 30000 });
  await mcs.getByText('ROVO MCP').first().waitFor({ timeout: 30000 });
  await settle(mcs, 3000);
  const mcsShot = await shoot(mcs, '04-mcs');
  const rules = mcs.getByText('Behavioral Rules', { exact: true }).first();
  const iFocus = await rectOf(instr, rules);
  iFocus.w = 830;
  await saveScene({
    slug: '04-agent-instructions',
    shots: [{ image: mcsShot, duration: 5, focus: iFocus, zoom: true, highlight: true, maxZoom: 1.6 }],
  });
  const toolChips = ['Work IQ', 'DrawIO', 'ROVO MCP'].map((t) => mcs.getByText(t, { exact: true }).first());
  const tFocus = await rectOf(tools, ...toolChips);
  tFocus.x -= 6; tFocus.w += 12; tFocus.h += 8;
  await saveScene({
    slug: '05-agent-tools',
    shots: [{ image: mcsShot, duration: 5, focus: tFocus, zoom: true, highlight: true, maxZoom: 2.4 }],
  });
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}
