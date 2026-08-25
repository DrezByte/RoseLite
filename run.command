#!/bin/zsh
# Double-click to run the overlay (macOS). Testing aid — launch the game first,
# then this. On first run macOS will ask to grant "Electron" Accessibility
# permission (System Settings > Privacy & Security > Accessibility); the overlay
# can't find the game window until you do.
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
npm start
