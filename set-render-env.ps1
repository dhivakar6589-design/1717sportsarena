# One-time helper: push every production secret onto your Render service, then redeploy.
# Values come from backend/.env where possible, so you only type the Render API key.
# Nothing is printed to the console or written to disk.
#
# You need ONE thing first (30 seconds):
#   Render Dashboard -> top-right avatar -> Account Settings -> API Keys -> "Create API Key"
#   It looks like: rnd_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
#
# Run:  .\set-render-env.ps1
#      .\set-render-env.ps1 -ServiceName "my-service"

param(
    [string]$ServiceName = '1717-sports-arena'
)

$ErrorActionPreference = 'Stop'

$EnvFile = Join-Path $PSScriptRoot 'backend\.env'

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

# Read backend/.env without printing anything.
function Get-LocalEnv {
    $values = @{}
    if (-not (Test-Path -LiteralPath $EnvFile)) {
        Write-Error "Cannot find $EnvFile. Run this from the project folder."
    }
    foreach ($line in Get-Content -LiteralPath $EnvFile) {
        if ($line -match '^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$') {
            $values[$matches[1]] = $matches[2].Trim()
        }
    }
    return $values
}

function New-JwtSecret {
    # RNGCryptoServiceProvider rather than RandomNumberGenerator.Fill, because
    # PowerShell 5.1 runs on .NET Framework where Fill() does not exist.
    $bytes = New-Object byte[] 32
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return [Convert]::ToBase64String($bytes)
}

Write-Host ''
Write-Host '=== 1717 Sports Arena - push all secrets to Render ===' -ForegroundColor Cyan
Write-Host '(values are read from backend/.env; secrets are never printed)' -ForegroundColor Gray
Write-Host ''

$local = Get-LocalEnv

# --- Gather every value we intend to send ---

$dbUrl = $local['DATABASE_URL']
if ([string]::IsNullOrWhiteSpace($dbUrl)) {
    Write-Error 'DATABASE_URL is missing from backend/.env. Add your Neon/Supabase connection string first.'
}

$jwtSecret = New-JwtSecret
Write-Host 'JWT_SECRET: generating a fresh 32-byte random value' -ForegroundColor Gray

$adminUser = $local['ADMIN_USERNAME']
if ([string]::IsNullOrWhiteSpace($adminUser)) { $adminUser = 'admin' }

$adminPass = $local['ADMIN_PASSWORD']
if ([string]::IsNullOrWhiteSpace($adminPass)) {
    $adminPass = Read-Secret 'ADMIN_PASSWORD (none set locally)'
}
if ($adminPass -eq 'changeme123') {
    Write-Host ''
    Write-Host 'WARNING: the local admin password is still the default.' -ForegroundColor Red
    $new = Read-Secret 'Enter a NEW admin password (at least 12 characters)'
    if ($new.Length -lt 12) {
        Write-Error 'Admin password must be at least 12 characters.'
    }
    $adminPass = $new
    Write-Host 'Admin password updated in memory for this deploy only.' -ForegroundColor Yellow
    Write-Host 'It is NOT written to backend/.env - update that file separately.' -ForegroundColor Yellow
}

$rzpId     = $local['RAZORPAY_KEY_ID']
$rzpSecret = $local['RAZORPAY_KEY_SECRET']
if ([string]::IsNullOrWhiteSpace($rzpId)) {
    Write-Host ''
    Write-Warning 'RAZORPAY_KEY_ID is empty in backend/.env - payments will be disabled.'
}

$r2Bucket = $local['R2_BUCKET']
$r2Id     = $local['R2_ACCESS_KEY_ID']
$r2Secret = $local['R2_SECRET_ACCESS_KEY']
$r2End    = $local['R2_ENDPOINT']
$r2Public = $local['R2_PUBLIC_URL']
$r2Ready  = -not [string]::IsNullOrWhiteSpace($r2Bucket) -and
            -not [string]::IsNullOrWhiteSpace($r2Id) -and
            -not [string]::IsNullOrWhiteSpace($r2Secret)

