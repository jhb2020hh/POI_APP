@echo off
REM =====================================================================
REM  POI-APP - Autostart einrichten (EINMALIG, als Administrator)
REM  ---------------------------------------------------------------------
REM  Richtet einen geplanten Task "POI-APP Server" ein, der den Server
REM  BEIM HOCHFAHREN automatisch und fensterlos startet - ohne dass sich
REM  jemand anmelden muss. Der Task laeuft unter dem angegebenen Benutzer
REM  ("unabhaengig von Anmeldung"); dazu wird einmal dessen Passwort
REM  abgefragt und sicher von Windows gespeichert.
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

cd /d "%~dp0"
set "ROOT=%~dp0"
set "WORKDIR=%ROOT:~0,-1%"
set "LAUNCHER=%ROOT%poiapp_autostart_launcher.cmd"
set "VORLAGE=%ROOT%poiapp_task.xml.vorlage"
set "XML=%TEMP%\poiapp_task.xml"
set "TASKNAME=POI-APP Server"

if not exist "%LAUNCHER%" ( echo FEHLER: poiapp_autostart_launcher.cmd fehlt neben dieser Datei. & pause & exit /b 1 )
if not exist "%VORLAGE%" ( echo FEHLER: poiapp_task.xml.vorlage fehlt neben dieser Datei. & pause & exit /b 1 )

REM --- Run-as-Benutzer: aktuellen vorschlagen, Aenderung erlauben ---
set "USERID=%USERDOMAIN%\%USERNAME%"
echo.
echo   Der Server-Task soll unter diesem Windows-Konto laufen:
echo       %USERID%
echo.
echo   Passt das, einfach ENTER druecken. Soll ein ANDERES Konto den Server
echo   starten (z. B. ein eigenes Dienstkonto), hier  DOMAENE\Benutzer  eingeben:
set "EINGABE="
set /p "EINGABE=>  "
if not "%EINGABE%"=="" set "USERID=%EINGABE%"

REM --- Task-XML aus Vorlage erzeugen (Platzhalter ersetzen, als Unicode) ---
powershell -NoProfile -ExecutionPolicy Bypass -Command "$t=[IO.File]::ReadAllText('%VORLAGE%'); $t=$t.Replace('__USER__','%USERID%').Replace('__LAUNCHER__','%LAUNCHER%').Replace('__WORKDIR__','%WORKDIR%'); [IO.File]::WriteAllText('%XML%',$t,[Text.Encoding]::Unicode)"
if not exist "%XML%" ( echo FEHLER: Konnte Task-Definition nicht erzeugen. & pause & exit /b 1 )

echo.
echo   Es wird jetzt das Passwort fuer %USERID% abgefragt
echo   (Eingabe bleibt unsichtbar). Das ist fuer "unabhaengig von Anmeldung" noetig.
echo.
schtasks /Create /TN "%TASKNAME%" /XML "%XML%" /RU "%USERID%" /F
set "RC=%ERRORLEVEL%"
del /q "%XML%" >nul 2>&1

if not "%RC%"=="0" (
  echo.
  echo   FEHLER beim Einrichten des Tasks (Code %RC%).
  echo   Haeufigste Ursachen: falsches Passwort, oder das Konto darf nicht
  echo   "als Batchauftrag anmelden". Bitte erneut versuchen.
  echo.
  pause
  exit /b %RC%
)

echo.
echo   ============================================================
echo   Autostart eingerichtet. Der Server startet ab dem naechsten
echo   Neustart automatisch (Port 4000 - Adresse wie bei der Doku-App,
echo   z. B. http://dokuapp:4000, oder ueber die IP-Adresse dieses Rechners).
echo.
echo   Bitte sicherstellen (falls noch nicht geschehen):
echo     - npm install / npm run build:backend / npm run build:frontend
echo       einmalig in diesem Ordner ausgefuehrt (siehe POI-APP-EINRICHTUNG.txt)
echo     - Firewall Port 4000 geoeffnet (Firewall-Skript)
echo.
echo   Log/Diagnose:  server_log\server-JJJJMMTT.log
echo   ============================================================
echo.
set "SOFORT="
set /p "SOFORT=Server jetzt sofort starten, ohne Neustart (j/n)?  "
if /i "%SOFORT%"=="j" (
  schtasks /Run /TN "%TASKNAME%"
  echo   Gestartet. Nach ca. 10 Sekunden im Browser pruefen (Port 4000).
)
echo.
pause
