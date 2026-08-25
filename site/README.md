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

**The site never needs updating when you release.** Both download buttons point
at `releases/latest/download/RoseLite-Setup.exe` — GitHub resolves that alias to
the newest release, and `nsis.artifactName` in `electron-builder.js` keeps the
filename version-free so the URL stays valid forever. `node site/site.test.js`
fails if that link is replaced with a pinned `releases/download/v…` URL, if the
download is disabled again, or if "coming soon" copy creeps back in.

## Deploy with Vercel

Keep the Vercel project's **Root Directory** set to `site`. There are no
environment variables and no serverless functions — `vercel.json` carries only
the security headers and the asset cache policy.