if (-not $r2Ready) {
    Write-Host ''
    Write-Warning 'R2 is not configured in backend/.env. Uploaded news images will be lost on every redeploy.'
    $add = Read-Host 'Add R2 values now? (y/N)'
    if ($add -match '^y') {
        $r2Bucket = Read-Secret 'R2_BUCKET'
        $r2Id     = Read-Secret 'R2_ACCESS_KEY_ID'
        $r2Secret = Read-Secret 'R2_SECRET_ACCESS_KEY'
        $r2End    = Read-Secret 'R2_ENDPOINT (https://<accountid>.r2.cloudflarestorage.com)'
        $r2Public = Read-Secret 'R2_PUBLIC_URL (https://pub-....r2.dev)'
        $r2Ready  = $true
    }
}

$allowedOrigins = $local['ALLOWED_ORIGINS']
if ([string]::IsNullOrWhiteSpace($allowedOrigins)) {
    $allowedOrigins = 'https://www.1717sportsarena.com,https://1717sportsarena.com'
}

# --- Authenticate ---

$apiKey = Read-Secret 'Render API key (rnd_...)'

$headers = @{
    'Authorization' = "Bearer $apiKey"
    'Content-Type'  = 'application/json'
    'Accept'        = 'application/json'
}

Write-Host ''
Write-Host "Looking up Render service '$ServiceName'..." -ForegroundColor Yellow

$services = Invoke-RestMethod -Uri 'https://api.render.com/v1/services?limit=100' -Headers $headers -Method Get
$service = $services | Where-Object { $_.service.name -eq $ServiceName } | Select-Object -First 1

if (-not $service) {
    Write-Host "Service '$ServiceName' not found. Services in your account:" -ForegroundColor Red
    $services | ForEach-Object { Write-Host "  - $($_.service.name)" -ForegroundColor Yellow }
    Write-Error 'Re-run with -ServiceName "<name>" using one of the names above.'
}

$serviceId = $service.service.id
Write-Host "Found service: $($service.service.name) ($serviceId)" -ForegroundColor Green

# --- Send ---

$toSend = [ordered]@{
    'DATABASE_URL'         = $dbUrl
    'NODE_ENV'             = 'production'
    'JWT_SECRET'           = $jwtSecret
    'ADMIN_USERNAME'       = $adminUser
    'ADMIN_PASSWORD'       = $adminPass
    'ALLOWED_ORIGINS'      = $allowedOrigins
}

if (-not [string]::IsNullOrWhiteSpace($rzpId))     { $toSend['RAZORPAY_KEY_ID'] = $rzpId }
if (-not [string]::IsNullOrWhiteSpace($rzpSecret)) { $toSend['RAZORPAY_KEY_SECRET'] = $rzpSecret }

if ($r2Ready) {
    $toSend['R2_BUCKET']            = $r2Bucket
    $toSend['R2_ACCESS_KEY_ID']     = $r2Id
    $toSend['R2_SECRET_ACCESS_KEY'] = $r2Secret
    $toSend['R2_ENDPOINT']          = $r2End
    $toSend['R2_PUBLIC_URL']        = $r2Public
}

Write-Host ''
Write-Host "Sending $($toSend.Count) environment variables..." -ForegroundColor Yellow

foreach ($key in $toSend.Keys) {
    Write-Host "  PUT $key" -ForegroundColor Gray
    Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/env-vars/$key" `
        -Headers $headers -Method Put `
        -Body (@{ value = $toSend[$key] } | ConvertTo-Json) | Out-Null
}

Write-Host 'Triggering redeploy ...' -ForegroundColor Yellow
Invoke-RestMethod -Uri "https://api.render.com/v1/services/$serviceId/deploys" -Headers $headers -Method Post -Body '{}' | Out-Null

Write-Host ''
Write-Host 'DONE. Secrets are set and a deploy has started.' -ForegroundColor Green
Write-Host ''
Write-Host 'In the Render logs you should see:' -ForegroundColor Gray
Write-Host '    Razorpay is LIVE - real payments are enabled.' -ForegroundColor Gray
if ($r2Ready) {
    Write-Host '    Object storage enabled (uploads go to bucket <your-bucket>).' -ForegroundColor Gray
} else {
    Write-Host '    R2_BUCKET not set - uploads will be lost on redeploy.' -ForegroundColor Yellow
}
Write-Host 'No more warnings should appear for JWT_SECRET or Razorpay.' -ForegroundColor Gray
Write-Host ''
Write-Host 'Note: ADMIN_PASSWORD was sent but not saved locally. Copy the value you' -ForegroundColor Yellow
Write-Host 'typed into backend/.env so future runs stay in sync.' -ForegroundColor Yellow