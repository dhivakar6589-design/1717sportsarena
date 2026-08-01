# One-time helper: put the LIVE Razorpay keys onto your Render service via the Render API.
# Nothing you type is printed, saved to disk, or written to the repo.
#
# You need ONE thing first (30 seconds):
#   Render Dashboard -> top-right avatar -> Account Settings -> API Keys -> "Create API Key"
#   It looks like: rnd_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
#
# Run:  .\set-live-keys.ps1

$ErrorActionPreference = 'Stop'

function Read-Secret([string]$label) {
    $secure = Read-Host -Prompt $label -AsSecureString
    if ($secure -eq $null -or $secure.Length -eq 0) {
        Write-Error "$label cannot be empty."
    }
    $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
}

Write-Host ''
Write-Host '=== 1717 Sports Arena - set LIVE Razorpay keys on Render ===' -ForegroundColor Cyan
Write-Host '(all inputs are hidden; nothing is saved to disk)' -ForegroundColor Gray
Write-Host ''

$apiKey   = Read-Secret 'Render API key (rnd_...)'
$keyId    = Read-Secret 'Razorpay Key ID (rzp_live_...)'
$keySecret = Read-Secret 'Razorpay Key Secret'
$serviceName = '1717-sports-arena'

$headers = @{
    'Authorization' = "Bearer $apiKey"
    'Content-Type'  = 'application/json'
    'Accept'        = 'application/json'
}

Write-Host ''
Write-Host "Looking up Render service '$serviceName'..." -ForegroundColor Yellow

$services = Invoke-RestMethod -Uri 'https://api.render.com/v1/services?limit=100' -Headers $headers -Method Get
$service = $services | Where-Object { $_.service.name -eq $serviceName } | Select-Object -First 1

if (-not $service) {
    Write-Error "Service '$serviceName' not found in your Render account. Check the name or API key."
}
$serviceId = $service.service.id
Write-Host "Found service: $($service.service.name) ($serviceId)" -ForegroundColor Green

if ($keyId -notlike 'rzp_live_*') {
    Write-Host 'WARNING: Key ID does not start with rzp_live_ - this looks like a TEST key.' -ForegroundColor Red
    $yes = Read-Host 'Continue anyway? (y/N)'
    if ($yes -notmatch '^y') { Write-Host 'Aborted.'; exit 1 }
}

Write-Host 'Sending RAZORPAY_KEY_ID ...' -ForegroundColor Yellow
Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/env-vars/RAZORPAY_KEY_ID" -Headers $headers -Method Put -Body (@{ value = $keyId } | ConvertTo-Json) | Out-Null

Write-Host 'Sending RAZORPAY_KEY_SECRET ...' -ForegroundColor Yellow
Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/env-vars/RAZORPAY_KEY_SECRET" -Headers $headers -Method Put -Body (@{ value = $keySecret } | ConvertTo-Json) | Out-Null

Write-Host 'Triggering redeploy ...' -ForegroundColor Yellow
Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/deploys" -Headers $headers -Method Post -Body '{}' | Out-Null

Write-Host ''
Write-Host 'DONE. Live keys are set on Render and a deploy has started.' -ForegroundColor Green
Write-Host 'Check the Render logs in a couple of minutes - you should see:' -ForegroundColor Green
Write-Host '    "✅ Razorpay is LIVE - real payments are enabled."' -ForegroundColor Green
