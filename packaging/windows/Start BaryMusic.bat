@echo off
setlocal
cd /d "%~dp0"

if not exist "runtime\node.exe" (
  echo Nie znaleziono Node.js / Node.js runtime not found: runtime\node.exe
  echo Pobierz kompletna paczke i rozpakuj wszystkie pliki.
  echo Download the complete package and extract all files.
  pause
  exit /b 1
)

"runtime\node.exe" "app\launcher.js"
set "BARYMUSIC_EXIT_CODE=%ERRORLEVEL%"

if not "%BARYMUSIC_EXIT_CODE%"=="0" pause
exit /b %BARYMUSIC_EXIT_CODE%
