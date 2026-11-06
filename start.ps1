$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$pizzaNode = if ($nodeCommand) { $nodeCommand.Source } else { $null }

if (-not $pizzaNode) {
    $runtimePackages = Get-AppxPackage -Name 'OpenAI.CodexPrimaryRuntime*' -ErrorAction SilentlyContinue | Sort-Object Version -Descending
    foreach ($runtimePackage in $runtimePackages) {
        $candidate = Join-Path $runtimePackage.InstallLocation 'dependencies\node\bin\node.exe'
        if (Test-Path -LiteralPath $candidate) { $pizzaNode = $candidate; break }
    }
}
if (-not $pizzaNode) {
    $codexPackages = Get-AppxPackage -Name 'OpenAI.Codex' -ErrorAction SilentlyContinue | Sort-Object Version -Descending
    foreach ($codexPackage in $codexPackages) {
        $candidate = Join-Path $codexPackage.InstallLocation 'app\resources\cua_node\bin\node.exe'
        if (Test-Path -LiteralPath $candidate) { $pizzaNode = $candidate; break }
    }
}
if (-not $pizzaNode) {
    Write-Host 'PizzaOff needs Node.js 20 or newer. Install the LTS version from https://nodejs.org, then run this file again.' -ForegroundColor Yellow
    exit 1
}

$pizzaPort = if ($env:PORT) { [int]$env:PORT } else { 3210 }
$pizzaUrl = "http://127.0.0.1:$pizzaPort"
$alreadyRunning = $false
try {
    $reply = Invoke-RestMethod -Uri "$pizzaUrl/api/competitions" -TimeoutSec 2
    $alreadyRunning = $null -ne $reply.competitions
} catch { }
if ($alreadyRunning) {
    Start-Process $pizzaUrl
    Write-Host "PizzaOff is already running at $pizzaUrl."
    exit 0
}

$browserJob = Start-Job -ArgumentList $pizzaUrl -ScriptBlock {
    param($pizzaUrl)
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $pizzaUrl -TimeoutSec 1
            if ($response.StatusCode -eq 200) { Start-Process $pizzaUrl; break }
        } catch { }
        Start-Sleep -Milliseconds 300
    }
}
Write-Host 'Keep this window open while judging. Close it or press Ctrl+C to stop PizzaOff.' -ForegroundColor Yellow
try { & $pizzaNode (Join-Path $PSScriptRoot 'server.mjs') }
finally { Stop-Job $browserJob -ErrorAction SilentlyContinue; Remove-Job $browserJob -Force -ErrorAction SilentlyContinue }
