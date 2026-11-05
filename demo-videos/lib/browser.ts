import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const CDP_URL = `http://127.0.0.1:${process.env.DEMO_CDP_PORT ?? '9333'}`;

export async function attach(): Promise<{ browser: Browser; ctx: BrowserContext }> {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctx = browser.contexts()[0];
  return { browser, ctx };
}

export async function pageFor(ctx: BrowserContext, hostFragment: string): Promise<Page> {
  const existing = ctx.pages().find((p) => p.url().includes(hostFragment));
  if (existing) {
    await existing.bringToFront();
    return existing;
  }
  return ctx.newPage();
}
