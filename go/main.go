package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32                         = syscall.NewLazyDLL("user32.dll")
	messageBoxW                    = user32.NewProc("MessageBoxW")
	setProcessDPIAware             = user32.NewProc("SetProcessDPIAware")
	setProcessDpiAwarenessContext  = user32.NewProc("SetProcessDpiAwarenessContext")
	comdlg32                       = syscall.NewLazyDLL("comdlg32.dll")
	getOpenFileNameW               = comdlg32.NewProc("GetOpenFileNameW")
	dwmapi                         = syscall.NewLazyDLL("dwmapi.dll")
	dwmSetWindowAttr               = dwmapi.NewProc("DwmSetWindowAttribute")
	advapi32                       = syscall.NewLazyDLL("advapi32.dll")
	regOpenKeyExW                  = advapi32.NewProc("RegOpenKeyExW")
	regQueryValueExW               = advapi32.NewProc("RegQueryValueExW")
	regCloseKey                    = advapi32.NewProc("RegCloseKey")
)

const (
	DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = ^uintptr(4) // -5
)

func init() {
	if setProcessDpiAwarenessContext.Find() == nil {
		setProcessDpiAwarenessContext.Call(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)
	} else if setProcessDPIAware.Find() == nil {
		setProcessDPIAware.Call()
	}
}

const (
	MB_OK              = 0x00000000
	MB_ICONERROR       = 0x00000010
	MB_ICONINFORMATION = 0x00000040

	DWMWA_USE_IMMERSIVE_DARK_MODE = 20

	HKEY_CURRENT_USER = 0x80000001
	KEY_READ          = 0x20019
)

var (
	titleInfo, _  = syscall.UTF16PtrFromString("Image Uploader")
	titleError, _ = syscall.UTF16PtrFromString("Image Uploader - Error")
)

func showError(message string) {
	msg, _ := syscall.UTF16PtrFromString(message)
	messageBoxW.Call(0, uintptr(unsafe.Pointer(msg)), uintptr(unsafe.Pointer(titleError)), MB_OK|MB_ICONERROR)
}

func showInfo(message string) {
	msg, _ := syscall.UTF16PtrFromString(message)
	messageBoxW.Call(0, uintptr(unsafe.Pointer(msg)), uintptr(unsafe.Pointer(titleInfo)), MB_OK|MB_ICONINFORMATION)
}

func IsSystemDarkMode() bool {
	subKey, _ := syscall.UTF16PtrFromString(`Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`)
	valueName, _ := syscall.UTF16PtrFromString("AppsUseLightTheme")

	var hKey uintptr
	ret, _, _ := regOpenKeyExW.Call(HKEY_CURRENT_USER, uintptr(unsafe.Pointer(subKey)), 0, KEY_READ, uintptr(unsafe.Pointer(&hKey)))
	if ret != 0 {
		return false
	}
	defer regCloseKey.Call(hKey)

	var dataType uint32
	var data uint32
	dataSize := uint32(4)
	ret, _, _ = regQueryValueExW.Call(hKey, uintptr(unsafe.Pointer(valueName)), 0, uintptr(unsafe.Pointer(&dataType)), uintptr(unsafe.Pointer(&data)), uintptr(unsafe.Pointer(&dataSize)))
	if ret != 0 {
		return false
	}
	return data == 0
}

func SetDarkModeTitleBar(hwnd uintptr, dark bool) {
	if dwmSetWindowAttr.Find() != nil {
		return
	}
	var value int32
	if dark {
		value = 1
	}
	dwmSetWindowAttr.Call(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, uintptr(unsafe.Pointer(&value)), 4)
}

type RateLimitEntry struct {
	Limit       int   `json:"limit"`
	Remaining   int   `json:"remaining"`
	ResetAt     int64 `json:"resetAt"`
	WindowStart int64 `json:"windowStart"`
	LastUpdated int64 `json:"lastUpdated"`
}

type SxcuRateLimitState struct {
	Buckets map[string]*RateLimitEntry `json:"buckets"`
	Global  *RateLimitEntry            `json:"global"`
}

type ImgchestRateLimitState struct {
	Default *RateLimitEntry `json:"default"`
}

type AllRateLimits struct {
	Sxcu     SxcuRateLimitState     `json:"sxcu"`
	Imgchest ImgchestRateLimitState `json:"imgchest"`
}

const (
	sxcuGlobalRequestsPerMinute = 240
	sxcuGlobalWindowMs          = 60000
	imgchestRequestsPerMinute   = 60
	imgchestWindowMs            = 60000
)

const (
	sxcuFileUploadBucket   = "__sxcu_file_upload__"
	sxcuCollectionBucket   = "__sxcu_collection__"
	sxcuGlobalBucket       = "__sxcu_global__"
)

var (
	rateLimits     AllRateLimits
	rateLimitMutex sync.Mutex
)

func init() {
	rateLimits = AllRateLimits{
		Sxcu:     SxcuRateLimitState{Buckets: make(map[string]*RateLimitEntry)},
		Imgchest: ImgchestRateLimitState{},
	}
	loadRateLimitsFromFile()
}

func getRateLimitFilePath() string {
	return filepath.Join(os.TempDir(), "image_uploader_rate_limits.json")
}

func getRateLimitLockPath() string {
	return filepath.Join(os.TempDir(), "image_uploader_rate_limits.lock")
}

func getUploadLockPath() string {
	return filepath.Join(os.TempDir(), "image_uploader_upload.lock")
}

var lockFile *os.File
var uploadLockFile *os.File

