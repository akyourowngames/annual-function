@echo off
REM tunnel.bat - double-click this to open the Telegram tunnel helper.
REM It finds tunnel.ps1 next to this file and runs it with PowerShell 7 (pwsh),
REM falling back to Windows PowerShell if pwsh is not installed.

setlocal
set "HERE=%~dp0"
set "SCRIPT=%HERE%tunnel.ps1"

if not exist "%SCRIPT%" (
  echo.
  echo   tunnel.ps1 is missing from this folder:
  echo     %HERE%
  echo.
  pause
  exit /b 1
)

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
)

if %ERRORLEVEL% neq 0 (
  echo.
  echo   The helper stopped with an error. Read the message above.
  pause
)
endlocal
