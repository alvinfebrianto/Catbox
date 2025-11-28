<#
catbox.ps1
PowerShell helper for anonymous uploads and album creation to Catbox.moe

Usage examples:
   .\catbox.ps1 -Files 'C:\path\a.png','C:\path\b.jpg' -Title 'My Album'
   .\catbox.ps1 -Urls 'https://example.com/img.png' -Title 'From URLs'
   .\catbox.ps1 -Files 'C:\a.png' -Urls 'https://example.com/img.png' -Title 'Mixed'

Notes:
- Anonymous: do NOT provide a userhash. Albums created anonymously cannot be edited or deleted.
- Script outputs uploaded file URLs and the album URL.
- Requires PowerShell 5+ (Windows 10+) and curl.exe (built-in on Windows 10 1803+).
#>

param(
    [Parameter(Mandatory=$false)]
    [string[]]$Files,

    [Parameter(Mandatory=$false)]
    [string[]]$Urls,

    [Parameter(Mandatory=$false)]
    [string]$Title = "PowerShell Album",

    [Parameter(Mandatory=$false)]
    [string]$Description = "",

    [Parameter(Mandatory=$false)]
    [switch]$VerboseOutput
)

function Upload-FileToCatbox {
    param(
        [Parameter(Mandatory=$true)] [string]$Path
    )
    if (-not (Test-Path -Path $Path)) {
        throw "File not found: $Path"
    }
    Write-Verbose "Uploading file: $Path"
    try {
        $resp = & curl.exe -s -F reqtype=fileupload -F "fileToUpload=@$Path" https://catbox.moe/user/api.php
        if ($LASTEXITCODE -ne 0) {
            throw "curl failed"
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
        $resp = & curl.exe -s -F reqtype=urlupload -F url=$Url https://catbox.moe/user/api.php
        if ($LASTEXITCODE -ne 0) {
            throw "curl failed"
        }
        $res = $resp.Trim()
        return $res
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
        $resp = & curl.exe -s -F reqtype=createalbum -F title="$Title" -F desc="$Description" -F files="$filesArg" https://catbox.moe/user/api.php
        if ($LASTEXITCODE -ne 0) {
            throw "curl failed"
        }
        return $resp.Trim()
    } catch {
        throw "Create album failed: $_"
    }
}

# Main
$uploadedUrls = @()

if ($Files) {
    foreach ($f in $Files) {
        try {
            $u = Upload-FileToCatbox -Path $f
            $uploadedUrls += $u
            if ($VerboseOutput) { Write-Output "Uploaded: $u" }
        } catch {
            Write-Error $_.Exception.Message
        }
    }
}

if ($Urls) {
    foreach ($u in $Urls) {
        try {
            $r = Upload-UrlToCatbox -Url $u
            $uploadedUrls += $r
            if ($VerboseOutput) { Write-Output "Uploaded URL: $r" }
        } catch {
            Write-Error $_.Exception.Message
        }
    }
}

if ($uploadedUrls.Count -eq 0) {
    Write-Output "No uploads completed. Exiting."
    return
}

# Extract basename filenames from returned URLs
$fileNames = @()
foreach ($u in $uploadedUrls) {
    try {
        $uri = [System.Uri]$u
        $basename = [System.IO.Path]::GetFileName($uri.LocalPath)
        if ($basename -and -not ($fileNames -contains $basename)) { $fileNames += $basename }
    } catch {
        Write-Warning "Could not parse returned URL: $u"
    }
}

try {
    $albumResp = Create-AnonymousAlbum -FileNames $fileNames -Title $Title -Desc $Description
    # If the API returns a short code or full URL, print helpful messages
    if ($albumResp -match '^https?://') {
        Write-Output "Album URL: $albumResp"
    } else {
        # assume short code
        Write-Output "Album short code: $albumResp"
        Write-Output "Album URL: https://catbox.moe/album/$albumResp"
    }
} catch {
    Write-Error $_.Exception.Message
}

# Print list of uploaded URLs
Write-Output "Uploaded files:"
$uploadedUrls | ForEach-Object { Write-Output "- $_" }

# Done
