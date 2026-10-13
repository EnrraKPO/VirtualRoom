@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
set URL=http://localhost:5173
echo.
echo Starting Video Room at %URL%
echo Press Ctrl+C to stop.
echo.
rem WebXR needs Chrome or Edge, opened via localhost.
set BROWSER=
for %%p in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe") do (
  if not defined BROWSER if exist %%p set BROWSER=%%p
)
if defined BROWSER (
  start "" %BROWSER% %URL%
) else (
  echo Chrome/Edge not found, opening default browser. WebXR requires Chrome or Edge.
  start "" %URL%
)
call npx vite --port 5173
pause
