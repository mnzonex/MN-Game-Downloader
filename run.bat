@echo off
TITLE MN Game Downloader - Dev Launch Script
COLOR 0A
CLS

echo ===============================================================================
echo                      MN GAME DOWNLOADER - DEV RUNNER
echo                Developer: H M MADHUSHA NIMSARA (MN ZONEX Dev)
echo                       WhatsApp: https://wa.me/94776941748
echo ===============================================================================
echo.

:: Check Node.js installation
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not added to PATH!
    echo Please download and install Node.js v18+ from https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo [✓] Node.js detected:
node -v
echo.

:: Check dependencies folder and required binaries
if not exist "node_modules\tsx\" (
    echo [!] Dependencies missing or incomplete. Installing dependencies...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install npm dependencies!
        pause
        exit /b 1
    )
    echo [✓] Dependencies installed successfully.
    echo.
) else (
    echo [✓] node_modules directory found.
)

:: Check for Electron / Start App
echo [!] Launching MN Game Downloader in development mode...
echo [!] Publisher: H M MADHUSHA NIMSARA
echo.

call npm run electron:dev

if %errorlevel% neq 0 (
    echo.
    echo [!] Development server exited with code %errorlevel%.
)

pause
