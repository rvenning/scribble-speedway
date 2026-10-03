@echo off
cd /d "%~dp0"
set PORT=8115
echo Open http://127.0.0.1:8115/ in your browser to play.
"C:\Program Files\nodejs\node.exe" tools\serve.js
pause
