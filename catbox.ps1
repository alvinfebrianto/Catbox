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
    [ValidateSet('catbox','sxcu')]
    [string]$Provider = 'catbox',

    [Parameter(Mandatory=$false)]
    [switch]$VerboseOutput
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
    if (Test-Path $rateLimitFile) {
        try {
            $content = Get-Content $rateLimitFile -Raw
            $data = $content | ConvertFrom-Json
            return $data
        } catch {
            Write-Verbose "Failed to read rate limit file: $_"
            return $null
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
    try {
        $data = @{
            'remaining' = $Remaining
            'reset' = $Reset
            'updated' = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        } | ConvertTo-Json
        Set-Content -Path $rateLimitFile -Value $data -Force
    } catch {
        Write-Verbose "Failed to write rate limit file: $_"
    }
}

function Upload-FileToSxcu {
    param(
        [Parameter(Mandatory=$true)] [string]$Path,
        [Parameter(Mandatory=$false)] [string]$CollectionId = ""
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "File not found: $Path"
    }
    Write-Verbose "Uploading file to sxcu: $Path"
    try {
        $headersFile = [System.IO.Path]::GetTempFileName()
        $args = @("-s", "--fail-with-body", "-D", $headersFile, "-H", "User-Agent: sxcuUploader/1.0 (+https://github.com)", "-F", "file=@`"$Path`"")
        if ($CollectionId) {
            $args += @("-F", "collection=$CollectionId")
        }
        $resp = & curl.exe $args https://sxcu.net/api/files/create

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
        throw "Upload failed for $Path : $_"
    }
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
    if (Test-Path $rateLimitFile) {
        try {
            Remove-Item $rateLimitFile -Force
        } catch {
            Write-Verbose "Failed to remove rate limit file: $_"
        }
    }
}

function Invoke-CatboxUpload {
    param(
        [string[]]$Files,
        [string[]]$Urls,
        [string]$Title,
        [string]$Description,
        [string]$Provider,
        [switch]$VerboseOutput,
        [switch]$GuiMode
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

    if ($Provider -eq 'sxcu') {
        if ($Urls) {
            Write-Host "Error: sxcu provider does not support URL uploads."
            $output += "Error: sxcu provider does not support URL uploads."
            return $output
        }

        # Acquire cross-process mutex for sxcu
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
            # Clean up rate limit file on error
            Clear-SxcuRateLimitFile
            return $output
        }
    }

    try {
        if ($Files) {
            foreach ($filePath in $Files) {
                try {
                    if ($Provider -eq 'sxcu') {
                        # Check rate limit before upload - read from shared file
                        $sharedRateLimit = Get-SxcuRateLimitFromFile
                        if ($sharedRateLimit -ne $null) {
                            $remaining = $sharedRateLimit.remaining
                            $resetTime = $sharedRateLimit.reset

                            if ($remaining -le 0) {
                                $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                                if ($resetTime -gt $now) {
                                    $waitSeconds = $resetTime - $now
                                    Write-Host "Rate limit exhausted. Waiting ${waitSeconds}s until reset..."
                                    Start-Sleep -Seconds $waitSeconds
                                }
                            }
                        } elseif ($null -ne $script:sxcuRateLimit -and $script:sxcuRateLimit['checked']) {
                            # Fallback to in-memory rate limit if shared file not available
                            $remaining = $script:sxcuRateLimit['remaining']
                            $resetTime = $script:sxcuRateLimit['reset']

                            if ($remaining -le 0) {
                                $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
                                if ($resetTime -gt $now) {
                                    $waitSeconds = $resetTime - $now
                                    Write-Host "Rate limit exhausted. Waiting ${waitSeconds}s until reset..."
                                    Start-Sleep -Seconds $waitSeconds
                                }
                            }
                        }

                        $resp = Upload-FileToSxcu -Path $filePath -CollectionId $collectionId
                        $fileUrl = $resp.url
                        $output += "$fileUrl"
                        Write-Host "$fileUrl"
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
        
        # Clear shared rate limit file when done with sxcu uploads
        if ($Provider -eq 'sxcu') {
            Clear-SxcuRateLimitFile
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
        $form = New-Object System.Windows.Forms.Form
        $form.Text = "File Uploader"
        $form.Size = New-Object System.Drawing.Size(400,540)
        $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::Sizable
        $form.MinimumSize = New-Object System.Drawing.Size(400,540)

        # Provider selection
        $providerLabel = New-Object System.Windows.Forms.Label
        $providerLabel.Text = "Provider:"
        $providerLabel.Location = New-Object System.Drawing.Point(10,10)
        $providerLabel.Size = New-Object System.Drawing.Size(80,20)
        $providerLabel.Font = New-Object System.Drawing.Font("Microsoft Sans Serif", 8.25)
        $form.Controls.Add($providerLabel)

        $providerComboBox = New-Object System.Windows.Forms.ComboBox
        $providerComboBox.Items.AddRange(@("catbox", "sxcu"))
        $providerComboBox.SelectedIndex = 1
        $providerComboBox.Location = New-Object System.Drawing.Point(95,8)
        $providerComboBox.Size = New-Object System.Drawing.Size(275,20)
        
        # Helper to toggle URL fields based on provider
        $toggleUrlFields = {
            if ($providerComboBox.SelectedItem -eq "sxcu") {
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

        # File button
        $fileButton = New-Object System.Windows.Forms.Button
        $fileButton.Text = "Select Files"
        $fileButton.Location = New-Object System.Drawing.Point(10,35)
        $fileButton.Add_Click({
            $openFileDialog = New-Object System.Windows.Forms.OpenFileDialog
            $openFileDialog.Multiselect = $true
            $openFileDialog.Filter = "Image files (*.jpg;*.jpeg;*.png;*.gif;*.bmp)|*.jpg;*.jpeg;*.png;*.gif;*.bmp|All files (*.*)|*.*"
            if ($openFileDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
                $openFileDialog.FileNames | ForEach-Object {
                    if ($_ -notin $script:selectedFiles) {
                        $script:selectedFiles += $_
                        $fileListBox.Items.Add($_)
                    }
                }
                if ($titleTextBox.Text -eq "" -and $script:selectedFiles.Count -gt 0) {
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
        $fileListBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
        $form.Controls.Add($fileListBox)

        # URL label and text box
        $urlLabel = New-Object System.Windows.Forms.Label
        $urlLabel.Text = "URLs (comma-separated):"
        $urlLabel.Location = New-Object System.Drawing.Point(10,175)
        $urlLabel.Size = New-Object System.Drawing.Size(360,20)
        $urlLabel.Font = New-Object System.Drawing.Font("Microsoft Sans Serif", 8.25)
        $form.Controls.Add($urlLabel)

        $urlTextBox = New-Object System.Windows.Forms.TextBox
        $urlTextBox.Location = New-Object System.Drawing.Point(10,195)
        $urlTextBox.Size = New-Object System.Drawing.Size(360,20)
        $urlTextBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
        $form.Controls.Add($urlTextBox)

        # Title
        $titleLabel = New-Object System.Windows.Forms.Label
        $titleLabel.Text = "Title:"
        $titleLabel.Location = New-Object System.Drawing.Point(10,225)
        $titleLabel.Size = New-Object System.Drawing.Size(360,20)
        $titleLabel.Font = New-Object System.Drawing.Font("Microsoft Sans Serif", 8.25)
        $form.Controls.Add($titleLabel)

        $titleTextBox = New-Object System.Windows.Forms.TextBox
        $titleTextBox.Text = ""
        $titleTextBox.Location = New-Object System.Drawing.Point(10,245)
        $titleTextBox.Size = New-Object System.Drawing.Size(360,20)
        $titleTextBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
        $form.Controls.Add($titleTextBox)

        # Description
        $descLabel = New-Object System.Windows.Forms.Label
        $descLabel.Text = "Description:"
        $descLabel.Location = New-Object System.Drawing.Point(10,275)
        $descLabel.Size = New-Object System.Drawing.Size(360,20)
        $descLabel.Font = New-Object System.Drawing.Font("Microsoft Sans Serif", 8.25)
        $form.Controls.Add($descLabel)

        $descTextBox = New-Object System.Windows.Forms.TextBox
        $descTextBox.Location = New-Object System.Drawing.Point(10,295)
        $descTextBox.Size = New-Object System.Drawing.Size(360,20)
        $descTextBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
        $form.Controls.Add($descTextBox)

        # Upload button
        $uploadButton = New-Object System.Windows.Forms.Button
        $uploadButton.Text = "Upload"
        $uploadButton.Location = New-Object System.Drawing.Point(10,325)
        $uploadButton.Add_Click({
            $urls = if ($urlTextBox.Text) { $urlTextBox.Text -split ',' | ForEach-Object { $_.Trim() } } else { $null }
            $output = Invoke-CatboxUpload -Files $script:selectedFiles -Urls $urls -Title $titleTextBox.Text -Description $descTextBox.Text -Provider $providerComboBox.SelectedItem -GuiMode
            $totalInputs = $script:selectedFiles.Count + $(if ($urls) { $urls.Count } else { 0 })
            $successfulUploads = ($output | Where-Object { $_ -match "^https?://" }).Count
            $output = @("Successfully uploaded $successfulUploads out of $totalInputs inputs.") + $output
            $outputTextBox.Text = $output -join "`r`n"
        })
        $form.Controls.Add($uploadButton)

        # Output text box
        $outputTextBox = New-Object System.Windows.Forms.TextBox
        $outputTextBox.Multiline = $true
        $outputTextBox.ScrollBars = "Vertical"
        $outputTextBox.Location = New-Object System.Drawing.Point(10,355)
        $outputTextBox.Size = New-Object System.Drawing.Size(360,100)
        $outputTextBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Bottom -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right
        $form.Controls.Add($outputTextBox)

        # Initial toggle
        $form.Add_Load({
            & $toggleUrlFields
        })

        $form.ShowDialog()
    } catch {
        Write-Host "GUI Error: $_"
    }
} else {
    $output = Invoke-CatboxUpload -Files $Files -Urls $Urls -Title $Title -Description $Description -Provider $Provider -VerboseOutput:$VerboseOutput
    $output | ForEach-Object { Write-Output $_ }
}
