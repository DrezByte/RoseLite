# Account class icons

Drop any square image files here — the picker reads the folder directly, so
whatever you add shows up automatically. The icon's name (in the picker and as
the stored value) is the filename without extension.

Supported extensions: `.png` `.webp` `.jpg` `.jpeg` `.gif` `.svg`.

They show as the account avatar in the launcher and are picked in the
add/edit-account modal. Square works best (rendered ~34–40px, `object-fit:cover`).
Missing files degrade gracefully — the picker falls back to the name text and
the launcher avatar just hides.