func TryAcquireUploadLock() (bool, error) {
	lockPath := getUploadLockPath()
	var err error
	uploadLockFile, err = os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0666)
	if err != nil {
		return false, err
	}
	handle := windows.Handle(uploadLockFile.Fd())
	var overlapped windows.Overlapped
	err = windows.LockFileEx(handle, windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &overlapped)
	if err != nil {
		uploadLockFile.Close()
		uploadLockFile = nil
		if err == windows.ERROR_LOCK_VIOLATION {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func AcquireUploadLock() error {
	lockPath := getUploadLockPath()
	var err error
	uploadLockFile, err = os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0666)
	if err != nil {
		return err
	}
	handle := windows.Handle(uploadLockFile.Fd())
	var overlapped windows.Overlapped
	err = windows.LockFileEx(handle, windows.LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, &overlapped)
	if err != nil {
		uploadLockFile.Close()
		uploadLockFile = nil
		return err
	}
	return nil
}

func ReleaseUploadLock() {
	if uploadLockFile != nil {
		handle := windows.Handle(uploadLockFile.Fd())
		var overlapped windows.Overlapped
		windows.UnlockFileEx(handle, 0, 1, 0, &overlapped)
		uploadLockFile.Close()
		uploadLockFile = nil
	}
}

func acquireFileLock() error {
	lockPath := getRateLimitLockPath()
	var err error
	lockFile, err = os.OpenFile(lockPath, os.O_CREATE|os.O_RDWR, 0666)
	if err != nil {
		return err
	}
	handle := windows.Handle(lockFile.Fd())
	var overlapped windows.Overlapped
	err = windows.LockFileEx(handle, windows.LOCKFILE_EXCLUSIVE_LOCK, 0, 1, 0, &overlapped)
	if err != nil {
		lockFile.Close()
		lockFile = nil
		return err
	}
	return nil
}

func releaseFileLock() {
	if lockFile != nil {
		handle := windows.Handle(lockFile.Fd())
		var overlapped windows.Overlapped
		windows.UnlockFileEx(handle, 0, 1, 0, &overlapped)
		lockFile.Close()
		lockFile = nil
	}
}

func loadRateLimitsFromFile() {
	path := getRateLimitFilePath()
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var loaded AllRateLimits
	if err := json.Unmarshal(data, &loaded); err != nil {
		return
	}
	if loaded.Sxcu.Buckets == nil {
		loaded.Sxcu.Buckets = make(map[string]*RateLimitEntry)
	}
	rateLimits = loaded
	cleanupExpiredEntries()
}

func saveRateLimitsToFile() {
	path := getRateLimitFilePath()
	data, err := json.Marshal(rateLimits)
	if err != nil {
		return
	}
	os.WriteFile(path, data, 0644)
}

func withFileLock(fn func()) {
	if err := acquireFileLock(); err == nil {
		loadRateLimitsFromFile()
		fn()
		saveRateLimitsToFile()
		releaseFileLock()
	} else {
		fn()
	}
}

func isRateLimitExpired(entry *RateLimitEntry, nowMs int64) bool {
	return entry == nil || nowMs >= entry.ResetAt
}

func cleanupExpiredEntries() {
	nowMs := time.Now().UnixMilli()

	if rateLimits.Imgchest.Default != nil && isRateLimitExpired(rateLimits.Imgchest.Default, nowMs) {
		rateLimits.Imgchest.Default = nil
	}

	if rateLimits.Sxcu.Global != nil && isRateLimitExpired(rateLimits.Sxcu.Global, nowMs) {
		rateLimits.Sxcu.Global = nil
	}

	for bucket := range rateLimits.Sxcu.Buckets {
		if isRateLimitExpired(rateLimits.Sxcu.Buckets[bucket], nowMs) {
			delete(rateLimits.Sxcu.Buckets, bucket)
		}
	}
}

type RateLimitHeaders struct {
	Limit      int
	Remaining  int
	Reset      int64
	ResetAfter float64
	Bucket     string
	IsGlobal   bool
}

func parseRateLimitHeaders(resp *http.Response) RateLimitHeaders {
	headers := RateLimitHeaders{Limit: -1, Remaining: -1, Reset: 0, ResetAfter: 0}

	if limit := resp.Header.Get("X-RateLimit-Limit"); limit != "" {
		headers.Limit, _ = strconv.Atoi(limit)
	}
	if remaining := resp.Header.Get("X-RateLimit-Remaining"); remaining != "" {
		headers.Remaining, _ = strconv.Atoi(remaining)
	}
	if reset := resp.Header.Get("X-RateLimit-Reset"); reset != "" {
		headers.Reset, _ = strconv.ParseInt(reset, 10, 64)
	}
	if resetAfter := resp.Header.Get("X-RateLimit-Reset-After"); resetAfter != "" {
		headers.ResetAfter, _ = strconv.ParseFloat(resetAfter, 64)
	}
	if bucket := resp.Header.Get("X-RateLimit-Bucket"); bucket != "" {
		headers.Bucket = bucket
	}
	if resp.Header.Get("X-RateLimit-Global") != "" {
		headers.IsGlobal = true
	}

	return headers
}

func createRateLimitEntry(headers RateLimitHeaders, nowMs int64) *RateLimitEntry {
	var resetAt int64

	if headers.ResetAfter > 0 {
		resetAt = nowMs + int64(headers.ResetAfter*1000)
	} else if headers.Reset > 0 {
		resetAt = headers.Reset * 1000
	} else {
		resetAt = nowMs + 60000
	}

	limit := headers.Limit
	if limit <= 0 {
		limit = 60
	}
	remaining := headers.Remaining
	if remaining < 0 {
		remaining = limit - 1
	}

	return &RateLimitEntry{
		Limit:       limit,
		Remaining:   remaining,
		ResetAt:     resetAt,
		WindowStart: nowMs,
		LastUpdated: nowMs,
	}
}

type RateLimitCheckResult struct {
	Allowed bool
	WaitMs  int64
	Reason  string
	Bucket  string
	ResetAt int64
}

func checkSxcuRateLimitInternal(routeBucket string, nowMs int64) RateLimitCheckResult {
	cleanupExpiredEntries()

	if rateLimits.Sxcu.Global != nil && !isRateLimitExpired(rateLimits.Sxcu.Global, nowMs) {
		if rateLimits.Sxcu.Global.Remaining < 1 {
			waitMs := rateLimits.Sxcu.Global.ResetAt - nowMs + 100
			if waitMs < 100 {
				waitMs = 100
			}
			return RateLimitCheckResult{
				Allowed: false,
				WaitMs:  waitMs,
				Reason:  "global",
				Bucket:  sxcuGlobalBucket,
				ResetAt: rateLimits.Sxcu.Global.ResetAt,
			}
		}
	}

	if routeBucket != "" {
		if entry, ok := rateLimits.Sxcu.Buckets[routeBucket]; ok && !isRateLimitExpired(entry, nowMs) {
			if entry.Remaining < 1 {
				waitMs := entry.ResetAt - nowMs + 100
				if waitMs < 100 {
					waitMs = 100
				}
				return RateLimitCheckResult{
					Allowed: false,
					WaitMs:  waitMs,
					Reason:  "bucket",
					Bucket:  routeBucket,
					ResetAt: entry.ResetAt,
				}
			}
		}
	}

	return RateLimitCheckResult{Allowed: true, WaitMs: 0}
}

func checkSxcuRateLimit(routeBucket string) RateLimitCheckResult {
	rateLimitMutex.Lock()
	defer rateLimitMutex.Unlock()

	var result RateLimitCheckResult
	withFileLock(func() {
		nowMs := time.Now().UnixMilli()
		result = checkSxcuRateLimitInternal(routeBucket, nowMs)
	})
	return result
}

func updateSxcuRateLimitInternal(routeBucket string, headers RateLimitHeaders, isGlobalError bool, isRateLimitError bool, nowMs int64) {
	if isGlobalError || headers.IsGlobal {
		rateLimits.Sxcu.Global = &RateLimitEntry{
			Limit:       sxcuGlobalRequestsPerMinute,
			Remaining:   0,
			ResetAt:     createRateLimitEntry(headers, nowMs).ResetAt,
			WindowStart: nowMs,
			LastUpdated: nowMs,
		}
	} else {
		if rateLimits.Sxcu.Global != nil && !isRateLimitExpired(rateLimits.Sxcu.Global, nowMs) {
			rateLimits.Sxcu.Global.Remaining--
			if rateLimits.Sxcu.Global.Remaining < 0 {
				rateLimits.Sxcu.Global.Remaining = 0
			}
			rateLimits.Sxcu.Global.LastUpdated = nowMs
		} else {
			rateLimits.Sxcu.Global = &RateLimitEntry{
				Limit:       sxcuGlobalRequestsPerMinute,
				Remaining:   sxcuGlobalRequestsPerMinute - 1,
				ResetAt:     nowMs + sxcuGlobalWindowMs,
				WindowStart: nowMs,
				LastUpdated: nowMs,
			}
		}
	}

	if headers.Bucket != "" && headers.Limit >= 0 && headers.Remaining >= 0 {
		rateLimits.Sxcu.Buckets[headers.Bucket] = createRateLimitEntry(headers, nowMs)
	}

	if routeBucket != "" {
		entry, ok := rateLimits.Sxcu.Buckets[routeBucket]
		if !ok || isRateLimitExpired(entry, nowMs) {
			if headers.Limit > 0 && headers.Remaining >= 0 {
				rateLimits.Sxcu.Buckets[routeBucket] = createRateLimitEntry(headers, nowMs)
			}
		} else if !isRateLimitError {
			entry.Remaining--
			if entry.Remaining < 0 {
				entry.Remaining = 0
			}
			entry.LastUpdated = nowMs
		} else {
			entry.Remaining = 0
			entry.LastUpdated = nowMs
			if headers.ResetAfter > 0 {
				entry.ResetAt = nowMs + int64(headers.ResetAfter*1000)
			} else if headers.Reset > 0 {
				entry.ResetAt = headers.Reset * 1000
			}
		}
	}
}

func updateSxcuRateLimit(routeBucket string, headers RateLimitHeaders, isGlobalError bool, isRateLimitError bool) {
	rateLimitMutex.Lock()
	defer rateLimitMutex.Unlock()

	withFileLock(func() {
		nowMs := time.Now().UnixMilli()
		updateSxcuRateLimitInternal(routeBucket, headers, isGlobalError, isRateLimitError, nowMs)
	})
}

func checkImgchestRateLimitInternal(nowMs int64) RateLimitCheckResult {
	cleanupExpiredEntries()

	entry := rateLimits.Imgchest.Default
	if entry == nil || isRateLimitExpired(entry, nowMs) {
		return RateLimitCheckResult{Allowed: true, WaitMs: 0}
	}

	if entry.Remaining < 1 {
		waitMs := entry.ResetAt - nowMs + 100
		if waitMs < 100 {
			waitMs = 100
		}
		return RateLimitCheckResult{
			Allowed: false,
			WaitMs:  waitMs,
			Reason:  "bucket",
			ResetAt: entry.ResetAt,
		}
	}

	return RateLimitCheckResult{Allowed: true, WaitMs: 0}
}

func checkImgchestRateLimit() RateLimitCheckResult {
	rateLimitMutex.Lock()
	defer rateLimitMutex.Unlock()

	var result RateLimitCheckResult
	withFileLock(func() {
		nowMs := time.Now().UnixMilli()
		result = checkImgchestRateLimitInternal(nowMs)
	})
	return result
}

func updateImgchestRateLimitInternal(headers RateLimitHeaders, nowMs int64) {
	if headers.Limit >= 0 && headers.Remaining >= 0 {
		rateLimits.Imgchest.Default = &RateLimitEntry{
			Limit:       headers.Limit,
			Remaining:   headers.Remaining,
			ResetAt:     nowMs + imgchestWindowMs,
			WindowStart: nowMs,
			LastUpdated: nowMs,
		}
	} else if rateLimits.Imgchest.Default != nil {
		rateLimits.Imgchest.Default.Remaining--
		if rateLimits.Imgchest.Default.Remaining < 0 {
			rateLimits.Imgchest.Default.Remaining = 0
		}
		rateLimits.Imgchest.Default.LastUpdated = nowMs
	}
}

func updateImgchestRateLimit(headers RateLimitHeaders) {
	rateLimitMutex.Lock()
	defer rateLimitMutex.Unlock()

	withFileLock(func() {
		nowMs := time.Now().UnixMilli()
		updateImgchestRateLimitInternal(headers, nowMs)
	})
}

func calculateExponentialBackoff(attempt int, baseDelayMs, maxDelayMs int64) time.Duration {
	delay := baseDelayMs * (1 << attempt)
	if delay > maxDelayMs {
		delay = maxDelayMs
	}
	jitter := time.Duration(time.Now().UnixNano()%500) * time.Millisecond
	return time.Duration(delay)*time.Millisecond + jitter
}

var sxcuAllowedExtensions = map[string]struct{}{
	".png": {}, ".gif": {}, ".jpeg": {}, ".jpg": {},
	".ico": {}, ".bmp": {}, ".tiff": {}, ".tif": {},
	".webm": {}, ".webp": {},
}

func isSxcuAllowedFileType(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	_, ok := sxcuAllowedExtensions[ext]
	return ok
}

var copyBufPool = sync.Pool{
	New: func() any {
		b := make([]byte, 32*1024)
		return &b
	},
}

var httpTransport = &http.Transport{
	Proxy:               http.ProxyFromEnvironment,
	MaxIdleConns:        10,
	MaxIdleConnsPerHost: 10,
	IdleConnTimeout:     90 * time.Second,
	ForceAttemptHTTP2:   true,
}

var httpClient = &http.Client{
	Transport: httpTransport,
	Timeout:   5 * time.Minute,
}

func uploadFileToCatbox(filePath string) (string, error) {
	pr, pw := io.Pipe()
	writer := multipart.NewWriter(pw)
	contentType := writer.FormDataContentType()

	errCh := make(chan error, 1)
	go func() {
		defer pw.Close()
		defer writer.Close()

		if err := writer.WriteField("reqtype", "fileupload"); err != nil {
			pw.CloseWithError(err)
			errCh <- err
			return
		}

		file, err := os.Open(filePath)
		if err != nil {
			pw.CloseWithError(err)
			errCh <- err
			return
		}
		defer file.Close()

		part, err := writer.CreateFormFile("fileToUpload", filepath.Base(filePath))
		if err != nil {
			pw.CloseWithError(err)
			errCh <- err
			return
		}

		bufp := copyBufPool.Get().(*[]byte)
		_, err = io.CopyBuffer(part, file, *bufp)
		copyBufPool.Put(bufp)
		if err != nil {
			pw.CloseWithError(err)
			errCh <- err
			return
		}
		errCh <- nil
	}()

	req, err := http.NewRequest("POST", "https://catbox.moe/user/api.php", pr)
	if err != nil {
		pr.Close()
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if pipeErr := <-errCh; pipeErr != nil {
		return "", fmt.Errorf("failed to write multipart: %w", pipeErr)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	result := strings.TrimSpace(string(body))
	if !strings.HasPrefix(result, "https://") {
		return "", fmt.Errorf("upload failed: %s", result)
	}

	return result, nil
}

func uploadURLToCatbox(targetURL string) (string, error) {
	pr, pw := io.Pipe()
	writer := multipart.NewWriter(pw)
	contentType := writer.FormDataContentType()

	go func() {
		defer pw.Close()
		defer writer.Close()
		writer.WriteField("reqtype", "urlupload")
		writer.WriteField("url", targetURL)
	}()

	req, err := http.NewRequest("POST", "https://catbox.moe/user/api.php", pr)
	if err != nil {
		pr.Close()
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	result := strings.TrimSpace(string(body))
	if !strings.HasPrefix(result, "https://") {
		return "", fmt.Errorf("upload failed: %s", result)
	}

	return result, nil
}

func createCatboxAlbum(fileNames []string, title, desc string) (string, error) {
	pr, pw := io.Pipe()
	writer := multipart.NewWriter(pw)
	contentType := writer.FormDataContentType()
	filesStr := strings.Join(fileNames, " ")

	go func() {
		defer pw.Close()
		defer writer.Close()
		writer.WriteField("reqtype", "createalbum")
		writer.WriteField("title", title)
		writer.WriteField("desc", desc)
		writer.WriteField("files", filesStr)
	}()

	req, err := http.NewRequest("POST", "https://catbox.moe/user/api.php", pr)
	if err != nil {
		pr.Close()
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	result := strings.TrimSpace(string(body))
	return result, nil
}

type SxcuResponse struct {
	ID    string `json:"id"`
	URL   string `json:"url"`
	Error string `json:"error"`
	Code  int    `json:"code"`
}

type SxcuCollectionResponse struct {
	CollectionID string `json:"collection_id"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	Unlisted     bool   `json:"unlisted"`
	Private      bool   `json:"private"`
	Error        string `json:"error"`
	Code         int    `json:"code"`
}

func (r *SxcuCollectionResponse) GetURL() string {
	if r.CollectionID != "" {
		return fmt.Sprintf("https://sxcu.net/c/%s", r.CollectionID)
	}
	return ""
}

func uploadFileToSxcu(filePath, collectionID string, maxRetries int) (*SxcuResponse, error) {
	if !isSxcuAllowedFileType(filePath) {
		ext := filepath.Ext(filePath)
		return nil, fmt.Errorf("file type '%s' is not allowed for sxcu.net", ext)
	}

	var lastErr error
	fileName := filepath.Base(filePath)

	for attempt := 0; attempt <= maxRetries; attempt++ {
		check := checkSxcuRateLimit(sxcuFileUploadBucket)
		if !check.Allowed {
			if attempt >= maxRetries {
				return nil, fmt.Errorf("rate limit exceeded, retry after %dms", check.WaitMs)
			}
			time.Sleep(time.Duration(check.WaitMs) * time.Millisecond)
			continue
		}

		pr, pw := io.Pipe()
		writer := multipart.NewWriter(pw)
		contentType := writer.FormDataContentType()

		errCh := make(chan error, 1)
		go func() {
			defer pw.Close()
			defer writer.Close()

			part, err := writer.CreateFormFile("file", fileName)
			if err != nil {
				pw.CloseWithError(err)
				errCh <- err
				return
			}

			file, err := os.Open(filePath)
			if err != nil {
				pw.CloseWithError(err)
				errCh <- err
				return
			}
			defer file.Close()

			bufp := copyBufPool.Get().(*[]byte)
			_, err = io.CopyBuffer(part, file, *bufp)
			copyBufPool.Put(bufp)
			if err != nil {
				pw.CloseWithError(err)
				errCh <- err
				return
			}

			writer.WriteField("noembed", "")
			if collectionID != "" {
				writer.WriteField("collection", collectionID)
			}
			errCh <- nil
		}()

		req, err := http.NewRequest("POST", "https://sxcu.net/api/files/create", pr)
		if err != nil {
			pr.Close()
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("User-Agent", "ImageUploader/1.0 (+https://github.com)")

		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			backoff := calculateExponentialBackoff(attempt, 1000, 120000)
			time.Sleep(backoff)
			continue
		}

		headers := parseRateLimitHeaders(resp)

		if pipeErr := <-errCh; pipeErr != nil {
			resp.Body.Close()
			return nil, fmt.Errorf("failed to write multipart: %w", pipeErr)
		}

		var result SxcuResponse
		if err := json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&result); err != nil {
			resp.Body.Close()
			return nil, fmt.Errorf("failed to parse response: %w", err)
		}
		resp.Body.Close()

		isGlobalError := resp.StatusCode == 429 && (headers.IsGlobal || result.Code == 2)
		isRateLimitError := resp.StatusCode == 429 || result.Code == 815 || result.Code == 185

		updateSxcuRateLimit(sxcuFileUploadBucket, headers, isGlobalError, isRateLimitError)

		if isRateLimitError {
			if attempt < maxRetries {
				check := checkSxcuRateLimit(sxcuFileUploadBucket)
				waitMs := check.WaitMs
				if waitMs <= 0 {
					waitMs = int64(calculateExponentialBackoff(attempt, 1000, 120000) / time.Millisecond)
				}
				time.Sleep(time.Duration(waitMs) * time.Millisecond)
				lastErr = fmt.Errorf("rate limit hit: %s (code: %d)", result.Error, result.Code)
				continue
			}
			return nil, fmt.Errorf("API error: %s (code: %d)", result.Error, result.Code)
		}

		if result.Error != "" {
			return nil, fmt.Errorf("API error: %s (code: %d)", result.Error, result.Code)
		}

		return &result, nil
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("max retries exceeded")
}

func uploadFileToSxcuWithRateLimitInfo(filePath, collectionID string, maxRetries int, onRateLimitWait func(waitMs int64, bucket string)) (*SxcuResponse, error) {
	if !isSxcuAllowedFileType(filePath) {
		ext := filepath.Ext(filePath)
		return nil, fmt.Errorf("file type '%s' is not allowed for sxcu.net", ext)
	}

	var lastErr error
	fileName := filepath.Base(filePath)

	for attempt := 0; attempt <= maxRetries; attempt++ {
		check := checkSxcuRateLimit(sxcuFileUploadBucket)
		if !check.Allowed {
			if attempt >= maxRetries {
				return nil, fmt.Errorf("rate limit exceeded, retry after %dms", check.WaitMs)
			}
			if onRateLimitWait != nil {
				bucket := check.Bucket
				if bucket == "" {
					bucket = sxcuFileUploadBucket
				}
				onRateLimitWait(check.WaitMs, bucket)
			} else {
				time.Sleep(time.Duration(check.WaitMs) * time.Millisecond)
			}
			continue
		}

		pr, pw := io.Pipe()
		writer := multipart.NewWriter(pw)
		contentType := writer.FormDataContentType()

		errCh := make(chan error, 1)
		go func() {
			defer pw.Close()
			defer writer.Close()

			part, err := writer.CreateFormFile("file", fileName)
			if err != nil {
				pw.CloseWithError(err)
				errCh <- err
				return
			}

			file, err := os.Open(filePath)
			if err != nil {
				pw.CloseWithError(err)
				errCh <- err
				return
			}
			defer file.Close()

			bufp := copyBufPool.Get().(*[]byte)
			_, err = io.CopyBuffer(part, file, *bufp)
			copyBufPool.Put(bufp)
			if err != nil {
				pw.CloseWithError(err)
				errCh <- err
				return
			}

			writer.WriteField("noembed", "")
			if collectionID != "" {
				writer.WriteField("collection", collectionID)
			}
			errCh <- nil
		}()

		req, err := http.NewRequest("POST", "https://sxcu.net/api/files/create", pr)
		if err != nil {
			pr.Close()
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("User-Agent", "ImageUploader/1.0 (+https://github.com)")

		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			backoff := calculateExponentialBackoff(attempt, 1000, 120000)
			time.Sleep(backoff)
			continue
		}

		headers := parseRateLimitHeaders(resp)

		if pipeErr := <-errCh; pipeErr != nil {
			resp.Body.Close()
			return nil, fmt.Errorf("failed to write multipart: %w", pipeErr)
		}

		var result SxcuResponse
		if err := json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&result); err != nil {
			resp.Body.Close()
			return nil, fmt.Errorf("failed to parse response: %w", err)
		}
		resp.Body.Close()

		isGlobalError := resp.StatusCode == 429 && (headers.IsGlobal || result.Code == 2)
		isRateLimitError := resp.StatusCode == 429 || result.Code == 815 || result.Code == 185

		updateSxcuRateLimit(sxcuFileUploadBucket, headers, isGlobalError, isRateLimitError)

		if isRateLimitError {
			if attempt < maxRetries {
				check := checkSxcuRateLimit(sxcuFileUploadBucket)
				waitMs := check.WaitMs
				if waitMs <= 0 {
					waitMs = int64(calculateExponentialBackoff(attempt, 1000, 120000) / time.Millisecond)
				}
				bucket := check.Bucket
				if bucket == "" {
					bucket = sxcuFileUploadBucket
				}
				if onRateLimitWait != nil {
					onRateLimitWait(waitMs, bucket)
				} else {
					time.Sleep(time.Duration(waitMs) * time.Millisecond)
				}
				lastErr = fmt.Errorf("rate limit hit: %s (code: %d)", result.Error, result.Code)
				continue
			}
			return nil, fmt.Errorf("API error: %s (code: %d)", result.Error, result.Code)
		}

		if result.Error != "" {
			return nil, fmt.Errorf("API error: %s (code: %d)", result.Error, result.Code)
		}

		return &result, nil
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("max retries exceeded")
}

func createSxcuCollection(title, desc string, maxRetries int) (*SxcuCollectionResponse, error) {
	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		check := checkSxcuRateLimit(sxcuCollectionBucket)
		if !check.Allowed {
			if attempt >= maxRetries {
				return nil, fmt.Errorf("rate limit exceeded, retry after %dms", check.WaitMs)
			}
			time.Sleep(time.Duration(check.WaitMs) * time.Millisecond)
			continue
		}

		pr, pw := io.Pipe()
		writer := multipart.NewWriter(pw)
		contentType := writer.FormDataContentType()

		go func() {
			defer pw.Close()
			defer writer.Close()
			writer.WriteField("title", title)
			writer.WriteField("desc", desc)
			writer.WriteField("private", "false")
			writer.WriteField("unlisted", "false")
		}()

		req, err := http.NewRequest("POST", "https://sxcu.net/api/collections/create", pr)
		if err != nil {
			pr.Close()
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("User-Agent", "ImageUploader/1.0 (+https://github.com)")

		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			backoff := calculateExponentialBackoff(attempt, 1000, 120000)
			time.Sleep(backoff)
			continue
		}

		headers := parseRateLimitHeaders(resp)

		var result SxcuCollectionResponse
		if err := json.NewDecoder(io.LimitReader(resp.Body, 8192)).Decode(&result); err != nil {
			resp.Body.Close()
			return nil, fmt.Errorf("failed to parse response: %w", err)
		}
		resp.Body.Close()

		isGlobalError := resp.StatusCode == 429 && (headers.IsGlobal || result.Code == 2)
		isRateLimitError := resp.StatusCode == 429 || result.Code == 19

		updateSxcuRateLimit(sxcuCollectionBucket, headers, isGlobalError, isRateLimitError)

		if isRateLimitError {
			if attempt < maxRetries {
				check := checkSxcuRateLimit(sxcuCollectionBucket)
				waitMs := check.WaitMs
				if waitMs <= 0 {
					waitMs = int64(calculateExponentialBackoff(attempt, 1000, 120000) / time.Millisecond)
				}
				time.Sleep(time.Duration(waitMs) * time.Millisecond)
				lastErr = fmt.Errorf("rate limit hit: %s (code: %d)", result.Error, result.Code)
				continue
			}
			return nil, fmt.Errorf("API error: %s (code: %d)", result.Error, result.Code)
		}

		if result.Error != "" {
			return nil, fmt.Errorf("API error: %s (code: %d)", result.Error, result.Code)
		}

		return &result, nil
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("max retries exceeded")
}

type ImgchestImage struct {
	ID   string `json:"id"`
	Link string `json:"link"`
}

type ImgchestPostResponse struct {
	Data struct {
		ID        string          `json:"id"`
		Link      string          `json:"link"`
		DeleteURL string          `json:"delete_url"`
		Images    []ImgchestImage `json:"images"`
	} `json:"data"`
	Success json.RawMessage `json:"success"`
	Message string          `json:"message"`
}

func (r *ImgchestPostResponse) IsSuccess() bool {
	if len(r.Success) == 0 {
		return false
	}
	s := string(r.Success)
	return s == "true" || s == `"true"`
}

func (r *ImgchestPostResponse) IsFailure() bool {
	if len(r.Success) == 0 {
		return false
	}
	s := string(r.Success)
	return s == "false" || s == `"false"`
}

func (r *ImgchestPostResponse) GetPostURL() string {
	if r.Data.Link != "" {
		return r.Data.Link
	}
	if r.Data.ID != "" {
		return "https://imgchest.com/p/" + r.Data.ID
	}
	return ""
}

var customImgchestToken string

func SetImgchestToken(token string) {
	customImgchestToken = token
}

func getImgchestToken() (string, error) {
	if customImgchestToken != "" {
		return customImgchestToken, nil
	}

	exePath, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("failed to get executable path: %w", err)
	}
	exeDir := filepath.Dir(exePath)
	configFile := filepath.Join(exeDir, "..", "imgchest.txt")

	data, err := os.ReadFile(configFile)
	if err != nil {
		return "", fmt.Errorf("imgchest.txt not found. Create imgchest.txt next to the executable or enter token in UI")
	}

	data = bytes.TrimSpace(data)
	return string(data), nil
}

type ImgchestBatchCallback func(batchNum int, totalBatches int, postURL string, imageLinks []string, imageIDs []string, err error)

type ImgchestUploadOptions struct {
	Title     string
	Privacy   string // public, hidden, secret
	NSFW      bool
	Anonymous bool
}

const (
	imgchestMaxFileSize         = 30 * 1024 * 1024 // 30MB
	imgchestAllowedExtensions   = ".jpg,.jpeg,.png,.gif,.webp,.mp4"
)

var imgchestAllowedExtMap = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true, ".mp4": true,
}

func ValidateImgchestFile(filePath string) error {
	ext := strings.ToLower(filepath.Ext(filePath))
	if !imgchestAllowedExtMap[ext] {
		return fmt.Errorf("unsupported file type %s (allowed: %s)", ext, imgchestAllowedExtensions)
	}

	st, err := os.Stat(filePath)
	if err != nil {
		return err
	}
	if st.Size() > imgchestMaxFileSize {
		return fmt.Errorf("file too large (%d bytes > 30MB limit)", st.Size())
	}

	return nil
}

func updateImgchestPost(postID string, opts ImgchestUploadOptions, maxRetries int) error {
	if postID == "" {
		return fmt.Errorf("post ID is required")
	}

	token, err := getImgchestToken()
	if err != nil {
		return err
	}
	authHeader := "Bearer " + token
	apiURL := "https://api.imgchest.com/v1/post/" + postID

	privacy := opts.Privacy
	if privacy == "" {
		privacy = "hidden"
	}

	nsfwStr := "false"
	if opts.NSFW {
		nsfwStr = "true"
	}

	payload := map[string]interface{}{
		"privacy": privacy,
		"nsfw":    nsfwStr,
	}
	if opts.Title != "" {
		payload["title"] = opts.Title
	}

	jsonData, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal update: %w", err)
	}

	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		check := checkImgchestRateLimit()
		if !check.Allowed {
			if attempt >= maxRetries {
				return fmt.Errorf("rate limit exceeded, retry after %dms", check.WaitMs)
			}
			time.Sleep(time.Duration(check.WaitMs) * time.Millisecond)
		}

		req, err := http.NewRequest("PATCH", apiURL, bytes.NewReader(jsonData))
		if err != nil {
			return fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json")
		req.Header.Set("Authorization", authHeader)

		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			backoff := calculateExponentialBackoff(attempt, 1000, 120000)
			time.Sleep(backoff)
			continue
		}

		headers := parseRateLimitHeaders(resp)
		updateImgchestRateLimit(headers)

		if resp.StatusCode == 429 {
			resp.Body.Close()
			if attempt < maxRetries {
				check := checkImgchestRateLimit()
				waitMs := check.WaitMs
				if waitMs <= 0 {
					waitMs = int64(calculateExponentialBackoff(attempt, 1000, 120000) / time.Millisecond)
				}
				time.Sleep(time.Duration(waitMs) * time.Millisecond)
				lastErr = fmt.Errorf("rate limit exceeded")
				continue
			}
			return fmt.Errorf("rate limit exceeded")
		}

		body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		if err != nil {
			return fmt.Errorf("failed to read response: %w", err)
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("API error: status=%d body=%s", resp.StatusCode, string(body))
		}

		if len(body) > 0 {
			var result struct {
				Success json.RawMessage `json:"success"`
				Message string          `json:"message"`
			}
			if json.Unmarshal(body, &result) == nil {
				if s := string(result.Success); s == "false" || s == `"false"` {
					msg := result.Message
					if msg == "" {
						msg = "unknown error"
					}
					return fmt.Errorf("API update failed: %s", msg)
				}
			}
		}

		return nil
	}

	if lastErr != nil {
		return lastErr
	}
	return fmt.Errorf("max retries exceeded")
}

func uploadToImgchestBatch(filePaths []string, opts ImgchestUploadOptions, maxRetries int) (*ImgchestPostResponse, error) {
	token, err := getImgchestToken()
	if err != nil {
		return nil, err
	}
	authHeader := "Bearer " + token

	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		check := checkImgchestRateLimit()
		if !check.Allowed {
			if attempt >= maxRetries {
				return nil, fmt.Errorf("rate limit exceeded, retry after %dms", check.WaitMs)
			}
			time.Sleep(time.Duration(check.WaitMs) * time.Millisecond)
		}

		pr, pw := io.Pipe()
		writer := multipart.NewWriter(pw)
		contentType := writer.FormDataContentType()

		errCh := make(chan error, 1)
		go func() {
			defer pw.Close()
			defer writer.Close()

			if opts.Title != "" {
				writer.WriteField("title", opts.Title)
			}
			privacy := opts.Privacy
			if privacy == "" {
				privacy = "hidden"
			}
			writer.WriteField("privacy", privacy)
			if opts.NSFW {
				writer.WriteField("nsfw", "true")
			} else {
				writer.WriteField("nsfw", "false")
			}
			if opts.Anonymous {
				writer.WriteField("anonymous", "1")
			} else {
				writer.WriteField("anonymous", "0")
			}

			bufp := copyBufPool.Get().(*[]byte)
			defer copyBufPool.Put(bufp)

			for _, filePath := range filePaths {
				file, err := os.Open(filePath)
				if err != nil {
					pw.CloseWithError(err)
					errCh <- err
					return
				}

				part, err := writer.CreateFormFile("images[]", filepath.Base(filePath))
				if err != nil {
					file.Close()
					pw.CloseWithError(err)
					errCh <- err
					return
				}

				_, err = io.CopyBuffer(part, file, *bufp)
				file.Close()
				if err != nil {
					pw.CloseWithError(err)
					errCh <- err
					return
				}
			}
			errCh <- nil
		}()

		req, err := http.NewRequest("POST", "https://api.imgchest.com/v1/post", pr)
		if err != nil {
			pr.Close()
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("Authorization", authHeader)

		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			backoff := calculateExponentialBackoff(attempt, 1000, 120000)
			time.Sleep(backoff)
			continue
		}

		headers := parseRateLimitHeaders(resp)
		updateImgchestRateLimit(headers)

		if pipeErr := <-errCh; pipeErr != nil {
			resp.Body.Close()
			return nil, fmt.Errorf("failed to write multipart: %w", pipeErr)
		}

		if resp.StatusCode == 429 {
			resp.Body.Close()
			if attempt < maxRetries {
				check := checkImgchestRateLimit()
				waitMs := check.WaitMs
				if waitMs <= 0 {
					waitMs = int64(calculateExponentialBackoff(attempt, 1000, 120000) / time.Millisecond)
				}
				time.Sleep(time.Duration(waitMs) * time.Millisecond)
				lastErr = fmt.Errorf("rate limit exceeded")
				continue
			}
			return nil, fmt.Errorf("rate limit exceeded")
		}

		body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("failed to read response: %w", err)
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("API error: status=%d body=%s", resp.StatusCode, string(body))
		}

		var result ImgchestPostResponse
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("failed to parse response: %s", string(body))
		}

		if result.IsFailure() {
			msg := result.Message
			if msg == "" {
				msg = "unknown error"
			}
			return nil, fmt.Errorf("API error: %s", msg)
		}

		return &result, nil
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("max retries exceeded")
}

func uploadToImgchest(filePaths []string, opts ImgchestUploadOptions, maxRetries int) (*ImgchestPostResponse, error) {
	return uploadToImgchestWithCallback(filePaths, opts, maxRetries, nil)
}

func uploadToImgchestWithCallback(filePaths []string, opts ImgchestUploadOptions, maxRetries int, callback ImgchestBatchCallback) (*ImgchestPostResponse, error) {
	if len(filePaths) == 0 {
		return nil, fmt.Errorf("no files to upload")
	}

	const batchSize = 20
	if opts.Anonymous && len(filePaths) > batchSize {
		return nil, fmt.Errorf("anonymous uploads are limited to %d files (cannot add files to anonymous posts)", batchSize)
	}

	totalBatches := (len(filePaths) + batchSize - 1) / batchSize

	firstBatchEnd := batchSize
	if firstBatchEnd > len(filePaths) {
		firstBatchEnd = len(filePaths)
	}
	firstBatch := filePaths[:firstBatchEnd]

	resp, err := uploadToImgchestBatch(firstBatch, opts, maxRetries)
	if err != nil {
		if callback != nil {
			callback(1, totalBatches, "", nil, nil, err)
		}
		return nil, err
	}

	var allImages []ImgchestImage
	allImages = append(allImages, resp.Data.Images...)

	if callback != nil {
		var links []string
		var ids []string
		for _, img := range resp.Data.Images {
			links = append(links, img.Link)
			ids = append(ids, img.ID)
		}
		callback(1, totalBatches, resp.GetPostURL(), links, ids, nil)
	}

	if len(filePaths) > batchSize {
		postID := resp.Data.ID

		for batchNum := 2; batchNum <= totalBatches; batchNum++ {
			start := (batchNum - 1) * batchSize
			end := start + batchSize
			if end > len(filePaths) {
				end = len(filePaths)
			}
			batch := filePaths[start:end]

			addResp, err := addToImgchestPost(postID, batch, maxRetries)
			if err != nil {
				if callback != nil {
					callback(batchNum, totalBatches, resp.GetPostURL(), nil, nil, err)
				}
				continue
			}

			allImages = append(allImages, addResp.Data.Images...)

			if callback != nil {
				var links []string
				var ids []string
				for _, img := range addResp.Data.Images {
					links = append(links, img.Link)
					ids = append(ids, img.ID)
				}
				callback(batchNum, totalBatches, resp.GetPostURL(), links, ids, nil)
			}
		}
	}

	resp.Data.Images = allImages
	return resp, nil
}

func addToImgchestPost(postID string, filePaths []string, maxRetries int) (*ImgchestPostResponse, error) {
	token, err := getImgchestToken()
	if err != nil {
		return nil, err
	}
	authHeader := "Bearer " + token
	apiURL := "https://api.imgchest.com/v1/post/" + postID + "/add"

	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		check := checkImgchestRateLimit()
		if !check.Allowed {
			if attempt >= maxRetries {
				return nil, fmt.Errorf("rate limit exceeded, retry after %dms", check.WaitMs)
			}
			time.Sleep(time.Duration(check.WaitMs) * time.Millisecond)
		}

		pr, pw := io.Pipe()
		writer := multipart.NewWriter(pw)
		contentType := writer.FormDataContentType()

		errCh := make(chan error, 1)
		go func() {
			defer pw.Close()
			defer writer.Close()

			bufp := copyBufPool.Get().(*[]byte)
			defer copyBufPool.Put(bufp)

			for _, filePath := range filePaths {
				file, err := os.Open(filePath)
				if err != nil {
					pw.CloseWithError(err)
					errCh <- err
					return
				}

				part, err := writer.CreateFormFile("images[]", filepath.Base(filePath))
				if err != nil {
					file.Close()
					pw.CloseWithError(err)
					errCh <- err
					return
				}

				_, err = io.CopyBuffer(part, file, *bufp)
				file.Close()
				if err != nil {
					pw.CloseWithError(err)
					errCh <- err
					return
				}
			}
			errCh <- nil
		}()

		req, err := http.NewRequest("POST", apiURL, pr)
		if err != nil {
			pr.Close()
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", contentType)
		req.Header.Set("Authorization", authHeader)

		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			backoff := calculateExponentialBackoff(attempt, 1000, 120000)
			time.Sleep(backoff)
			continue
		}

		headers := parseRateLimitHeaders(resp)
		updateImgchestRateLimit(headers)

		if pipeErr := <-errCh; pipeErr != nil {
			resp.Body.Close()
			return nil, fmt.Errorf("failed to write multipart: %w", pipeErr)
		}

		if resp.StatusCode == 429 {
			resp.Body.Close()
			if attempt < maxRetries {
				check := checkImgchestRateLimit()
				waitMs := check.WaitMs
				if waitMs <= 0 {
					waitMs = int64(calculateExponentialBackoff(attempt, 1000, 120000) / time.Millisecond)
				}
				time.Sleep(time.Duration(waitMs) * time.Millisecond)
				lastErr = fmt.Errorf("rate limit exceeded")
				continue
			}
			return nil, fmt.Errorf("rate limit exceeded")
		}

		body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("failed to read response: %w", err)
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, fmt.Errorf("API error: status=%d body=%s", resp.StatusCode, string(body))
		}

		var result ImgchestPostResponse
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("failed to parse response: %s", string(body))
		}

		if result.IsFailure() {
			msg := result.Message
			if msg == "" {
				msg = "unknown error"
			}
			return nil, fmt.Errorf("API error: %s", msg)
		}

		return &result, nil
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("max retries exceeded")
}

func extractCatboxFilename(url string) string {
	parts := strings.Split(url, "/")
	if len(parts) > 0 {
		return parts[len(parts)-1]
	}
	return ""
}

func main() {
	app := NewApp()
	if err := app.Run(); err != nil {
		showError(err.Error())
	}
}
