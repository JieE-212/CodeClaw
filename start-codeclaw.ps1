$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

Write-Host ""
Write-Host "=========================================="
Write-Host "  CodeClaw Local Launcher"
Write-Host "=========================================="
Write-Host ""

function Stop-WithMessage {
  param([string]$Message)
  Write-Host "[Error] $Message" -ForegroundColor Red
  Write-Host ""
  Read-Host "Press Enter to exit"
  exit 1
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  Stop-WithMessage "Node.js was not found. Please install Node.js 20 or later: https://nodejs.org/"
}

$nodeMajorText = & node -p "process.versions.node.split('.')[0]"
$nodeMajor = 0
if (-not [int]::TryParse($nodeMajorText, [ref]$nodeMajor)) {
  Stop-WithMessage "Could not read the Node.js version. Please make sure the node command works."
}
if ($nodeMajor -lt 20) {
  Stop-WithMessage "Current Node.js major version is $nodeMajor. CodeClaw requires Node.js 20 or later."
}

if (-not $env:CODECLAW_PORT) {
  $env:CODECLAW_PORT = "4173"
}
$port = [int]$env:CODECLAW_PORT
$url = "http://localhost:$port"

$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $port)
try {
  $probe.Start()
  $probe.Stop()
} catch {
  Write-Host "[Error] Port $port is already in use." -ForegroundColor Red
  Write-Host "CodeClaw may already be running, or another app may be using this port."
  Write-Host ""
  Write-Host "You can:"
  Write-Host "1. Open $url and check whether CodeClaw is already available."
  Write-Host "2. Close the app using this port and try again."
  Write-Host "3. Use another port:"
  Write-Host "   `$env:CODECLAW_PORT='4174'; .\start-codeclaw.ps1"
  Write-Host ""
  Read-Host "Press Enter to exit"
  exit 1
}

Write-Host "[OK] Node.js version is supported."
Write-Host "[Start] CodeClaw will run at $url"
Write-Host "[Tip] Keep this window open. Closing it stops the local service."
Write-Host ""

Start-Process $url
& node apps/web/server.js

Write-Host ""
Write-Host "CodeClaw service has stopped."
