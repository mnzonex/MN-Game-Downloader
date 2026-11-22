@echo off
TITLE MN Game Downloader v1.2.29 - Production Installer Builder
COLOR 0B
CLS

echo ===============================================================================
echo             MN GAME DOWNLOADER v1.2.29 - PRODUCTION INSTALLER BUILDER
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
echo [OK] Previous releases are preserved. The new build will use release-v1.2.29\
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


:: -- Done -----------------------------------------------------------------------
echo.
echo ===============================================================================
echo  [SUCCESS] MN Game Downloader v1.2.29 installer built successfully!
echo  Setup files are located in the .\release-v1.2.29 folder.
echo  Existing release folders are preserved. No GitHub release was published.
echo.
echo  Developer: H M MADHUSHA NIMSARA (MN ZONEX Dev)
echo  WhatsApp Support: https://wa.me/94776941748
echo ===============================================================================
echo.
pause