@echo off
echo Arret de Comick Flow...
taskkill /FI "WINDOWTITLE eq Comick Flow*" /T /F >nul 2>&1
echo Termine.
pause
