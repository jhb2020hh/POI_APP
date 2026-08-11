@echo off
REM =====================================================================
REM  POI-APP - Autostart entfernen (als Administrator)
REM  ---------------------------------------------------------------------
REM  Stoppt den laufenden Server-Task und loescht den geplanten Task
REM  "POI-APP Server". Daten/Programm bleiben unberuehrt - nur der
REM  automatische Start beim Hochfahren wird entfernt.
REM =====================================================================
setlocal EnableExtensions
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Bitte als ADMINISTRATOR ausfuehren:
  echo   Rechtsklick auf diese Datei  ^>  "Als Administrator ausfuehren".
  echo.
  pause
  exit /b 1
)

set "TASKNAME=POI-APP Server"
cd /d "%~dp0"

REM Laufende Instanz sauber stoppen: Stopp-Flag + Task beenden.
if exist "%~dp0server_log" (
  break > "%~dp0server_log\stop.flag"
)
schtasks /End /TN "%TASKNAME%" >nul 2>&1
schtasks /Delete /TN "%TASKNAME%" /F

echo.
echo   Autostart entfernt. Der Server startet beim naechsten Hochfahren
echo   NICHT mehr automatisch.
echo   Manuell starten geht weiterhin ueber  "POI-APP Server starten.cmd".
echo.
pause
