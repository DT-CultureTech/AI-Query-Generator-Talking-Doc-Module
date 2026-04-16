param(
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $projectRoot

Write-Host "[1/5] Ensuring .env exists..."
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created .env from .env.example"
}

Write-Host "[2/5] Installing npm dependencies..."
npm install
if ($LASTEXITCODE -ne 0) {
  throw "npm install failed"
}

function TryAddOllamaToPath {
  $candidateDirs = @(
    (Join-Path $env:LOCALAPPDATA "Programs\\Ollama"),
    (Join-Path $env:ProgramFiles "Ollama")
  )

  foreach ($dir in $candidateDirs) {
    $exe = Join-Path $dir "ollama.exe"
    if (Test-Path $exe) {
      $pathSegments = $env:Path -split ";"
      if (-not ($pathSegments -contains $dir)) {
        $env:Path = "$dir;$env:Path"
      }

      return $true
    }
  }

  return $false
}

function Ensure-OllamaCommand {
  $ollama = Get-Command ollama -ErrorAction SilentlyContinue
  if ($ollama) {
    return $true
  }

  [void](TryAddOllamaToPath)
  $ollama = Get-Command ollama -ErrorAction SilentlyContinue
  if ($ollama) {
    return $true
  }

  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) {
    Write-Host "Ollama is missing and winget is not available for auto-install."
    return $false
  }

  Write-Host "[3/5] Ollama not found. Installing via winget..."
  & winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements | Out-Host

  [void](TryAddOllamaToPath)
  $ollama = Get-Command ollama -ErrorAction SilentlyContinue
  if ($ollama) {
    return $true
  }

  if ($LASTEXITCODE -ne 0) {
    Write-Host "winget installation failed."
    return $false
  }

  return [bool](Get-Command ollama -ErrorAction SilentlyContinue)
}

$ollamaReady = Ensure-OllamaCommand
if (-not $ollamaReady) {
  throw "Install Ollama manually from https://ollama.com/download and rerun this script."
}

$modelName = "smollm2:135m"
if (Test-Path ".env") {
  $modelLine = Select-String -Path ".env" -Pattern "^MODEL_NAME=(.+)$" | Select-Object -First 1
  if ($modelLine) {
    $candidate = $modelLine.Matches[0].Groups[1].Value.Trim()
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      $modelName = $candidate
    }
  }
}

Write-Host "[4/5] Pulling model $modelName ..."
ollama pull $modelName
if ($LASTEXITCODE -ne 0) {
  throw "ollama pull failed for model $modelName"
}

Write-Host "[4b/5] Pulling embedding model nomic-embed-text for PDGMS Copilot..."
ollama pull nomic-embed-text
if ($LASTEXITCODE -ne 0) {
  Write-Host "Warning: Could not pull nomic-embed-text. PDGMS Copilot (proposal chat) will not work until this model is available."
  Write-Host "Run manually: ollama pull nomic-embed-text"
}

if ($NoStart) {
  Write-Host "[5/5] Setup complete. Start app using: npm run dev"
  exit 0
}

Write-Host "[5/5] Starting app..."
npm run dev
