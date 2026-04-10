@echo off
setlocal

set "NODE_EXE=node"

where node >nul 2>nul
if errorlevel 1 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "NODE_EXE=C:\Program Files\nodejs\node.exe"
    ) else (
        echo Node.js is not installed or not added to PATH.
        echo.
        echo Install Node.js first from https://nodejs.org/
        echo Then close this window, open a new terminal, and run:
        echo npm start
        echo.
        pause
        exit /b 1
    )
)

echo Starting Medical Shop server...
"%NODE_EXE%" server.js
