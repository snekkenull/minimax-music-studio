# PowerShell launcher for Windows. Detects Node.js, picks a free port,
# starts proxy.js, and opens the UI in the default browser.
#
# Honors env vars: PORT (default 8787), HOST (default 127.0.0.1)
# Requires:      PowerShell 5.1+ (ships with Windows 10/11)
#
# This script lives at the package root (the same directory as proxy.js).
# It is runnable in place — no path discovery needed.

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true

# ── Resolve script directory ────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PackageRoot = $ScriptDir

# ── Helpers ─────────────────────────────────────────────────────────
function Write-Heading([string]$Text) { Write-Host "`n$Text" -ForegroundColor White }
function Write-Info([string]$Text)    { Write-Host "▸ $Text" -ForegroundColor Cyan }
function Write-Ok([string]$Text)      { Write-Host "✓ $Text" -ForegroundColor Green }
function Write-WarnMsg([string]$Text) { Write-Host "! $Text" -ForegroundColor Yellow }
function Write-Err([string]$Text)     { Write-Host "✗ $Text" -ForegroundColor Red }

function Test-PortBusy([int]$Port) {
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        $listener.Stop()
        return $false
    } catch {
        return $true
    }
}

# ── Node.js check ───────────────────────────────────────────────────
$MinNodeMajor = 18
Write-Heading "minimax music studio"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Err "Node.js is not installed (need >= v$MinNodeMajor)."
    Write-Host ""
    Write-Host "Pick the easiest install method:"
    Write-Host ""

    # Prefer winget (Windows 10 1809+/11).
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "  winget (recommended):" -ForegroundColor White
        Write-Host "    winget install OpenJS.NodeJS.LTS" -ForegroundColor Cyan
    }

    # Chocolatey as a fallback.
    $choco = Get-Command choco -ErrorAction SilentlyContinue
    if ($choco) {
        Write-Host "  Chocolatey:" -ForegroundColor White
        Write-Host "    choco install nodejs-lts" -ForegroundColor Cyan
    }

    Write-Host "  Official installer (any user):" -ForegroundColor White
    Write-Host "    https://nodejs.org/en/download" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "After installing Node.js, re-run this script."
    exit 1
}

$nodeVersionOutput = & node --version
$nodeVersion = $nodeVersionOutput.TrimStart('v')
$nodeMajor = [int]($nodeVersion.Split('.')[0])
if ($nodeMajor -lt $MinNodeMajor) {
    Write-Err "Node.js $nodeVersion is too old (need >= v$MinNodeMajor)."
    Write-Host "Update from https://nodejs.org/en/download or via your package manager."
    exit 1
}
Write-Ok "Node.js $nodeVersion"

# ── Verify proxy.js ─────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath (Join-Path $PackageRoot 'proxy.js'))) {
    Write-Err "proxy.js not found at $PackageRoot\proxy.js"
    Write-Host "This script must be run from the music-studio package root."
    exit 1
}

# ── Port handling ───────────────────────────────────────────────────
$Port = if ($env:PORT) { [int]$env:PORT } else { 8787 }
$Host_ = if ($env:HOST) { $env:HOST } else { '127.0.0.1' }

if (Test-PortBusy $Port) {
    Write-WarnMsg "Port $Port is already in use."
    if ([Environment]::UserInteractive) {
        $input = Read-Host "Enter a different port (or press Enter to abort)"
        if ([string]::IsNullOrWhiteSpace($input)) {
            Write-Err "Aborted."
            exit 1
        }
        $Port = [int]$input
        if (Test-PortBusy $Port) {
            Write-Err "Port $Port is also busy. Aborting."
            exit 1
        }
    } else {
        Write-Err "Re-run with PORT=<other> to use a different port."
        exit 1
    }
}

# ── Launch ──────────────────────────────────────────────────────────
Write-Heading "Starting local proxy"
Write-Info ("URL:    http://${Host_}:$Port/")
Write-Info ("Static: $PackageRoot")
Write-Info ("Proxy:  /api/*  →  https://console.gmicloud.ai/api/*")
Write-Host ""
Write-Info "Press Ctrl+C to stop."
Write-Host ""

# Build proxy process. Trap Ctrl+C to kill the child.
$proxy = $null
$cleanedUp = $false
$cleanup = {
    if ($script:cleanedUp) { return }
    $script:cleanedUp = $true
    if ($proxy -and -not $proxy.HasExited) {
        try {
            $proxy.Kill($true)
            $proxy.WaitForExit(2000) | Out-Null
        } catch { }
    }
    Write-Ok "Stopped."
}
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action $cleanup | Out-Null
[Console]::TreatAsControlEnabled = $true

try {
    $env:PORT = "$Port"
    $env:HOST = $Host_
    $proxy = Start-Process -FilePath 'node' -ArgumentList 'proxy.js' `
        -WorkingDirectory $PackageRoot -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $PackageRoot '.proxy.out.log') `
        -RedirectStandardError  (Join-Path $PackageRoot '.proxy.err.log')

    # Give the server a moment to bind before opening the browser.
    Start-Sleep -Milliseconds 1200
    $url = "http://${Host_}:$Port/music-generator.html"
    Start-Process $url | Out-Null

    # Block until the proxy exits.
    while (-not $proxy.HasExited) { Start-Sleep -Milliseconds 500 }
    $exitCode = $proxy.ExitCode
    Write-Info "Proxy exited with code $exitCode"
    exit $exitCode
} catch {
    Write-Err $_.Exception.Message
    exit 1
} finally {
    & $cleanup
}
