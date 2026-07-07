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
pnpm build

Step "Running Rust checks"
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml

Step "Building release executable"
cargo build --manifest-path src-tauri/Cargo.toml --release --features tauri/custom-protocol

$exe = "src-tauri/target/release/cairn.exe"
if (!(Test-Path -LiteralPath $exe)) {
    throw "Missing release executable: $exe"
}

if ($BuildInstaller) {
    Step "Building Tauri installers"
    pnpm tauri:build

    $artifacts = @(
        "src-tauri/target/release/bundle/nsis/Cairn_${Version}_x64-setup.exe",
        "src-tauri/target/release/bundle/msi/Cairn_${Version}_x64_en-US.msi"
    )

    foreach ($artifact in $artifacts) {
        if (!(Test-Path -LiteralPath $artifact)) {
            throw "Missing release artifact: $artifact"
        }
    }
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
