// Captures scenes 06-07: new Copilot chat with the architecture prompt, then the completed response + diagram files.
// Sends a real prompt (the agent creates diagram files). Set CAPTURE_ONLY=1 to re-capture the current conversation
// without sending again. Downloads the generated files to artifacts/drawio/ for scenario 03.
import fs from 'node:fs/promises';
import path from 'node:path';
import { attach, pageFor } from '../lib/browser.ts';
import { emulate, rectOf, saveScene, settle, shoot } from '../lib/capture.ts';
import { composer, likeButtons, waitForResponse } from '../lib/copilot.ts';

const REQ = process.env.REQ_ID!;
const PROMPT = `Create the complete architecture diagram package for ${REQ}`;
const CAPTURE_ONLY = process.env.CAPTURE_ONLY === '1';

const { ctx } = await attach();
try {
  const page = await pageFor(ctx, 'copilot.cloud.microsoft');
  page.setDefaultTimeout(30000);
  await page.bringToFront();
  await emulate(page);

  if (!CAPTURE_ONLY) {
    await page.goto(process.env.COPILOT_AGENT_URL!);
    const box = composer(page);
    await box.waitFor({ timeout: 60000 });
    await settle(page, 2000);
    await box.click();
    await page.keyboard.type(PROMPT, { delay: 15 });
    await settle(page, 800);
    const typed = await shoot(page, '06-copilot-prompt');
    const composerFocus = await rectOf(box.locator('xpath=ancestor::*[.//button][1]'));
    await saveScene({
      slug: '06-copilot-prompt',
      shots: [{ image: typed, duration: 6, focus: composerFocus, zoom: true, highlight: true, maxZoom: 2 }],
    });
    const before = await likeButtons(page).count();
    await page.keyboard.press('Enter');
    await waitForResponse(page, before);
  }
  await settle(page, 2000);
  const main = page.locator('main');

  // Shot A: the diagram package overview table at the top of the answer.
  const table = main.locator('table').last();
  await table.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await settle(page, 1200);
  const overview = await shoot(page, '07-copilot-overview');
  const tableFocus = await rectOf(table.locator('xpath=..'), main.getByRole('heading', { name: 'The package' }).last());
  const wrap = await table.locator('xpath=..').boundingBox();
  if (wrap) tableFocus.w = Math.min(tableFocus.w, wrap.x + wrap.width - tableFocus.x);

  // Shot B: end of the answer with the generated files.
  const files = main.getByRole('button', { name: new RegExp(`${REQ}_.*\\.(drawio|md)`) });
  await likeButtons(page).last().evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await settle(page, 1200);
  const filesIntro = main.getByText(/Files are in/).last();
  const end = await shoot(page, '07-copilot-files');
  const filesFocus = await rectOf(filesIntro, files.first(), files.last());
  filesFocus.w = Math.max(filesFocus.w, 520);

  await saveScene({
    slug: '07-copilot-response',
    shots: [
      { image: overview, duration: 3.6, focus: tableFocus, zoom: true, highlight: true, maxZoom: 1.6 },
      { image: end, duration: 4.4, focus: filesFocus, zoom: true, highlight: true, maxZoom: 1.9 },
    ],
  });

  // Download the generated diagram files for the draw.io scenario.
  const outDir = path.resolve('artifacts', 'drawio');
  await fs.mkdir(outDir, { recursive: true });
  for (let i = 0; i < (await files.count()); i++) {
    const dl = page.waitForEvent('download', { timeout: 30000 });
    await files.nth(i).click();
    const d = await dl;
    await d.saveAs(path.join(outDir, d.suggestedFilename()));
    console.log(`downloaded ${d.suggestedFilename()}`);
  }
  await settle(page, 1000);
  for (const p of ctx.pages()) {
    if (p.url().startsWith('edge://')) await Promise.race([p.close().catch(() => {}), page.waitForTimeout(3000)]);
  }
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  process.exit(process.exitCode ?? 0);
}
