 param(
    [Parameter(Mandatory=$false)]
    [string[]]$Files,

    [Parameter(Mandatory=$false)]
    [string[]]$Urls,

    [Parameter(Mandatory=$false)]
    [string]$Title = "",

    [Parameter(Mandatory=$false)]
    [string]$Description = "",

    [Parameter(Mandatory=$false)]
    [ValidateSet('catbox','sxcu','imgchest')]
    [string]$Provider = 'catbox',

    [Parameter(Mandatory=$false)]
    [switch]$CreateCollection,

    [Parameter(Mandatory=$false)]
    [switch]$VerboseOutput,

    [Parameter(Mandatory=$false)]
    [switch]$Anonymous
)

function Upload-FileToCatbox {
    param(
        [Parameter(Mandatory=$true)] [string]$Path
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "File not found: $Path"
    }
    Write-Verbose "Uploading file: $Path"
    try {
        $resp = & curl.exe -s --fail-with-body -F reqtype=fileupload -F "fileToUpload=@`"$Path`"" https://catbox.moe/user/api.php
        if ($LASTEXITCODE -ne 0) {
            throw "curl failed: $resp"
        }
        $url = $resp.Trim()
        return $url
    } catch {
        throw "Upload failed for $Path : $_"
    }
}

function Upload-UrlToCatbox {
    param(
        [Parameter(Mandatory=$true)] [string]$Url
    )
    Write-Verbose "Requesting URL upload: $Url"
    try {
        $resp = & curl.exe -s --fail-with-body -F reqtype=urlupload -F url=$Url https://catbox.moe/user/api.php
        if ($LASTEXITCODE -ne 0) {
            throw "curl failed: $resp"
        }
        $url = $resp.Trim()
        return $url
    } catch {
        throw "URL upload failed for $Url : $_"
    }
}

function Create-AnonymousAlbum {
    param(
        [Parameter(Mandatory=$true)] [string[]]$FileNames,
        [Parameter(Mandatory=$false)] [string]$Title = "",
        [Parameter(Mandatory=$false)] [string]$Desc = ""
    )
    if ($FileNames.Count -eq 0) {
        throw "No files provided to create album."
    }
    $filesArg = ($FileNames -join ' ')
    Write-Verbose "Creating album with files: $filesArg"
    try {
        $resp = & curl.exe -s --fail-with-body -F reqtype=createalbum -F title="$Title" -F desc="$Desc" -F files="$filesArg" https://catbox.moe/user/api.php
        if ($LASTEXITCODE -ne 0) {
            throw "curl failed: $resp"
        }
        return $resp.Trim()
    } catch {
        throw "Create album failed: $_"
    }
}

function Get-SxcuRateLimitFromFile {
    param()
    $rateLimitFile = Join-Path $env:TEMP "catbox_sxcu_rate_limit.json"
    $retryCount = 0
    $maxRetries = 3
    
    while ($retryCount -lt $maxRetries) {
        try {
            if (Test-Path $rateLimitFile) {
                # Use atomic read operation with locking
                $lockFile = $rateLimitFile + ".lock"
                $lockAcquired = $false
                try {
                    while ($lockAcquired -eq $false) {
                        if (-not (Test-Path $lockFile)) {
                            New-Item -ItemType File -Path $lockFile -Force | Out-Null
                            $lockAcquired = $true
                        } else {
                            Start-Sleep -Milliseconds 100
                        }
                    }
                    
                    $content = Get-Content $rateLimitFile -Raw
                    $data = $content | ConvertFrom-Json
                    return $data
                } finally {
                    if ($lockAcquired -and (Test-Path $lockFile)) {
                        Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
                    }
                }
            }
            break
        } catch {
            Write-Verbose "Failed to read rate limit file (attempt $($retryCount + 1)): $_"
            $retryCount++
            if ($retryCount -lt $maxRetries) {
                Start-Sleep -Milliseconds 200
            }
        }
    }
    return $null
}

function Set-SxcuRateLimitToFile {
    param(
        [int]$Remaining,
        [int]$Reset
    )
    $rateLimitFile = Join-Path $env:TEMP "catbox_sxcu_rate_limit.json"
    $retryCount = 0
    $maxRetries = 3
    
    while ($retryCount -lt $maxRetries) {
        try {
            # Use atomic write operation with locking
            $lockFile = $rateLimitFile + ".lock"
            $lockAcquired = $false
            try {
                while ($lockAcquired -eq $false) {
                    if (-not (Test-Path $lockFile)) {
                        New-Item -ItemType File -Path $lockFile -Force | Out-Null
                        $lockAcquired = $true
                    } else {
                        Start-Sleep -Milliseconds 100
                    }
                }
                
                $data = @{
                    'remaining' = $Remaining
                    'reset' = $Reset
                    'updated' = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                } | ConvertTo-Json
                Set-Content -Path $rateLimitFile -Value $data -Force
                break
            } finally {
                if ($lockAcquired -and (Test-Path $lockFile)) {
                    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
                }
            }
        } catch {
            Write-Verbose "Failed to write rate limit file (attempt $($retryCount + 1)): $_"
            $retryCount++
            if ($retryCount -lt $maxRetries) {
                Start-Sleep -Milliseconds 200
            }
            }
        }
    }

    if ($Provider -eq 'imgchest') {
        if ($Urls) {
            Write-Host "Error: imgchest provider does not support URL uploads."
            $output += "Error: imgchest provider does not support URL uploads."
            return $output
        }
        
        try {
            Write-Host "Waiting for imgchest upload slot..."
            $mutex = New-Object System.Threading.Mutex($false, "Global\CatboxImgchestUploadMutex")
            $hasHandle = $mutex.WaitOne()
            if (-not $hasHandle) {
                throw "Could not acquire imgchest upload lock."
            }
            Write-Host "Acquired imgchest upload slot."
        } catch {
            Write-Host "Error: $($_.Exception.Message)"
            $output += "Error: $($_.Exception.Message)"
            if ($mutex) { $mutex.Close(); $mutex = $null }
            return $output
        }
    }


function Test-SxcuAllowedFileType {
    param(
        [Parameter(Mandatory=$true)] [string]$Path
    )
    $allowedExtensions = @('.png', '.gif', '.jpeg', '.jpg', '.ico', '.bmp', '.tiff', '.tif', '.webm', '.webp')
    $extension = [System.IO.Path]::GetExtension($Path).ToLower()
    
    if (-not $allowedExtensions.Contains($extension)) {
        throw "File type '$extension' is not allowed. Allowed types: $($allowedExtensions -join ', ')"
    }
}

function Upload-FileToSxcu {
    param(
        [Parameter(Mandatory=$true)] [string]$Path,
        [Parameter(Mandatory=$false)] [string]$CollectionId = "",
        [int]$MaxRetries = 3
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "File not found: $Path"
    }
    
    Test-SxcuAllowedFileType -Path $Path
    
    Write-Verbose "Uploading file to sxcu: $Path"
    
    $retryCount = 0
    $baseDelay = 2
    
    while ($retryCount -le $MaxRetries) {
        try {
            $headersFile = [System.IO.Path]::GetTempFileName()
            if ($CollectionId) {
                $resp = & curl.exe -s --fail-with-body -D $headersFile -H "User-Agent: sxcuUploader/1.0 (+https://github.com)" -F "file=@`"$Path`"" -F "noembed=" -F "collection=$CollectionId" https://sxcu.net/api/files/create
            } else {
                $resp = & curl.exe -s --fail-with-body -D $headersFile -H "User-Agent: sxcuUploader/1.0 (+https://github.com)" -F "file=@`"$Path`"" -F "noembed=" https://sxcu.net/api/files/create
            }

            # Parse response headers
            $headers = @{}
            if (Test-Path $headersFile) {
                Get-Content $headersFile | ForEach-Object {
                    if ($_ -match ':\s*') {
                        $key, $value = $_ -split ':\s*', 2
                        $headers[$key.Trim().ToLower()] = $value.Trim()
                    }
                }
                Remove-Item $headersFile -ErrorAction SilentlyContinue
            }

            if ($LASTEXITCODE -ne 0) {
                throw "curl failed: $resp"
            }

            $json = $resp | ConvertFrom-Json
            if ($json.error) {
                # Handle rate limit errors with retry
                if ($json.code -eq 815 -and $retryCount -lt $MaxRetries) {
                    $retryCount++
                    $delay = $baseDelay * [Math]::Pow(2, $retryCount - 1)
                    Write-Host "Rate limit hit. Retrying in ${delay}s (attempt $($retryCount + 1) of $($MaxRetries + 1))..."
                    Start-Sleep -Seconds $delay
                    continue
                }
                throw "API error: $($json.error) (code: $($json.code))"
            }

            # Track rate limit info globally and persist to file
            if ($headers['x-ratelimit-remaining'] -ne $null -and $headers['x-ratelimit-reset'] -ne $null) {
                $script:sxcuRateLimit = @{
                    'remaining' = [int]$headers['x-ratelimit-remaining']
                    'reset' = [int]$headers['x-ratelimit-reset']
                    'checked' = $true
                }
                # Persist to shared file for other instances
                Set-SxcuRateLimitToFile -Remaining ([int]$headers['x-ratelimit-remaining']) -Reset ([int]$headers['x-ratelimit-reset'])
            }

            return $json
        } catch {
            # Check if this is a rate limit error that we should retry
            if ($_.Exception.Message -match "Rate limit exceeded" -and $retryCount -lt $MaxRetries) {
                $retryCount++
                $delay = $baseDelay * [Math]::Pow(2, $retryCount - 1)
                Write-Host "Rate limit error. Retrying in ${delay}s (attempt $($retryCount + 1) of $($MaxRetries + 1))..."
                Start-Sleep -Seconds $delay
                continue
            }
            throw "Upload failed for $Path : $_"
        }
    }
    
    throw "Upload failed for $Path : Max retries exceeded"
}

function Create-SxcuCollection {
    param(
        [Parameter(Mandatory=$false)] [string]$Title = "Untitled",
        [Parameter(Mandatory=$false)] [string]$Desc = ""
    )
    Write-Verbose "Creating sxcu collection"
    try {
        $resp = & curl.exe -s --fail-with-body -H "User-Agent: sxcuUploader/1.0 (+https://github.com)" -F title="$Title" -F desc="$Desc" -F private=false -F unlisted=false https://sxcu.net/api/collections/create
        if ($LASTEXITCODE -ne 0) {
            throw "curl failed: $resp"
        }
        $json = $resp | ConvertFrom-Json
        if ($json.error) {
            throw "API error: $($json.error) (code: $($json.code))"
        }
        return $json
    } catch {
        throw "Create collection failed: $_"
    }
}

function Clear-SxcuRateLimitFile {
    $rateLimitFile = Join-Path $env:TEMP "catbox_sxcu_rate_limit.json"
    $lockFile = $rateLimitFile + ".lock"
    $lockAcquired = $false
    
    try {
        # Wait for any ongoing file operations to complete
        while ($lockAcquired -eq $false) {
            if (-not (Test-Path $lockFile)) {
                New-Item -ItemType File -Path $lockFile -Force | Out-Null
                $lockAcquired = $true
            } else {
                Start-Sleep -Milliseconds 100
            }
        }
        
        if (Test-Path $rateLimitFile) {
            Remove-Item $rateLimitFile -Force
        }
        if (Test-Path $lockFile) {
            Remove-Item $lockFile -Force
        }
    } catch {
        Write-Verbose "Failed to clear rate limit file: $_"
        if (Test-Path $lockFile) {
            Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-ImgchestToken {
    $token = $env:IMGCHEST_API_TOKEN
    if (-not $token) {
        $configFile = Join-Path $env:APPDATA "catbox_imgchest_token.txt"
        if (Test-Path $configFile) {
            $token = Get-Content $configFile -Raw | ForEach-Object { $_.Trim() }
        }
    }
    if (-not $token) {
        throw "Imgchest API token not found. Set IMGCHEST_API_TOKEN environment variable or create $configFile with your token."
    }
    return $token
}

function Get-ImgchestRateLimitFromFile {
    param()
    $rateLimitFile = Join-Path $env:TEMP "catbox_imgchest_rate_limit.json"
    $retryCount = 0
    $maxRetries = 3
    
    while ($retryCount -lt $maxRetries) {
        try {
            if (Test-Path $rateLimitFile) {
                $lockFile = $rateLimitFile + ".lock"
                $lockAcquired = $false
                try {
                    while ($lockAcquired -eq $false) {
                        if (-not (Test-Path $lockFile)) {
                            New-Item -ItemType File -Path $lockFile -Force | Out-Null
                            $lockAcquired = $true
                        } else {
                            Start-Sleep -Milliseconds 100
                        }
                    }
                    
                    $content = Get-Content $rateLimitFile -Raw
                    $data = $content | ConvertFrom-Json
                    return $data
                } finally {
                    if ($lockAcquired -and (Test-Path $lockFile)) {
                        Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
                    }
                }
            }
            break
        } catch {
            Write-Verbose "Failed to read rate limit file (attempt $($retryCount + 1)): $_"
            $retryCount++
            if ($retryCount -lt $maxRetries) {
                Start-Sleep -Milliseconds 200
            }
        }
    }
    return $null
}

function Set-ImgchestRateLimitToFile {
    param(
        [int]$Remaining,
        [int]$Reset
    )
    $rateLimitFile = Join-Path $env:TEMP "catbox_imgchest_rate_limit.json"
    $retryCount = 0
    $maxRetries = 3
    
    while ($retryCount -lt $maxRetries) {
        try {
            $lockFile = $rateLimitFile + ".lock"
            $lockAcquired = $false
            try {
                while ($lockAcquired -eq $false) {
                    if (-not (Test-Path $lockFile)) {
                        New-Item -ItemType File -Path $lockFile -Force | Out-Null
                        $lockAcquired = $true
                    } else {
                        Start-Sleep -Milliseconds 100
                    }
                }
                
                $data = @{
                    'remaining' = $Remaining
                    'reset' = $Reset
                    'updated' = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                } | ConvertTo-Json
                Set-Content -Path $rateLimitFile -Value $data -Force
                break
            } finally {
                if ($lockAcquired -and (Test-Path $lockFile)) {
                    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
                }
            }
        } catch {
            Write-Verbose "Failed to write rate limit file (attempt $($retryCount + 1)): $_"
            $retryCount++
            if ($retryCount -lt $maxRetries) {
                Start-Sleep -Milliseconds 200
            }
        }
    }
}

function Clear-ImgchestRateLimitFile {
    $rateLimitFile = Join-Path $env:TEMP "catbox_imgchest_rate_limit.json"
    $lockFile = $rateLimitFile + ".lock"
    $lockAcquired = $false
    
    try {
        while ($lockAcquired -eq $false) {
            if (-not (Test-Path $lockFile)) {
                New-Item -ItemType File -Path $lockFile -Force | Out-Null
                $lockAcquired = $true
            } else {
                Start-Sleep -Milliseconds 100
            }
        }
        
        if (Test-Path $rateLimitFile) {
            Remove-Item $rateLimitFile -Force
        }
        if (Test-Path $lockFile) {
            Remove-Item $lockFile -Force
        }
    } catch {
        Write-Verbose "Failed to clear rate limit file: $_"
        if (Test-Path $lockFile) {
            Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
        }
    }
}

function Create-ImgchestPost {
    param(
        [Parameter(Mandatory=$true)] [string[]]$FilePaths,
        [Parameter(Mandatory=$false)] [string]$Title = "",
        [Parameter(Mandatory=$false)] [bool]$Anonymous = $false,
        [Parameter(Mandatory=$false)] [string]$Privacy = "hidden",
        [Parameter(Mandatory=$false)] [bool]$Nsfw = $true,
        [int]$MaxRetries = 3
    )
    
    if ($FilePaths.Count -eq 0) {
        throw "No files provided to create post."
    }
    
    if ($FilePaths.Count -gt 20) {
        throw "Maximum 20 images allowed per post."
    }
    
    foreach ($path in $FilePaths) {
        if (-not (Test-Path -LiteralPath $path)) {
            throw "File not found: $path"
        }
    }
    
    $token = Get-ImgchestToken
    Write-Verbose "Creating imgchest post with $($FilePaths.Count) images"
    
    $retryCount = 0
    $baseDelay = 2
    
    while ($retryCount -le $MaxRetries) {
        try {
            $headersFile = [System.IO.Path]::GetTempFileName()
            
            $curlArgs = @(
                '-s',
                '--fail-with-body',
                '-D', $headersFile,
                '-H', "Authorization: Bearer $token"
            )
            
            if ($Title) {
                $curlArgs += '-F', "title=$Title"
            }
            
            $curlArgs += '-F', "privacy=$Privacy"
            $curlArgs += '-F', "nsfw=$(if ($Nsfw) { 'true' } else { 'false' })"
            $curlArgs += '-F', "anonymous=$(if ($Anonymous) { 'true' } else { 'false' })"
            
            foreach ($path in $FilePaths) {
                $curlArgs += '-F', "images[]=@`"$path`""
            }
            
            $curlArgs += 'https://api.imgchest.com/v1/post'
            
            $resp = & curl.exe @curlArgs
            
            $headers = @{}
            if (Test-Path $headersFile) {
                Get-Content $headersFile | ForEach-Object {
                    if ($_ -match ':\s*') {
                        $key, $value = $_ -split ':\s*', 2
                        $headers[$key.Trim().ToLower()] = $value.Trim()
                    }
                }
                Remove-Item $headersFile -ErrorAction SilentlyContinue
            }
            
            if ($LASTEXITCODE -ne 0) {
                throw "curl failed: $resp"
            }
            
            $json = $resp | ConvertFrom-Json
            
            if ($json.error -or $json.errors) {
                throw "API error: $($json.error -or $json.errors -join ', ')"
            }
            
            # Track rate limit info globally and persist to file
            if ($headers['x-ratelimit-remaining'] -ne $null -and $headers['x-ratelimit-reset'] -ne $null) {
                $script:imgchestRateLimit = @{
                    'remaining' = [int]$headers['x-ratelimit-remaining']
                    'reset' = [int]$headers['x-ratelimit-reset']
                    'checked' = $true
                }
                Set-ImgchestRateLimitToFile -Remaining ([int]$headers['x-ratelimit-remaining']) -Reset ([int]$headers['x-ratelimit-reset'])
            }
            
            return $json
        } catch {
            if ($_.Exception.Message -match "Rate limit" -and $retryCount -lt $MaxRetries) {
                $retryCount++
                $delay = $baseDelay * [Math]::Pow(2, $retryCount - 1)
                Write-Host "Rate limit error. Retrying in ${delay}s (attempt $($retryCount + 1) of $($MaxRetries + 1))..."
                Start-Sleep -Seconds $delay
                continue
            }
            throw "Create post failed: $_"
        }
    }
    
    throw "Create post failed: Max retries exceeded"
}


