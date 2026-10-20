@echo off
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Premiere installation : creation de l'environnement Python...
  py -m venv .venv || goto error
  ".venv\Scripts\python.exe" -m pip install -q -r api\requirements.txt || goto error
)

echo Demarrage de Comick Flow sur http://127.0.0.1:8001 ...
start "Comick Flow" cmd /k "cd api && ..\.venv\Scripts\python.exe main.py"

set count=0
:waitloop
timeout /t 1 /nobreak >nul
curl -s -o nul -w "%%{http_code}" http://127.0.0.1:8001/api/health > "%TEMP%\comick_status.txt" 2>nul
set /p status=<"%TEMP%\comick_status.txt"
if "%status%"=="200" goto ready
set /a count+=1
if %count% GEQ 20 goto ready
goto waitloop

:ready
del "%TEMP%\comick_status.txt" >nul 2>&1
start http://127.0.0.1:8001/
exit /b 0

:error
echo Echec de l'installation. Verifie que Python 3 est installe (commande "py").
pause
