param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$PromptText = "show top 10 topics by votes"
)

$ErrorActionPreference = "Stop"

function Read-ErrorBody($exception) {
  if (-not $exception.Response) {
    return ""
  }

  $stream = $exception.Response.GetResponseStream()
  if (-not $stream) {
    return ""
  }

  $reader = New-Object System.IO.StreamReader($stream)
  return $reader.ReadToEnd()
}

Write-Host "Checking health at $BaseUrl ..."
$health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -Method Get
if (-not $health.ok) {
  throw "Health check failed"
}

Write-Host "Health OK. Active model: $($health.model)"

$body = @{ input = $PromptText; dryRun = $false } | ConvertTo-Json

try {
  $response = Invoke-RestMethod -Uri "$BaseUrl/api/generate-query" -Method Post -ContentType "application/json" -Body $body
} catch {
  $errorBody = Read-ErrorBody $_.Exception
  if (-not [string]::IsNullOrWhiteSpace($errorBody)) {
    throw "Generate request failed: $errorBody"
  }

  throw
}

if (-not $response.ok) {
  throw "Generation failed: $($response.message)"
}

Write-Host "SQL generation OK"
Write-Host "Model: $($response.model)"
Write-Host "SQL: $($response.sql)"
