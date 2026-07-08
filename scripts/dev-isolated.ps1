param(
    [switch]$Reset
)

$ErrorActionPreference = "Stop"

$dataDir = Join-Path $env:LOCALAPPDATA "Cairn\dev-profile"

if ($Reset -and (Test-Path -LiteralPath $dataDir)) {
    Remove-Item -LiteralPath $dataDir -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$env:CAIRN_DATA_DIR = $dataDir

Write-Host "Using isolated Cairn data directory:" -ForegroundColor Cyan
Write-Host $dataDir

pnpm tauri:dev
