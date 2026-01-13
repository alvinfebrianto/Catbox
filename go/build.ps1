# Build script for Catbox Uploader

Write-Host "Downloading dependencies..." -ForegroundColor Cyan
go mod tidy
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Installing rsrc tool..." -ForegroundColor Cyan
go install github.com/akavel/rsrc@latest
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Embedding manifest..." -ForegroundColor Cyan
rsrc -manifest catbox.manifest -o rsrc.syso
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Building executable..." -ForegroundColor Cyan
go build -ldflags="-H windowsgui -s -w" -o catbox.exe .
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Build complete! Output: catbox.exe" -ForegroundColor Green
