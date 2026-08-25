# RoseLite website

The public landing page, and the whole of this Vercel deployment. RoseLite is a
local-only desktop app: there is no account, no API and no database behind this
site any more — the sync service moved out with the card game (see
`DrezByte/RoseTCG`).

```text
site/
├── index.html       # landing page markup, styles, copy, and interactions
├── support.js       # runtime exported with the Claude-designed page
├── site.test.js     # the checks below
└── assets/          # images used by the landing page
```

## Work on the website

Serve the folder with anything static, e.g. from the repository root:

```sh
npx serve site
```

The download controls are intentionally disabled. `node site/site.test.js` fails
if an `.exe`/`.msi` download link or a private GitHub URL is accidentally added.
When the installer is ready, replace the disabled button in `index.html` with the
final release URL and update `site.test.js` at the same time.

## Deploy with Vercel

Keep the Vercel project's **Root Directory** set to `site`. There are no
environment variables and no serverless functions — `vercel.json` carries only
the security headers and the asset cache policy.
