[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = $(if ($env:PORT) { $env:PORT } else { 8080 })
)

$ErrorActionPreference = "Stop"
$scriptDirectory = if ($PSScriptRoot) {
    $PSScriptRoot
} else {
    Split-Path -Parent $MyInvocation.MyCommand.Path
}
$node = (Get-Command node -ErrorAction Stop).Source
$appUrl = "http://localhost:$Port"
$healthUrl = "http://127.0.0.1:$Port/health"

$listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
if ($listeners | Where-Object { $_.Port -eq $Port }) {
    throw "Port $Port is already in use. Stop that application or choose another port with -Port."
}

$previousPort = $env:PORT
try {
    $env:PORT = $Port.ToString()
    $serverProcess = Start-Process -FilePath $node -ArgumentList "server.mjs" `
        -WorkingDirectory $scriptDirectory -PassThru
} finally {
    $env:PORT = $previousPort
}

try {
    for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
        $serverProcess.Refresh()
        if ($serverProcess.HasExited) {
            throw "The admin client exited before becoming ready. Run npm run start:foreground to inspect the error."
        }

        $response = $null
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 1
        } catch {
            if ($null -ne $_.Exception.Response) {
                throw "Unexpected HTTP response on port $Port."
            }
        }
        if ($response) {
            if ($response.Headers["X-PP-Admin-Client"] -ne "local" -or
                ($response.Content | ConvertFrom-Json).service -ne "power-platform-admin-client") {
                throw "Port $Port responded with a different application."
            }
            Write-Output "The Bridge: $appUrl (PID: $($serverProcess.Id))"
            Write-Output "Startup complete; the server runs independently. Stop it with: Stop-Process -Id $($serverProcess.Id)"
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw "The admin client did not become ready at $appUrl."
} catch {
    $serverProcess.Refresh()
    if (-not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id
    }
    throw
}
