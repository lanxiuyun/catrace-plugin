@echo off
cd /d "%~dp0"
pyinstaller --clean pastedrop.spec
if errorlevel 1 (
    echo Build failed.
    pause
    exit /b 1
)
echo.
echo Build succeeded: "%~dp0dist\PasteDrop.exe"
pause
