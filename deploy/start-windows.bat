@echo off
rem ISR DATABASE - démarrage manuel sous Windows (fenêtre console visible).
rem Pour un démarrage automatique, voir docs\EXPLOITATION.md (Planificateur de tâches ou NSSM).
cd /d "%~dp0\.."
title ISR DATABASE
:loop
node server\index.js
echo.
echo Le serveur s'est arrete. Redemarrage dans 5 secondes (Ctrl+C pour quitter)...
timeout /t 5 /nobreak >nul
goto loop
