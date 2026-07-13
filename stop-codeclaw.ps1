$ErrorActionPreference = "Stop"

function Stop-WithMessage {
  param([string]$Message)
  Write-Host "[CodeClaw stop error] $Message" -ForegroundColor Red
  exit 1
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  Stop-WithMessage "Node.js was not found. Install Node.js 20 or later before stopping this verified candidate."
}

$launcher = Join-Path $PSScriptRoot "scripts\codeclaw-launcher.js"
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  Stop-WithMessage "The verified Node launcher is missing from this candidate."
}

& $nodeCommand.Source $launcher stop --candidate-root $PSScriptRoot @args
exit $LASTEXITCODE
