---
applyTo: "docs/demo-videos/**"
---

# Browser demo automation and recording

Use these rules for all work under `docs/demo-videos`.

## Goal

Build repeatable browser demos in TypeScript with Playwright, and use FFmpeg to capture and finalize shareable video. Optimize for deterministic playback, readable pacing, clean output, and safe handling of authenticated sessions.

## Project conventions

- Use Node.js, TypeScript, and `@playwright/test` unless an existing project in this directory establishes another pattern.
- Keep browser scenarios separate from recording orchestration:
  - `scenarios/` contains Playwright demo flows.
  - `lib/` contains reusable pacing, cursor, browser, and FFmpeg helpers.
  - `scripts/` contains runnable orchestration entry points.
  - `artifacts/` contains temporary captures, screenshots, traces, and logs.
  - `videos/` contains finalized videos.
- Use descriptive scenario slugs for file and output names. Include a timestamp only when preserving multiple runs is required.
- Add generated video, capture, trace, authentication, and temporary files to `.gitignore`. Do not commit large generated media unless the user explicitly requests it.
- Before any npm package operation, inspect the existing npm configuration and use only the configured Microsoft proxy feed. Never switch to the public npm registry.
- Pin dependencies through the package manifest and lockfile. Do not invoke unpinned `@latest` packages in automation scripts.

## Playwright automation

- Run demos in a headed Chromium browser. Use the Playwright-managed Chromium build by default; use installed Chrome or Edge only when the scenario specifically requires it.
- Set deterministic browser dimensions and position. The browser capture region and FFmpeg input region must agree; default final output is 1920x1080 at 30 fps unless the user specifies otherwise.
- Prefer resilient, user-facing locators in this order: role, label, placeholder, text, test ID. Avoid long CSS selectors and XPath.
- Rely on locator auto-waiting and explicit assertions for readiness. Do not use `networkidle` as a general readiness signal.
- Separate functional waits from presentation pacing:
  - Use assertions or URL/state checks to determine when the application is ready.
  - Use a shared `demoStep` or `pauseForViewer` helper for intentional viewer pauses.
  - Avoid scattered raw timeouts.
- Keep each action visually understandable: pause before important actions, type at a readable speed when the typing itself matters, and pause after visible state changes.
- Fail fast if a required element or state is missing. On failure, preserve a screenshot, trace, relevant logs, and the incomplete capture for diagnosis.
- Make scenarios rerunnable. Seed or reset mutable demo data where possible, and avoid depending on leftovers from an earlier run.
- Close the browser context and browser in `finally` blocks.

## Authentication and sensitive data

- Never hardcode usernames, passwords, tokens, tenant IDs, or other secrets.
- Read required values from environment variables and provide a checked-in `.env.example` containing names only.
- Store reusable Playwright authentication state under `playwright/.auth/` and gitignore it. Treat storage-state files as credentials.
- Prefer a dedicated demo account and pre-created storage state over recording an interactive sign-in.
- Never record password entry, MFA prompts, personal notifications, unrelated tabs, or sensitive customer data.

## FFmpeg recording on Windows

- Use FFmpeg's `gdigrab` input for Windows screen capture.
- Prefer a fixed desktop region with a browser placed deterministically at that region. Use window-title capture only when the title is stable and uniquely controlled by the scenario.
- Record to an intermediate Matroska file first, then finalize to MP4. This reduces the chance of losing the entire recording if a run fails before MP4 metadata is finalized.
- Use H.264 with `yuv420p` for broad playback compatibility. Use software `libx264` by default; do not assume a hardware encoder is available.
- A typical silent capture command is:

  `ffmpeg -y -f gdigrab -framerate 30 -draw_mouse 0 -offset_x 0 -offset_y 0 -video_size 1920x1080 -i desktop -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p artifacts/<slug>.capture.mkv`

- A typical finalization command is:

  `ffmpeg -y -i artifacts/<slug>.capture.mkv -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart videos/<slug>.mp4`

- Start FFmpeg only after the browser is launched, positioned, and ready. Wait until FFmpeg has initialized before beginning the first visible step.
- Stop FFmpeg gracefully by writing `q` to its standard input and await process exit. Do not terminate it abruptly unless graceful shutdown has timed out, because abrupt termination can leave unusable output.
- Capture no audio by default. If narration or system audio is requested, enumerate available DirectShow devices at runtime and make the device configurable; never hardcode a machine-specific audio device.
- Playwright input does not reliably move the operating-system cursor. Keep `draw_mouse=0` by default. If a visible pointer is required, implement a page-level cursor indicator that follows scripted pointer actions and does not intercept clicks.
- Do not overwrite a known-good final video until the new capture and finalization have both succeeded.

## Orchestration lifecycle

Implement recording scripts in this order:

1. Validate prerequisites, environment variables, output paths, and that `ffmpeg` is available.
2. Prepare or reset the scenario's demo data.
3. Launch and position the headed browser.
4. Navigate to a clean starting frame and verify readiness.
5. Start FFmpeg and verify that recording initialized successfully.
6. Run the Playwright scenario.
7. Hold the final frame for a short, configurable duration.
8. Gracefully stop FFmpeg.
9. Close Playwright resources.
10. Finalize the intermediate capture to MP4 and verify the output with `ffprobe`.

Always clean up child processes in `finally`. Surface the original scenario error as well as any cleanup or finalization error; do not report success when recording or output verification failed.

## Quality checks

- Before recording, run the scenario once without FFmpeg to verify selectors, authentication, data state, and pacing.
- Verify final media with `ffprobe`: video stream present, expected dimensions, expected approximate frame rate, nonzero duration, and a successful process exit.
- Review at least the opening frame, one middle frame, and the ending frame for clipping, dialogs, notifications, blank pages, and sensitive information.
- Keep the browser and capture region free of terminals, developer tools, automation overlays, and unrelated desktop content unless the user explicitly wants them shown.
- Prefer a clean rerun over editing around automation mistakes. Use FFmpeg post-processing for trimming, concatenation, scaling, fades, and audio mixing, not to conceal a broken scenario.
