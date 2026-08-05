@echo off
TITLE MN Game Downloader - NSIS Installer Builder
COLOR 0B
CLS

echo ===============================================================================
echo                MN GAME DOWNLOADER - PRODUCTION INSTALLER BUILDER
echo               Developer: H M MADHUSHA NIMSARA (MN ZONEX Dev)
echo                      WhatsApp: https://wa.me/94776941748
echo ===============================================================================
echo.

echo [1/4] Cleaning previous build artifacts and dist directory...
if exist "dist\" (
    rmdir /s /q "dist"
    echo [✓] Cleaned dist folder.
) else (
    echo [✓] dist folder clean.
)
if exist "build\" (
    rmdir /s /q "build"
    echo [✓] Cleaned build folder.
)
echo.

echo [2/4] Verifying Node.js and build tools...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is required to compile the application!
    pause
    exit /b 1
)

echo [✓] Node version:
node -v
echo.

echo [3/4] Compiling web assets and bundling Electron NSIS installer...
echo [!] Executing production build script (npm run build)...
call npm run build

if %errorlevel% neq 0 (
    echo [ERROR] Build compilation failed! Check TypeScript / Vite output above.
    pause
    exit /b 1
)

echo.
echo [4/4] Generating standalone Windows Executable (.exe) setup...
where npx >nul 2>nul
if %errorlevel% eq 0 (
    call npx electron-builder --win nsis
) else (
    call npm run package
)

if %errorlevel% eq 0 (
    echo.
    echo ===============================================================================
    echo [SUCCESS] BUILD COMPLETE!
    echo Setup Executable created in: .\release\
    echo Developer: H M MADHUSHA NIMSARA (MN ZONEX Dev)
    echo Support WhatsApp: https://wa.me/94776941748
    echo ===============================================================================
) else (
    echo.
    echo [!] Electron Builder process encountered an error. Please check logs.
)

pause