function Invoke-CatboxUpload {
    param(
        [string[]]$Files,
        [string[]]$Urls,
        [string]$Title,
        [string]$Description,
        [string]$Provider,
        [switch]$CreateCollection,
        [switch]$VerboseOutput,
        [switch]$GuiMode,
        [switch]$Anonymous
    )
    $output = @()
    $uploadedUrls = @()
    $collectionId = ""
    $mutex = $null

    # Initialize rate limit tracker
    $script:sxcuRateLimit = @{
        'remaining' = $null
        'reset' = $null
        'checked' = $false
    }
    
    $script:imgchestRateLimit = @{
        'remaining' = $null
        'reset' = $null
        'checked' = $false
    }


    if ($Provider -eq 'sxcu') {
        if ($Urls) {
            Write-Host "Error: sxcu provider does not support URL uploads."
            $output += "Error: sxcu provider does not support URL uploads."
            return $output
        }

        # Only create collection if requested
        if ($CreateCollection) {
            # Acquire cross-process mutex for sxcu - extended scope for entire upload process
            try {
                Write-Host "Waiting for sxcu upload slot..."
                $mutex = New-Object System.Threading.Mutex($false, "Global\CatboxSxcuUploadMutex")
                $hasHandle = $mutex.WaitOne()
                if (-not $hasHandle) {
                    throw "Could not acquire sxcu upload lock."
                }
                Write-Host "Acquired sxcu upload slot."
            } catch {
                Write-Host "Error: $($_.Exception.Message)"
                $output += "Error: $($_.Exception.Message)"
                if ($mutex) { $mutex.Close(); $mutex = $null }
                return $output
            }

            try {
                $coll = Create-SxcuCollection -Title $Title -Desc $Description
                $collectionId = $coll.collection_id
                Write-Host "Created collection: https://sxcu.net/c/$collectionId"
                $output += "Created collection: https://sxcu.net/c/$collectionId"
            } catch {
                Write-Host "Error: $($_.Exception.Message)"
                $output += "Error: $($_.Exception.Message)"
                if ($mutex) { $mutex.ReleaseMutex(); $mutex.Close(); $mutex = $null }
                return $output
            }
        } else {
            # Still need mutex for individual uploads
            try {
                Write-Host "Waiting for sxcu upload slot..."
                $mutex = New-Object System.Threading.Mutex($false, "Global\CatboxSxcuUploadMutex")
                $hasHandle = $mutex.WaitOne()
                if (-not $hasHandle) {
                    throw "Could not acquire sxcu upload lock."
                }
                Write-Host "Acquired sxcu upload slot."
            } catch {
                Write-Host "Error: $($_.Exception.Message)"
                $output += "Error: $($_.Exception.Message)"
                if ($mutex) { $mutex.Close(); $mutex = $null }
                return $output
            }
        }
    }

    try {
        if ($Files) {
            foreach ($filePath in $Files) {
                try {
                    if ($Provider -eq 'sxcu') {
                        # Enhanced rate limit coordination with better timing
                        $rateLimitChecked = $false
                        $maxRateLimitChecks = 5
                        $checkCount = 0
                        
                        while (-not $rateLimitChecked -and $checkCount -lt $maxRateLimitChecks) {
                            # Check rate limit before upload - read from shared file with retry
                            $sharedRateLimit = Get-SxcuRateLimitFromFile
                            if ($sharedRateLimit -ne $null) {
                                $remaining = $sharedRateLimit.remaining
                                $resetTime = $sharedRateLimit.reset
                                $lastUpdated = $sharedRateLimit.updated
                                $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                                
                                if ($resetTime -le $now) {
                                    # Rate limit has expired, clear the file and start fresh
                                    Clear-SxcuRateLimitFile
                                    $rateLimitChecked = $true
                                } elseif ($remaining -le 0) {
                                    $waitSeconds = $resetTime - $now + 1  # Add 1 second buffer
                                    Write-Host "Rate limit exhausted. Waiting ${waitSeconds}s until reset..."
                                    Start-Sleep -Seconds $waitSeconds
                                    $checkCount++
                                    continue  # Re-check rate limit after waiting
                                } else {
                                    # We have remaining quota, proceed with upload
                                    $rateLimitChecked = $true
                                }
                            } elseif ($null -ne $script:sxcuRateLimit -and $script:sxcuRateLimit['checked']) {
                                # Fallback to in-memory rate limit if shared file not available
                                $remaining = $script:sxcuRateLimit['remaining']
                                $resetTime = $script:sxcuRateLimit['reset']
                                $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

                                if ($resetTime -le $now) {
                                    # Rate limit has expired, start fresh
                                    $rateLimitChecked = $true
                                } elseif ($remaining -le 0) {
                                    $waitSeconds = $resetTime - $now + 1  # Add 1 second buffer
                                    Write-Host "Rate limit exhausted (memory). Waiting ${waitSeconds}s until reset..."
                                    Start-Sleep -Seconds $waitSeconds
                                    $checkCount++
                                    continue  # Re-check rate limit after waiting
                                } else {
                                    # We have remaining quota, proceed with upload
                                    $rateLimitChecked = $true
                                }
                            } else {
                                # No rate limit information available, proceed with upload
                                $rateLimitChecked = $true
                            }
                        }
                        
                        # If we couldn't check rate limit after max attempts, still try to upload
                        if (-not $rateLimitChecked) {
                            Write-Host "Warning: Could not verify rate limit status, proceeding with upload..."
                        }

                        # Upload with built-in retry logic
                        $resp = Upload-FileToSxcu -Path $filePath -CollectionId $collectionId
                        $fileUrl = $resp.url
                        $output += "$fileUrl"
                        Write-Host "$fileUrl"
                    } elseif ($Provider -eq 'imgchest') {
                        # imgchest doesn't support individual file uploads, all files go in one post
                        # So we'll collect all files and create one post at the end
                    } else {

                        $fileUrl = Upload-FileToCatbox -Path $filePath
                        $uploadedUrls += $fileUrl
                        $output += "$fileUrl"
                        Write-Host "$fileUrl"
                    }
                } catch {
                    Write-Host "Error: $($_.Exception.Message)"
                    $output += "Error: $($_.Exception.Message)"
                }
            }
        }

        if ($Provider -eq 'imgchest') {
            if ($Files.Count -eq 0) {
                Write-Host "No uploads completed. Exiting."
                $output += "No uploads completed. Exiting."
                return $output
            }
            
            $allFiles = $Files
            $anonymous = if ($GuiMode) { $script:imgchestAnonymous } else { $Anonymous.ToBool() }
            
            try {
                Write-Host "Creating imgchest post with $($allFiles.Count) images..."
                $postResp = Create-ImgchestPost -FilePaths $allFiles -Title $Title -Anonymous $anonymous -Privacy "hidden" -Nsfw $true
                
                Write-Host "Post URL: https://imgchest.com/p/$($postResp.data.id)"
                $output += "Post URL: https://imgchest.com/p/$($postResp.data.id)"
                
                foreach ($img in $postResp.data.images) {
                    $output += $img.link
                    Write-Host $img.link
                }
            } catch {
                Write-Host "Error: $($_.Exception.Message)"
                $output += "Error: $($_.Exception.Message)"
            }
        }

        if ($Provider -eq 'catbox') {
            if ($Urls) {

                foreach ($inputUrl in $Urls) {
                    try {
                        $uploadUrl = Upload-UrlToCatbox -Url $inputUrl
                        $uploadedUrls += $uploadUrl
                        $output += "$uploadUrl"
                        Write-Host "$uploadUrl"
                    } catch {
                        Write-Host "Error: $($_.Exception.Message)"
                        $output += "Error: $($_.Exception.Message)"
                    }
                }
            }

            if ($uploadedUrls.Count -eq 0) {
                Write-Host "No uploads completed. Exiting."
                $output += "No uploads completed. Exiting."
                return $output
            }

            $fileNames = @()
            foreach ($uploadUrl in $uploadedUrls) {
                try {
                    $uri = [System.Uri]$uploadUrl
                    $basename = [System.IO.Path]::GetFileName($uri.LocalPath)
                    if ($basename -and -not ($fileNames -contains $basename)) { $fileNames += $basename }
                } catch {
                    Write-Host "Warning: Could not parse returned URL: $uploadUrl"
                    $output += "Warning: Could not parse returned URL: $uploadUrl"
                }
            }

            try {
                $albumResp = Create-AnonymousAlbum -FileNames $fileNames -Title $Title -Desc $Description
                if ($albumResp -match '^https?://') {
                    Write-Host "Album URL: $albumResp"
                    $output += "Album URL: $albumResp"
                } else {
                    Write-Host "Album short code: $albumResp"
                    Write-Host "Album URL: https://catbox.moe/album/$albumResp"
                    $output += "Album short code: $albumResp"
                    $output += "Album URL: https://catbox.moe/album/$albumResp"
                }
            } catch {
                Write-Host "Error: $($_.Exception.Message)"
                $output += "Error: $($_.Exception.Message)"
            }
        }
    } finally {
        if ($mutex) {
            Write-Host "Releasing sxcu upload slot."
            $mutex.ReleaseMutex()
            $mutex.Close()
            $mutex = $null
        }
    }

    return $output
}

