<#
.SYNOPSIS
    Aktualisiert eine Server-Kopie (Ordner "<version>.server", Geschwisterordner
    von "POI App") auf den aktuellen Quellcode dieser Master-Kopie. Kopiert NUR
    Quellcode + Konfiguration (packages\*\src, package.json-Dateien, die
    POI-APP-*.cmd/.txt-Skripte) - NICHT node_modules\, dist\, die SQLite-
    Datenbank oder packages\backend\uploads\. Die Server-Kopie muss danach dort
    (bzw. auf dem Ziel-Laptop) selbst gebaut werden:
        npm install
        npm run build:backend
        npm run build:frontend
    (bewusst kein vorgebautes dist\/node_modules\ kopieren - das erzeugt sonst
    Architektur-Probleme mit der nativen bcrypt-Abhaengigkeit, siehe
    POI-APP-EINRICHTUNG.txt).

.BEISPIEL
    # lokale Kopie  ..\<version>.server  aktualisieren/anlegen:
    powershell -ExecutionPolicy Bypass -File .\poiapp_server_update.ps1

    # eine Kopie auf einem anderen Pfad (USB/Netz) aktualisieren:
    powershell -ExecutionPolicy Bypass -File .\poiapp_server_update.ps1 -Ziel "D:\poi-app.server"
#>
[CmdletBinding()]
param([string]$Ziel = "")

$ErrorActionPreference = "Stop"
$Master = $PSScriptRoot

$NeueVersion = (Get-Content (Join-Path $Master "package.json") -Raw | ConvertFrom-Json).version
if (-not $NeueVersion) { throw "Konnte Version nicht aus package.json lesen." }

if (-not $Ziel) {
    $eltern = Split-Path $Master
    $kand = Get-ChildItem -Path $eltern -Directory -ErrorAction SilentlyContinue |
        Where-Object { ($_.Name -like "*.server") -and (Test-Path (Join-Path $_.FullName "packages\backend\package.json")) } |
        Sort-Object Name -Descending | Select-Object -First 1
    $ZielName = "$NeueVersion.server"
    if ($kand) {
        if ($kand.Name -ne $ZielName) {
            $neuerPfad = Join-Path $eltern $ZielName
            if (Test-Path $neuerPfad) {
                throw "Zielordner '$neuerPfad' existiert bereits - kann '$($kand.FullName)' nicht dorthin umbenennen. Bitte manuell aufraeumen."
            }
            Write-Host "Benenne Server-Kopie um (Versionswechsel): $($kand.Name) -> $ZielName"
            Rename-Item -Path $kand.FullName -NewName $ZielName
            $Ziel = $neuerPfad
        } else {
            $Ziel = $kand.FullName
        }
    } else {
        $Ziel = Join-Path $eltern $ZielName
    }
}

Write-Host "Master       : $Master"
Write-Host "Server-Kopie : $Ziel"
Write-Host "Version      : $NeueVersion"
Write-Host ""

New-Item -ItemType Directory -Force -Path $Ziel | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Ziel "packages\backend") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Ziel "packages\frontend") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Ziel "packages\shared") | Out-Null

# Nur die Quellcode-Ordner spiegeln (neue/geaenderte Dateien). KEIN /PURGE,
# damit server-eigene Zusatzdateien erhalten bleiben.
foreach ($d in @("packages\backend\src", "packages\frontend\src", "packages\frontend\public", "packages\shared\src")) {
    $q = Join-Path $Master $d
    $z = Join-Path $Ziel $d
    if (Test-Path $q) {
        Write-Host "  spiegele $d\ ..."
        robocopy $q $z /E /XD "__pycache__" /NFL /NDL /NP /R:1 /W:1 | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy-Fehler bei $d (Code $LASTEXITCODE)." }
    }
}

# Konfigurationsdateien (kein Code, aber fuer npm install/build noetig).
$KonfigDateien = @(
    "package.json",
    "package-lock.json",
    "tsconfig.base.json",
    "packages\backend\package.json",
    "packages\backend\tsconfig.json",
    "packages\frontend\package.json",
    "packages\frontend\index.html",
    "packages\frontend\tsconfig.json",
    "packages\frontend\tsconfig.app.json",
    "packages\frontend\tsconfig.node.json",
    "packages\frontend\vite.config.ts",
    "packages\frontend\.oxlintrc.json",
    "packages\shared\package.json"
)
foreach ($f in $KonfigDateien) {
    $q = Join-Path $Master $f
    if (Test-Path $q) {
        Copy-Item $q (Join-Path $Ziel $f) -Force
        Write-Host "  kopiert  $f"
    }
}

# Deployment-Skripte + Anleitung aus der Master-Wurzel in die Server-Wurzel spiegeln.
$DeploySkripte = @(
    "POI-APP Server starten.cmd",
    "poiapp_autostart_launcher.cmd",
    "poiapp_task.xml.vorlage",
    "POI-APP - Autostart einrichten (Admin).cmd",
    "POI-APP - Autostart entfernen (Admin).cmd",
    "POI-APP - Firewall Port 4000 oeffnen (Admin).cmd",
    "POI-APP-EINRICHTUNG.txt",
    "ADMIN-ZUGANGSDATEN.txt",
    "poiapp_server_update.ps1"
)
foreach ($f in $DeploySkripte) {
    $q = Join-Path $Master $f
    if (Test-Path $q) {
        Copy-Item $q (Join-Path $Ziel $f) -Force
        Write-Host "  kopiert  $f"
    }
}

Write-Host ""
Write-Host "Fertig. Server-Kopie ist jetzt auf Quellcode-Stand ${NeueVersion}: $Ziel"
Write-Host ""
Write-Host "NICHT kopiert (bleiben unangetastet bzw. muessen dort neu erzeugt werden):"
Write-Host "  node_modules\, dist\ (je Paket)  -> dort einmalig: npm install"
Write-Host "                                                      npm run build:backend"
Write-Host "                                                      npm run build:frontend"
Write-Host "  packages\backend\data.sqlite*, packages\backend\uploads\, server_log\  -> Nutzdaten des Servers, bleiben erhalten"
Write-Host ""
Write-Host "Danach den Server dort neu starten (siehe POI-APP-EINRICHTUNG.txt, Abschnitt 'Taeglicher Betrieb')."
