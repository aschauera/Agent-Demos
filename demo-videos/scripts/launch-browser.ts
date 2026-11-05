import { chromium } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';

// Launches a long-lived headed Edge instance exposing CDP so scenario scripts can attach via connectOverCDP.
const userDataDir = process.env.DEMO_USER_DATA_DIR ?? path.join(os.tmpdir(), 'edge-demo-ud');
const profile = process.env.DEMO_PROFILE ?? 'Profile 2';
const port = process.env.DEMO_CDP_PORT ?? '9333';

const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: 'msedge',
  headless: false,
  viewport: { width: 1920, height: 1080 },
  args: [`--profile-directory=${profile}`, `--remote-debugging-port=${port}`, '--window-position=0,0'],
});
console.log(`browser ready on CDP port ${port}`);
ctx.on('close', () => process.exit(0));
await new Promise(() => {});
