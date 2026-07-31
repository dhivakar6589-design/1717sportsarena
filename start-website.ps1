# Start backend server in a new PowerShell window and open the website
# Usage: from repository root: .\start-website.ps1

$backendDir = Join-Path $PSScriptRoot 'backend'
Start-Process powershell -ArgumentList '-NoExit','-Command','node server.js' -WorkingDirectory $backendDir
Start-Sleep -Seconds 2
Start-Process 'http://localhost:4000'
