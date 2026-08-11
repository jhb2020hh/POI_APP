@echo off
REM =====================================================================
REM  Oeffnet eingehend TCP 4000, damit Kollegen-Laptops den Server
REM  erreichen koennen. EINMALIG, als Administrator.
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

netsh advfirewall firewall add rule name="POI-APP 4000" dir=in action=allow protocol=TCP localport=4000 profile=domain,private

echo.
echo   Firewall-Regel "POI-APP 4000" gesetzt (eingehend TCP 4000).
echo.
echo   Server-Adresse fuer die Kollegen (derselbe Rechnername/dieselbe IP
echo   wie die Doku-App, nur Port 4000 statt 8000):
for /f "tokens=2 delims=:" %%I in ('ipconfig ^| findstr /i "IPv4"') do for /f "tokens=*" %%J in ("%%I") do echo       http://%%J:4000
echo.
pause
