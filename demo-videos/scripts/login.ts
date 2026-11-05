import type { Page } from '@playwright/test';
import { attach, pageFor } from '../lib/browser.ts';

// Interactive sign-in helper. Drives each system to the account picker for DEMO_ACCOUNT and waits for the
// presenter to approve the passkey / Windows Hello prompt. Never types credentials.
const account = process.env.DEMO_ACCOUNT ?? '';
if (!account) throw new Error('Set DEMO_ACCOUNT to the demo sign-in UPN');
const timeoutMs = Number(process.env.LOGIN_TIMEOUT_MS ?? 20 * 60_000);

const targets = [
  {
    name: 'atlassian',
    url: process.env.JIRA_LIST_URL!,
    ok: (p: Page) => /atlassian\.net\/jira/.test(p.url()) && !/login/.test(p.url()),
  },
  {
    name: 'copilot-studio',
    url: process.env.MCS_AGENT_URL!,
    ok: (p: Page) => p.url().includes(process.env.MCS_ENV_ID!) && !/home$/.test(p.url()),
  },
  {
    name: 'm365-copilot',
    url: process.env.COPILOT_AGENT_URL!,
    ok: (p: Page) => p.url().startsWith('https://copilot.cloud.microsoft/') && !/login/.test(p.url()),
  },
];

async function pickAccount(p: Page) {
  const ms = p.getByRole('button', { name: /Continue with Microsoft/i });
  if (await ms.isVisible().catch(() => false)) await ms.click();
  const tile = p.getByText(account, { exact: false }).first();
  if (await tile.isVisible().catch(() => false)) await tile.click();
  const email = p.getByPlaceholder(/Email, phone/i);
  if (await email.isVisible().catch(() => false)) {
    await email.fill(account);
    await p.getByRole('button', { name: 'Next' }).click();
  }
  const stay = p.getByRole('button', { name: 'Yes' });
  if ((await p.title()).includes('Stay signed in') && (await stay.isVisible().catch(() => false))) await stay.click();
}

const { ctx } = await attach();
for (const t of targets) {
  const p = await pageFor(ctx, new URL(t.url).host);
  await p.goto(t.url).catch(() => {});
  const deadline = Date.now() + timeoutMs;
  let lastKick = 0;
  while (Date.now() < deadline) {
    await p.waitForTimeout(4000);
    if (t.ok(p)) break;
    if (Date.now() - lastKick > 150_000 && !/login\.microsoft\.com\/common\/bridge\/fido/.test(p.url())) {
      if (t.name === 'copilot-studio' && /copilotstudio/.test(p.url())) {
        // Signed into the wrong (Windows-broker) account: restart the flow with an explicit account prompt.
        await p.goto(`https://login.microsoftonline.com/common/oauth2/v2.0/logout`).catch(() => {});
        await p.waitForTimeout(3000);
        await p.goto(t.url).catch(() => {});
      }
      lastKick = Date.now();
    }
    await pickAccount(p).catch(() => {});
  }
  console.log(t.name, t.ok(p) ? 'SIGNED-IN' : 'TIMEOUT', p.url().slice(0, 120));
}
process.exit(0);
