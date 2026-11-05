// Captures scenes 08-10: the diagram package produced by the agent, opened in draw.io (app.diagrams.net).
// Input: the files downloaded from the Copilot response into artifacts/drawio/.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { attach, pageFor } from '../lib/browser.ts';
import { emulate, saveScene, settle, shoot, type Shot } from '../lib/capture.ts';

const DIR = path.resolve('artifacts', 'drawio');
const REQ = process.env.REQ_ID!;
const files = await fs.readdir(DIR);
const drawioFile = files.find((f) => f.endsWith('.drawio'));
const mermaidFile = files.find((f) => f.includes('.mmd'));
if (!drawioFile || !mermaidFile) throw new Error(`Expected .drawio and .mmd files in ${DIR}`);

const md = await fs.readFile(path.join(DIR, mermaidFile), 'utf8');
const mermaid = [...md.matchAll(/^## (\d+) — (.+?)\n+```mermaid\n([\s\S]*?)```/gm)].map((m) => ({
  no: m[1],
  name: m[2].trim(),
  code: m[3],
}));
if (mermaid.length === 0) throw new Error('No mermaid blocks found');

const EMPTY = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';

async function openInDrawio(page: Page, title: string, xml: string) {
  const url = `https://app.diagrams.net/?splash=0&lang=en&title=${encodeURIComponent(title)}#R${encodeURIComponent(xml)}`;
  await page.goto('about:blank');
  await page.goto(url);
  await page.locator('.geMenubar').getByText('Arrange', { exact: true }).waitFor({ timeout: 60000 });
  await settle(page, 2500);
}

async function fitAndShoot(page: Page, name: string) {
  page.setDefaultTimeout(30000);
  await page.locator('.geDiagramContainer').first().focus().catch(() => {});
  await page.keyboard.press('Control+Shift+A'); // Edit > Select None, so the Diagram format panel shows
  await settle(page, 500);
  // Page View off so "Fit window" fits the diagram content instead of the (larger) page.
  const pageView = page.locator('.geFormatContainer').getByText('Page View', { exact: true }).locator('..').locator('input[type=checkbox]');
  if (await pageView.isChecked({ timeout: 5000 }).catch(() => false)) await pageView.click();
  // The "Unsaved changes" status is noise for an export-free viewing scenario.
  await page.addStyleTag({ content: '.geStatus, .geStatusAlert, .geStatusMessage { visibility: hidden !important; }' });
  await page.locator('.geDiagramContainer').first().focus().catch(() => {});
  await page.keyboard.press('Control+Shift+H'); // View > Fit window
  await settle(page, 2000);
  return shoot(page, name);
}

const { ctx } = await attach();
try {
  const page = await pageFor(ctx, 'diagrams.net');
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.bringToFront();
  await emulate(page);

  const xml = await fs.readFile(path.join(DIR, drawioFile), 'utf8');
  await openInDrawio(page, drawioFile, xml);
  const arch = await fitAndShoot(page, '08-drawio-architecture');
  await saveScene({ slug: '08-drawio-architecture', shots: [{ image: arch, duration: 7 }] });

  const shots: Record<string, string> = {};
  for (const d of mermaid) {
    const slug = d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await openInDrawio(page, `${REQ}_${d.no}_${slug}.drawio`, EMPTY);
    await page.locator('.geMenubar').getByText('Arrange', { exact: true }).click();
    const menu = page.locator('.mxPopupMenu');
    await menu.getByText('Insert', { exact: true }).hover();
    await menu.getByText('Advanced', { exact: true }).hover();
    await menu.getByText(/^Mermaid/).click();
    const ta = page.locator('.geDialog textarea');
    await ta.fill(d.code);
    await page.locator('.geDialog').getByRole('button', { name: 'Insert' }).click();
    await page.locator('.geDialog').waitFor({ state: 'detached', timeout: 30000 });
    shots[d.no] = await fitAndShoot(page, `09-drawio-${d.no}`);
  }

  const pair = (a: string, b: string): Shot[] => [
    { image: shots[a], duration: 4 },
    { image: shots[b], duration: 4 },
  ];
  await saveScene({ slug: '09-drawio-sequences', shots: pair('02', '03') });
  await saveScene({ slug: '10-drawio-lifecycle-data', shots: pair('04', '05') });
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}
