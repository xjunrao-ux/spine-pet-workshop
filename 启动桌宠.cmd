@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\.bin\electron.cmd" goto missing_dependencies
if not exist "dist\index.html" goto missing_build

call "node_modules\.bin\electron.cmd" .
if errorlevel 1 goto launch_failed
goto done

:missing_dependencies
echo ERROR: Desktop pet dependencies are missing.
echo Run this command in the project directory:
echo corepack pnpm install
pause
exit /b 1

:missing_build
echo ERROR: The desktop pet has not been built.
echo Run this command in the project directory:
echo corepack pnpm build
pause
exit /b 1

:launch_failed
echo.
echo ERROR: The desktop pet failed to start.
pause
exit /b 1

:done
endlocal
exit /b 0
