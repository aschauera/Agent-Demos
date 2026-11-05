import fs from 'node:fs/promises';
import path from 'node:path';
import type { Locator, Page } from '@playwright/test';

export const VIEWPORT = { width: 1920, height: 1080 };
export const SHOTS_DIR = path.resolve('artifacts', 'shots');

export type Rect = { x: number; y: number; w: number; h: number };
export type Shot = {
  image: string;
  duration: number;
  focus?: Rect;
  zoom?: boolean;
  highlight?: boolean;
  maxZoom?: number;
  startZoomed?: boolean;
  label?: string;
};
export type CapturedScene = { slug: string; title?: string; tagline?: string; bullets?: string[]; shots: Shot[] };

/** Pin layout to 1920x1080 CSS px and render at 2x so zoomed crops stay sharp. */
export async function emulate(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, deviceScaleFactor: 2, mobile: false });
}

export async function rectOf(...locators: Locator[]): Promise<Rect> {
  const boxes = [];
  for (const l of locators) {
    const b = await l.boundingBox();
    if (!b) throw new Error(`No bounding box for ${l}`);
    boxes.push(b);
  }
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return clamp({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

export function clamp(r: Rect): Rect {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  return { x, y, w: Math.min(r.w - (x - r.x), VIEWPORT.width - x), h: Math.min(r.h - (y - r.y), VIEWPORT.height - y) };
}

export async function shoot(page: Page, name: string): Promise<string> {
  await fs.mkdir(SHOTS_DIR, { recursive: true });
  const file = path.join(SHOTS_DIR, `${name}.png`);
  await page.mouse.move(VIEWPORT.width - 2, VIEWPORT.height - 2).catch(() => {});
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  return path.relative(process.cwd(), file).replaceAll('\\', '/');
}

export async function saveScene(scene: CapturedScene): Promise<void> {
  await fs.mkdir(SHOTS_DIR, { recursive: true });
  await fs.writeFile(path.join(SHOTS_DIR, `${scene.slug}.json`), JSON.stringify(scene, null, 2));
  console.log(`captured ${scene.slug} (${scene.shots.length} shot${scene.shots.length > 1 ? 's' : ''})`);
}

/** Viewer-facing settle time after a visible state change (not a readiness wait). */
export const settle = (page: Page, ms = 1500) => page.waitForTimeout(ms);

export async function dismissIfVisible(l: Locator): Promise<void> {
  if (await l.isVisible().catch(() => false)) await l.click().catch(() => {});
}
