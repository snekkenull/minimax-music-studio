@echo off
REM Windows double-click entry point. Relays to start.ps1 with
REM bypassed execution policy, then keeps the window open if it
REM crashes so the user can read the error.

setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
set EXITCODE=%ERRORLEVEL%

if not %EXITCODE% == 0 (
    echo.
    echo Launcher exited with code %EXITCODE%.
    echo Press any key to close this window.
    pause >nul
)

endlocal & exit /b %EXITCODE%
