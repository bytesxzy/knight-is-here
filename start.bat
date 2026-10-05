@echo off
rem Double-click to run the knight sandbox: starts a tiny local server and opens your browser.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is required: https://nodejs.org & pause & exit /b 1)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5173"
node server.js
