<#
Usage examples:
   .\catbox.ps1 -Files 'C:\path\a.png','C:\path\b.jpg' -Title 'My Album'
   .\catbox.ps1 -Urls 'https://example.com/img.png' -Title 'From URLs'
   .\catbox.ps1 -Files 'C:\a.png' -Urls 'https://example.com/img.png' -Title 'Mixed'
   .\catbox.ps1  # Launches GUI

Notes:
- Anonymous: do NOT provide a userhash. Albums created anonymously cannot be edited or deleted.
- Script outputs uploaded file URLs and the album URL.
- GUI mode uses Windows Forms for file selection.
#>

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

function Invoke-CatboxUpload {
    param(
        [string[]]$Files,
        [string[]]$Urls,
        [string]$Title,
        [string]$Description,
        [switch]$VerboseOutput
    )
    $output = @()
    $uploadedUrls = @()

    if ($Files) {
        foreach ($f in $Files) {
            try {
                $u = Upload-FileToCatbox -Path $f
                $uploadedUrls += $u
                if ($VerboseOutput) { $output += "Uploaded: $u" }
            } catch {
                $output += "Error: $($_.Exception.Message)"
            }
        }
    }

    if ($Urls) {
        foreach ($u in $Urls) {
            try {
                $r = Upload-UrlToCatbox -Url $u
                $uploadedUrls += $r
                if ($VerboseOutput) { $output += "Uploaded URL: $r" }
            } catch {
                $output += "Error: $($_.Exception.Message)"
            }
        }
    }

    if ($uploadedUrls.Count -eq 0) {
        $output += "No uploads completed. Exiting."
        return $output
    }

    # Extract basename filenames from returned URLs
    $fileNames = @()
    foreach ($u in $uploadedUrls) {
        try {
            $uri = [System.Uri]$u
            $basename = [System.IO.Path]::GetFileName($uri.LocalPath)
            if ($basename -and -not ($fileNames -contains $basename)) { $fileNames += $basename }
        } catch {
            $output += "Warning: Could not parse returned URL: $u"
        }
    }

    try {
        $albumResp = Create-AnonymousAlbum -FileNames $fileNames -Title $Title -Desc $Description
        # If the API returns a short code or full URL, print helpful messages
        if ($albumResp -match '^https?://') {
            $output += "Album URL: $albumResp"
        } else {
            # assume short code
            $output += "Album short code: $albumResp"
            $output += "Album URL: https://catbox.moe/album/$albumResp"
        }
    } catch {
        $output += "Error: $($_.Exception.Message)"
    }

    # Print list of uploaded URLs
    $output += "Uploaded files:"
    $uploadedUrls | ForEach-Object { $output += "- $_" }

    return $output
}

# Main
if (-not $Files -and -not $Urls) {
    # Show GUI
    Add-Type -AssemblyName System.Windows.Forms
    $selectedFiles = @()
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "Catbox Uploader"
    $form.Size = New-Object System.Drawing.Size(400,500)

    # File button
    $fileButton = New-Object System.Windows.Forms.Button
    $fileButton.Text = "Select Files"
    $fileButton.Location = New-Object System.Drawing.Point(10,10)
    $fileButton.Add_Click({
        $openFileDialog = New-Object System.Windows.Forms.OpenFileDialog
        $openFileDialog.Multiselect = $true
        $openFileDialog.Filter = "Image files (*.jpg;*.jpeg;*.png;*.gif;*.bmp)|*.jpg;*.jpeg;*.png;*.gif;*.bmp|All files (*.*)|*.*"
        if ($openFileDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
            $script:selectedFiles = $openFileDialog.FileNames
            $fileListBox.Items.Clear()
            $openFileDialog.FileNames | ForEach-Object { $fileListBox.Items.Add($_) }
        }
    })
    $form.Controls.Add($fileButton)

    # ListBox for selected files
    $fileListBox = New-Object System.Windows.Forms.ListBox
    $fileListBox.Location = New-Object System.Drawing.Point(10,40)
    $fileListBox.Size = New-Object System.Drawing.Size(360,100)
    $form.Controls.Add($fileListBox)

    # URL label and text box
    $urlLabel = New-Object System.Windows.Forms.Label
    $urlLabel.Text = "URLs (comma-separated):"
    $urlLabel.Location = New-Object System.Drawing.Point(10,150)
    $form.Controls.Add($urlLabel)

    $urlTextBox = New-Object System.Windows.Forms.TextBox
    $urlTextBox.Location = New-Object System.Drawing.Point(10,170)
    $urlTextBox.Size = New-Object System.Drawing.Size(360,20)
    $form.Controls.Add($urlTextBox)

    # Title
    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = "Title:"
    $titleLabel.Location = New-Object System.Drawing.Point(10,200)
    $form.Controls.Add($titleLabel)

    $titleTextBox = New-Object System.Windows.Forms.TextBox
    $titleTextBox.Text = ""
    $titleTextBox.Location = New-Object System.Drawing.Point(10,220)
    $titleTextBox.Size = New-Object System.Drawing.Size(360,20)
    $form.Controls.Add($titleTextBox)

    # Description
    $descLabel = New-Object System.Windows.Forms.Label
    $descLabel.Text = "Description:"
    $descLabel.Location = New-Object System.Drawing.Point(10,250)
    $form.Controls.Add($descLabel)

    $descTextBox = New-Object System.Windows.Forms.TextBox
    $descTextBox.Location = New-Object System.Drawing.Point(10,270)
    $descTextBox.Size = New-Object System.Drawing.Size(360,20)
    $form.Controls.Add($descTextBox)

    # Upload button
    $uploadButton = New-Object System.Windows.Forms.Button
    $uploadButton.Text = "Upload"
    $uploadButton.Location = New-Object System.Drawing.Point(10,300)
    $uploadButton.Add_Click({
        $urls = if ($urlTextBox.Text) { $urlTextBox.Text -split ',' | ForEach-Object { $_.Trim() } } else { $null }
        $output = Invoke-CatboxUpload -Files $script:selectedFiles -Urls $urls -Title $titleTextBox.Text -Description $descTextBox.Text
        $outputTextBox.Text = $output -join "`r`n"
    })
    $form.Controls.Add($uploadButton)

    # Output text box
    $outputTextBox = New-Object System.Windows.Forms.TextBox
    $outputTextBox.Multiline = $true
    $outputTextBox.ScrollBars = "Vertical"
    $outputTextBox.Location = New-Object System.Drawing.Point(10,330)
    $outputTextBox.Size = New-Object System.Drawing.Size(360,100)
    $form.Controls.Add($outputTextBox)

    $form.ShowDialog()
} else {
    $output = Invoke-CatboxUpload -Files $Files -Urls $Urls -Title $Title -Description $Description -VerboseOutput:$VerboseOutput
    $output | ForEach-Object { Write-Output $_ }
}
