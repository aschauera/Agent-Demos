import type { Locator, Page } from '@playwright/test';

// The composer markup differs between a new chat (#m365-chat-editor-target-element) and a continued conversation (EditorInput span).
export const composer = (page: Page): Locator =>
  page.locator('#m365-chat-editor-target-element, [role="textbox"][aria-label*="Chat message input"]').first();

/** Each completed answer gets its own Like/Dislike/Copy row. */
export const likeButtons = (page: Page): Locator => page.locator('main').getByRole('button', { name: 'Like', exact: true });

/**
 * Waits until a new answer has completed: one more Like button than `before`, then the transcript stays unchanged briefly.
 * Text-quiet detection alone is unreliable because the agent pauses for long stretches while reasoning and calling tools.
 */
export async function waitForResponse(page: Page, before: number, timeoutMs = 15 * 60_000): Promise<void> {
  await likeButtons(page).nth(before).waitFor({ timeout: timeoutMs });
  let last = -1;
  for (let i = 0; i < 10; i++) {
    const len = await page.evaluate(() => document.querySelector('main')?.textContent?.length ?? 0);
    if (len === last) return;
    last = len;
    await page.waitForTimeout(1500);
  }
}
