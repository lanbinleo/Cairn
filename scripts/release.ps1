param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [switch]$BuildInstaller,
    [switch]$Tag,
    [switch]$PushTag
)

$ErrorActionPreference = "Stop"

function Step($Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-CleanWorktree {
    $status = git status --short
    if ($status) {
        Write-Host $status
        throw "Worktree is not clean. Commit or stash changes before releasing."
    }
}

function Invoke-Checked($Executable, $Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Executable exited with $LASTEXITCODE."
    }
}

function Read-Json($Path) {
    Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Assert-Version($Name, $Actual, $Expected) {
    if ($Actual -ne $Expected) {
        throw "$Name version is '$Actual', expected '$Expected'."
    }
}

Step "Checking repository state"
git rev-parse --show-toplevel | Out-Null
Require-CleanWorktree

Step "Checking version surfaces"
$packageJson = Read-Json "package.json"
$tauriConfig = Read-Json "src-tauri/tauri.conf.json"
$cargoToml = Get-Content -LiteralPath "src-tauri/Cargo.toml" -Raw

Assert-Version "package.json" $packageJson.version $Version
Assert-Version "tauri.conf.json" $tauriConfig.version $Version

if ($cargoToml -notmatch "version\s*=\s*`"$([regex]::Escape($Version))`"") {
    throw "src-tauri/Cargo.toml version does not match '$Version'."
}

$releaseNotes = "docs/release-$Version.md"
if (!(Test-Path -LiteralPath $releaseNotes)) {
    throw "Missing release notes: $releaseNotes"
}

Step "Running frontend build"
Invoke-Checked "pnpm" @("build")

Step "Running Rust checks"
Invoke-Checked "cargo" @("check", "--manifest-path", "src-tauri/Cargo.toml")
Invoke-Checked "cargo" @("test", "--manifest-path", "src-tauri/Cargo.toml")

Step "Building release executable"
Invoke-Checked "cargo" @("build", "--manifest-path", "src-tauri/Cargo.toml", "--release", "--features", "tauri/custom-protocol")

$exe = "src-tauri/target/release/cairn.exe"
if (!(Test-Path -LiteralPath $exe)) {
    throw "Missing release executable: $exe"
}

if ($BuildInstaller) {
    Step "Configuring updater signing"
    $updaterKey = Join-Path $env:USERPROFILE ".tauri\cairn-updater.key"
    if (!(Test-Path -LiteralPath $updaterKey)) {
        throw "Updater signing key not found: $updaterKey. Generate with: pnpm tauri signer generate -w $updaterKey (and update the pubkey in src-tauri/tauri.conf.json)."
    }
    # 密钥为无密码生成；签名公钥内嵌于 tauri.conf.json 与已发布版本。
    # bundler 只认 TAURI_SIGNING_PRIVATE_KEY（密钥内容），不认 _PATH 变体。
    $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -LiteralPath $updaterKey -Raw).Trim()
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""

    Step "Building Tauri installers (signed updater artifacts)"
    # 主配置（非 tauri.local.conf.json）：createUpdaterArtifacts 需要 true 才会生成 .sig
    Invoke-Checked "pnpm" @("tauri", "build")

    $artifacts = @(
        "src-tauri/target/release/bundle/nsis/Cairn_${Version}_x64-setup.exe",
        "src-tauri/target/release/bundle/msi/Cairn_${Version}_x64_en-US.msi"
    )

    foreach ($artifact in $artifacts) {
        if (!(Test-Path -LiteralPath $artifact)) {
            throw "Missing release artifact: $artifact"
        }
    }

    Step "Generating update manifest (latest.json)"
    $nsisSigPath = "src-tauri/target/release/bundle/nsis/Cairn_${Version}_x64-setup.exe.sig"
    if (!(Test-Path -LiteralPath $nsisSigPath)) {
        throw "Missing updater signature: $nsisSigPath (signing env not picked up?)"
    }
    $signature = (Get-Content -LiteralPath $nsisSigPath -Raw).Trim()
    $manifest = [ordered]@{
        version   = $Version
        notes     = "Cairn $Version. See https://github.com/lanbinleo/Cairn/releases/tag/v$Version"
        pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        platforms = [ordered]@{
            "windows-x86_64" = [ordered]@{
                signature = $signature
                url       = "https://github.com/lanbinleo/Cairn/releases/download/v$Version/Cairn_${Version}_x64-setup.exe"
            }
        }
    }
    $manifestPath = "src-tauri/target/release/bundle/latest.json"
    $manifest | ConvertTo-Json -Depth 5 | Out-File -LiteralPath $manifestPath -Encoding utf8

    Write-Host ""
    Write-Host "Upload to the GitHub release (tag v$Version):" -ForegroundColor Yellow
    Write-Host "  - src-tauri/target/release/bundle/nsis/Cairn_${Version}_x64-setup.exe"
    Write-Host "  - src-tauri/target/release/bundle/msi/Cairn_${Version}_x64_en-US.msi"
    Write-Host "  - $manifestPath  (updater manifest; endpoint releases/latest/download/latest.json)"
}

if ($Tag) {
    Step "Creating annotated tag"
    $tagName = "v$Version"
    $existing = git tag --list $tagName
    if ($existing) {
        throw "Tag already exists: $tagName"
    }
    git tag -a $tagName -m "Cairn $Version"

    if ($PushTag) {
        Step "Pushing tag"
        git push origin $tagName
    } else {
        Write-Host "Tag created locally. Push with: git push origin $tagName"
    }
}

Step "Release checks completed"
