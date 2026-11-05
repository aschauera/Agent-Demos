import { attach } from '../lib/browser.ts';

// Ad-hoc driver: runs the JS body passed via the DEMO_CODE env var with `ctx` and `page` (last page) in scope.
const { browser, ctx } = await attach();
const page = ctx.pages().at(-1)!;
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
try {
  const fn = new AsyncFunction('ctx', 'page', process.env.DEMO_CODE ?? '');
  const out = await fn(ctx, page);
  if (out !== undefined) console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  // Disconnect only; never close the shared browser.
  void browser;
  setTimeout(() => process.exit(), 50);
}
