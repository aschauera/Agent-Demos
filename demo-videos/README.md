# Architecture Expert demo clips

Short (3–8 s) screenshot-based clips with an animated zoom and highlight, plus a slide deck built from the Copilot presentation template with one clip per slide.

Flow: Jira backlog → KAN-6 → Confluence spec → Copilot Studio agent (instructions, tools) → Microsoft 365 Copilot prompt and response → diagrams in draw.io → follow-up prompt → Jira and Confluence updated.

## Prerequisites

- Node.js, Python 3 with `pillow`, `python-pptx` and `lxml`, and FFmpeg on `PATH`
- `npm ci`
- Copy `.env.example` to `.env` and fill in the URLs. `artifacts/template/template.pptx` must contain the branded template.

## Pipeline

1. `npm run browser` starts a headed Edge with a copied profile and CDP on `DEMO_CDP_PORT`. Leave it running.
2. `npm run login` (first time only) walks each system to the account picker. Approve the sign-in yourself; credentials are never typed.
3. Capture the screenshots and focus areas into `artifacts/shots/`:
   - `npm run capture:context`: scenes 01–05 (Jira, Confluence, Copilot Studio)
   - `npm run capture:package`: scenes 06–07; **sends the architecture prompt** and downloads the files to `artifacts/drawio/`
   - `npm run capture:drawio`: scenes 08–10; opens the downloaded diagrams in draw.io
   - `npm run capture:followup`: scenes 11–12; **sends the follow-up prompt, which changes KAN-6 and the Confluence page**

   Set `CAPTURE_ONLY=1` with `capture:package` or `capture:followup` to re-capture an existing conversation without sending the prompt again.
4. `npm run build` merges the shots with the slide copy in `lib/build_manifest.py`, renders the MP4s to `videos/` (1920x1080, 30 fps, H.264 yuv420p) and writes `deck/copilot-architecture-demo.pptx`.

5. `npm run video` exports the deck to `videos/linkedin/copilot-architecture-demo.mp4` (1080p, 30 fps, silent AAC track, faststart) for social posting. PowerPoint renders a timed copy: cover 4 s, each scene its clip length plus 1.5 s, fade transitions. Requires desktop PowerPoint.

Scenes 01–05 show the state *before* the follow-up. Reset KAN-6 to Idea and remove the "Architecture diagrams" section from the Confluence page before re-capturing them.

When finished, stop the browser and delete the copied profile in `%TEMP%\edge-demo-ud`; it holds session cookies.
