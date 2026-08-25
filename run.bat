@echo off
REM Double-click to run the overlay (Windows). Launch the game first, then this.
REM Needs Node.js installed (nodejs.org). Set the real window title in config.json.
cd /d "%~dp0"
if not exist node_modules ( echo Installing deps... & npm install )
npm start
pause
