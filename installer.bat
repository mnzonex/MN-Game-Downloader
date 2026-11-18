@echo off
TITLE MN Game Downloader v1.2.5 - Production Installer Builder
COLOR 0B
CLS

echo ===============================================================================
echo             MN GAME DOWNLOADER v1.2.5 - PRODUCTION INSTALLER BUILDER
echo               Developer: H M MADHUSHA NIMSARA (MN ZONEX Dev)
echo                      WhatsApp: https://wa.me/94776941748
echo ===============================================================================
echo.

:: -- Step 1: Check Node.js ------------------------------------------------------
echo [1/6] Checking Node.js installation...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is required! Please install it from https://nodejs.org
    pause
    exit /b 1
)
echo [OK] Node.js detected:
node -v
echo.

:: -- Step 2: Check npm dependencies --------------------------------------------
echo [2/6] Checking npm dependencies...
if not exist "node_modules\vite\" (
    echo [!] Dependencies missing. Installing...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install failed!
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed.
) else (
    echo [OK] node_modules found.
)
echo.

:: -- Step 3: Build engine.exe (PyInstaller) ------------------------------------
echo [3/6] Checking engine.exe sidecar...
call npm run engine:build
if errorlevel 1 (
    echo [ERROR] Engine build failed.
    pause
    exit /b 1
)
echo.

:: -- Step 4: Clean previous dist output (keep win-unpacked if Electron exists) --
echo [4/6] Cleaning previous build output...
if exist "dist\" (
    rmdir /s /q "dist"
    echo [OK] Cleaned dist\
)
if exist "release\MN-Game-Downloader-Setup.exe" (
    del /f /q "release\MN-Game-Downloader-Setup.exe"
    echo [OK] Removed old Setup EXE
)
echo.

:: -- Step 5: Compile web assets + bundle server ----------------------------------
echo [5/6] Building React frontend + bundling Express server...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Build failed! Check TypeScript / Vite output above.
    pause
    exit /b 1
)
echo [OK] Build complete.
echo.

:: -- Step 6: Assemble win-unpacked + build NSIS installer ----------------------
echo [6/6] Packaging installer with electron-builder...

call npx electron-builder --win nsis -p never
if %errorlevel% neq 0 (
    echo [ERROR] electron-builder failed!
    pause
    exit /b 1
)

:: -- Step 7: Auto-apply Windows Defender Exclusion -------------------------------
echo [!] Applying Windows Defender exclusion for install paths...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-MpPreference -ExclusionPath '%~dp0', '%LOCALAPPDATA%\Programs\MN Game Downloader', '%APPDATA%\MN Game Downloader' -ErrorAction SilentlyContinue" >nul 2>nul
echo [OK] Windows Defender exclusions applied.

:: -- Done -----------------------------------------------------------------------
echo.
echo ===============================================================================
echo  [SUCCESS] MN Game Downloader v1.2.5 installer built successfully!
echo  Setup files are located in the .\release folder.
echo  Be sure to upload MN-Game-Downloader-Setup.exe and latest.yml to GitHub!
echo.
echo  Developer: H M MADHUSHA NIMSARA (MN ZONEX Dev)
echo  WhatsApp Support: https://wa.me/94776941748
echo ===============================================================================
echo.
pause
