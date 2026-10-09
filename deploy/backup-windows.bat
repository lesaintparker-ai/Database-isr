@echo off
rem Sauvegarde complète : base (à chaud) PUIS fichiers. A planifier chaque nuit (Planificateur de tâches).
rem Adapter DEST (disque externe ou partage réseau) et DATA (dossier ISR_DATA_DIR du serveur).
set DATA=%~dp0..\data
set DEST=E:\SAUVEGARDES_ISR
cd /d "%~dp0\.."
node scripts\backup.js --keep=30 || exit /b 1
rem /MIR : miroir ; /FFT /R:2 /W:5 : tolérant aux partages réseau
robocopy "%DATA%\backups" "%DEST%\backups" /MIR /FFT /R:2 /W:5
robocopy "%DATA%\storage" "%DEST%\storage" /MIR /FFT /R:2 /W:5 /XF *.part
if %ERRORLEVEL% GEQ 8 exit /b 1
exit /b 0
