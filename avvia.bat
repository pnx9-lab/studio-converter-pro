@echo off
chcp 65001 >nul
title Studio Converter Pro - Server Locale
echo.
echo ========================================
echo   Studio Converter Pro v5.1.0
echo   Avvio server locale...
echo ========================================
echo.

:: Prova con npx serve (serve serve per SPA/PWA)
if exist node_modules\.bin\serve.cmd (
    echo [OK] Trovato 'serve' in node_modules
    npx serve . -l 3000
) else if exist node_modules\.bin\http-server.cmd (
    echo [OK] Trovato 'http-server' in node_modules
    npx http-server . -p 3000 -c-1
) else (
    echo [INFO] Nessun server locale installato, provo con Python...
    python -m http.server 3000 2>nul || python3 -m http.server 3000 2>nul || (
        echo.
        echo [ERRORE] Nessun server trovato!
        echo.
        echo Installa uno di questi:
        echo   npm install -g serve
        echo   npm install -g http-server
        echo.
        echo Oppure installa Python da python.org
        echo.
        pause
        exit /b 1
    )
)

echo.
echo Server avviato su http://localhost:3000
echo Premi CTRL+C per fermare
pause