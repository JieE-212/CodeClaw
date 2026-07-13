$ErrorActionPreference = "Stop"

function Stop-WithMessage {
  param([string]$Message)
  Write-Host "[CodeClaw launcher error] $Message" -ForegroundColor Red
  exit 1
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  Stop-WithMessage "Node.js was not found. Install Node.js 20 or later, then run this launcher again."
}

$nodeVersion = & $nodeCommand.Source -p "process.versions.node" 2>$null
if ($LASTEXITCODE -ne 0 -or -not ($nodeVersion -match '^(\d+)\.')) {
  Stop-WithMessage "The Node.js version could not be read safely."
}
if ([int]$Matches[1] -lt 20) {
  Stop-WithMessage "Node.js $nodeVersion is unsupported. CodeClaw requires Node.js 20 or later."
}

$launcher = Join-Path $PSScriptRoot "scripts\codeclaw-launcher.js"
if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  Stop-WithMessage "The verified Node launcher is missing from this candidate."
}

& $nodeCommand.Source $launcher start --candidate-root $PSScriptRoot @args
exit $LASTEXITCODE
