@echo off
setlocal

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo Python virtual environment was not found:
    echo %CD%\.venv\Scripts\python.exe
    pause
    exit /b 1
)

set "CONFIG=config\config.json"
if not exist "%CONFIG%" set "CONFIG=config\config.example.json"

if "%~1" == "" (
    ".venv\Scripts\python.exe" -m src.oooonmyoji.cli --config "%CONFIG%" --help
) else (
    ".venv\Scripts\python.exe" -m src.oooonmyoji.cli --config "%CONFIG%" %*
)
set "EXIT_CODE=%ERRORLEVEL%"

if "%~1" == "" pause
if not "%EXIT_CODE%" == "0" pause
exit /b %EXIT_CODE%