# Main
if (-not $Files -and -not $Urls) {
    # Show GUI
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $selectedFiles = @()
        $script:uploadCompleted = $false
        $form = New-Object System.Windows.Forms.Form
        $form.Text = "File Uploader"
        $form.Size = New-Object System.Drawing.Size(400,630)
        $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::Sizable
        $form.MinimumSize = New-Object System.Drawing.Size(400,630)

        # Provider selection
        $providerLabel = New-Object System.Windows.Forms.Label
        $providerLabel.Text = "Provider:"
        $providerLabel.Location = New-Object System.Drawing.Point(10,10)
        $providerLabel.Size = New-Object System.Drawing.Size(80,20)
        $providerLabel.Font = New-Object System.Drawing.Font("Microsoft Sans Serif", 8.25)
        $form.Controls.Add($providerLabel)

        $providerComboBox = New-Object System.Windows.Forms.ComboBox
        $providerComboBox.Items.AddRange(@("catbox", "sxcu", "imgchest"))
        $providerComboBox.SelectedIndex = 1
        $providerComboBox.Location = New-Object System.Drawing.Point(95,8)
        $providerComboBox.Size = New-Object System.Drawing.Size(275,20)

        
        # Helper to toggle URL fields based on provider
        $toggleUrlFields = {
            if ($providerComboBox.SelectedItem -eq "sxcu" -or $providerComboBox.SelectedItem -eq "imgchest") {
                $urlLabel.Enabled = $false
                $urlTextBox.Enabled = $false
                $urlTextBox.Text = ""
            } else {
                $urlLabel.Enabled = $true
                $urlTextBox.Enabled = $true
            }
        }


        $providerComboBox.Add_SelectedIndexChanged($toggleUrlFields)
        $form.Controls.Add($providerComboBox)

        # Create collection checkbox
        $createCollectionCheckbox = New-Object System.Windows.Forms.CheckBox
        $createCollectionCheckbox.Text = "Create collection"
        $createCollectionCheckbox.Location = New-Object System.Drawing.Point(10,355)
        $createCollectionCheckbox.Size = New-Object System.Drawing.Size(150,20)
        $createCollectionCheckbox.Checked = $false

        # Helper to toggle collection checkbox based on provider
        $toggleCollectionCheckbox = {
            $createCollectionCheckbox.Enabled = ($providerComboBox.SelectedItem -eq "sxcu")
        }
        $providerComboBox.Add_SelectedIndexChanged($toggleCollectionCheckbox)
        $form.Controls.Add($createCollectionCheckbox)
        
        # Anonymous checkbox for imgchest
        $anonymousCheckbox = New-Object System.Windows.Forms.CheckBox
        $anonymousCheckbox.Text = "Anonymous"
        $anonymousCheckbox.Location = New-Object System.Drawing.Point(10,380)
        $anonymousCheckbox.Size = New-Object System.Drawing.Size(150,20)
        $anonymousCheckbox.Checked = $false
        $script:imgchestAnonymous = $false
        $anonymousCheckbox.Add_CheckedChanged({
            $script:imgchestAnonymous = $anonymousCheckbox.Checked
        })
        
        # Helper to toggle anonymous checkbox based on provider
        $toggleAnonymousCheckbox = {
            $anonymousCheckbox.Enabled = ($providerComboBox.SelectedItem -eq "imgchest")
        }
        $providerComboBox.Add_SelectedIndexChanged($toggleAnonymousCheckbox)
        $form.Controls.Add($anonymousCheckbox)
 
        # File button

        $fileButton = New-Object System.Windows.Forms.Button
        $fileButton.Text = "Select Files"
        $fileButton.Location = New-Object System.Drawing.Point(10,35)
        $fileButton.Add_Click({
            if ($script:uploadCompleted) {
                $script:selectedFiles = @()
                $fileListBox.Items.Clear()
                $titleTextBox.Text = ""
                $script:uploadCompleted = $false
            }
            
            $openFileDialog = New-Object System.Windows.Forms.OpenFileDialog
            $openFileDialog.Multiselect = $true
            $openFileDialog.Filter = "Image files (*.jpg;*.jpeg;*.png;*.gif;*.bmp;*.ico;*.tif;*.tiff;*.webp)|*.jpg;*.jpeg;*.png;*.gif;*.bmp;*.ico;*.tif;*.tiff;*.webp|Video files (*.webm)|*.webm|All files (*.*)|*.*"
            if ($openFileDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                $openFileDialog.FileNames | ForEach-Object {
                    $script:selectedFiles += $_
                    $fileListBox.Items.Add($_)
                }
                if ($titleTextBox.Text -eq "") {
                    $folderPath = [System.IO.Path]::GetDirectoryName($script:selectedFiles[0])
                    $titleTextBox.Text = [System.IO.Path]::GetFileName($folderPath)
                }
            }
        })
        $form.Controls.Add($fileButton)

        # ListBox for selected files
        $fileListBox = New-Object System.Windows.Forms.ListBox
        $fileListBox.Location = New-Object System.Drawing.Point(10,65)
        $fileListBox.Size = New-Object System.Drawing.Size(360,100)
        $fileListBox.SelectionMode = [System.Windows.Forms.SelectionMode]::MultiExtended
        $fileListBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
        $form.Controls.Add($fileListBox)
        
        # Remove selected files function
        $removeSelectedFiles = {
            if ($fileListBox.SelectedIndices.Count -gt 0) {
                $filesToRemove = @($fileListBox.SelectedItems)
                foreach ($file in $filesToRemove) {
                    $script:selectedFiles = $script:selectedFiles | Where-Object { $_ -ne $file }
                }
                for ($i = $fileListBox.SelectedIndices.Count - 1; $i -ge 0; $i--) {
                    $fileListBox.Items.RemoveAt($fileListBox.SelectedIndices[$i])
                }
                
                if ($script:selectedFiles.Count -eq 0) {
                    $titleTextBox.Text = ""
                }
            }
        }
        
        # Remove selected file button
        $removeFileButton = New-Object System.Windows.Forms.Button
        $removeFileButton.Text = "Remove Selected"
        $removeFileButton.Location = New-Object System.Drawing.Point(10,170)
        $removeFileButton.Size = New-Object System.Drawing.Size(120,25)
        $removeFileButton.Add_Click($removeSelectedFiles)
        $form.Controls.Add($removeFileButton)

        # URL label and text box
        $urlLabel = New-Object System.Windows.Forms.Label
        $urlLabel.Text = "URLs (comma-separated):"
        $urlLabel.Location = New-Object System.Drawing.Point(10,205)
        $urlLabel.Size = New-Object System.Drawing.Size(360,20)
        $urlLabel.Font = New-Object System.Drawing.Font("Microsoft Sans Serif", 8.25)
        $form.Controls.Add($urlLabel)

        $urlTextBox = New-Object System.Windows.Forms.TextBox
        $urlTextBox.Location = New-Object System.Drawing.Point(10,225)
        $urlTextBox.Size = New-Object System.Drawing.Size(360,20)
        $urlTextBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
        $form.Controls.Add($urlTextBox)

        # Title
        $titleLabel = New-Object System.Windows.Forms.Label
        $titleLabel.Text = "Title:"
        $titleLabel.Location = New-Object System.Drawing.Point(10,255)
        $titleLabel.Size = New-Object System.Drawing.Size(360,20)
        $titleLabel.Font = New-Object System.Drawing.Font("Microsoft Sans Serif", 8.25)
        $form.Controls.Add($titleLabel)

        $titleTextBox = New-Object System.Windows.Forms.TextBox
        $titleTextBox.Text = ""
        $titleTextBox.Location = New-Object System.Drawing.Point(10,275)
        $titleTextBox.Size = New-Object System.Drawing.Size(360,20)
        $titleTextBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
        $form.Controls.Add($titleTextBox)

        # Description
        $descLabel = New-Object System.Windows.Forms.Label
        $descLabel.Text = "Description:"
        $descLabel.Location = New-Object System.Drawing.Point(10,305)
        $descLabel.Size = New-Object System.Drawing.Size(360,20)
        $descLabel.Font = New-Object System.Drawing.Font("Microsoft Sans Serif", 8.25)
        $form.Controls.Add($descLabel)

        $descTextBox = New-Object System.Windows.Forms.TextBox
        $descTextBox.Location = New-Object System.Drawing.Point(10,325)
        $descTextBox.Size = New-Object System.Drawing.Size(360,20)
        $descTextBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
        $form.Controls.Add($descTextBox)

        # Upload button
        $uploadButton = New-Object System.Windows.Forms.Button
        $uploadButton.Text = "Upload"
        $uploadButton.Location = New-Object System.Drawing.Point(10,410)
        $uploadButton.Add_Click({
            $uploadButton.Enabled = $false
            $uploadButton.Text = "Uploading..."
            
            try {
                $urls = if ($urlTextBox.Text) { $urlTextBox.Text -split ',' | ForEach-Object { $_.Trim() } } else { $null }
                $provider = $providerComboBox.SelectedItem
                
                if (($provider -eq 'sxcu' -or $provider -eq 'imgchest') -and $urls) {
                    $output = @("Error: $($provider) provider does not support URL uploads.")
                } else {
                    $createCollectionSwitch = if ($createCollectionCheckbox.Checked) { [switch]$true } else { [switch]$false }
                    $anonymousSwitch = if ($anonymousCheckbox.Checked) { [switch]$true } else { [switch]$false }
                    $output = Invoke-CatboxUpload -Files $script:selectedFiles -Urls $urls -Title $titleTextBox.Text -Description $descTextBox.Text -Provider $provider -CreateCollection:$createCollectionSwitch -GuiMode -Anonymous:$anonymousSwitch
                }
                
                $totalInputs = $script:selectedFiles.Count + $(if ($urls) { $urls.Count } else { 0 })
                $successfulUploads = ($output | Where-Object { $_ -match "^https?://" }).Count
                $failedUploads = $totalInputs - $successfulUploads
                
                $summary = if ($failedUploads -gt 0) {
                    "Successfully uploaded $successfulUploads out of $totalInputs inputs ($failedUploads failed)."
                } else {
                    "Successfully uploaded $successfulUploads out of $totalInputs inputs."
                }
                
                $output = @($summary) + $output
                $outputTextBox.Text = $output -join "`r`n"
                
                if ($successfulUploads -gt 0) {
                    $script:uploadCompleted = $true
                }
            } catch {
                $outputTextBox.Text = "Upload error: $_"
            } finally {
                $uploadButton.Enabled = $true
                $uploadButton.Text = "Upload"
            }
        })
        $form.Controls.Add($uploadButton)

        # Output text box
        $outputTextBox = New-Object System.Windows.Forms.TextBox
        $outputTextBox.Multiline = $true
        $outputTextBox.ScrollBars = "Vertical"
        $outputTextBox.Location = New-Object System.Drawing.Point(10,440)
        $outputTextBox.Size = New-Object System.Drawing.Size(360,100)
        $outputTextBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Bottom -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
        $form.Controls.Add($outputTextBox)

        # Initial toggle
        $form.Add_Load({
            & $toggleUrlFields
            & $toggleCollectionCheckbox
            & $toggleAnonymousCheckbox
        })
        
        # Delete key handler
        $form.Add_KeyDown({
            if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Delete -and $fileListBox.Focused) {
                & $removeSelectedFiles
                $_.SuppressKeyPress = $true
            }
        })
        
        $form.KeyPreview = $true
        $form.ShowDialog()
    } catch {
        Write-Host "GUI Error: $_"
    }
} else {
    $output = Invoke-CatboxUpload -Files $Files -Urls $Urls -Title $Title -Description $Description -Provider $Provider -CreateCollection:$CreateCollection -VerboseOutput:$VerboseOutput -Anonymous:$Anonymous
    $output | ForEach-Object { Write-Output $_ }
}
