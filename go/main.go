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
	user32         = syscall.NewLazyDLL("user32.dll")
	messageBoxW    = user32.NewProc("MessageBoxW")
	comdlg32       = syscall.NewLazyDLL("comdlg32.dll")
	getOpenFileNameW = comdlg32.NewProc("GetOpenFileNameW")
)

const (
	MB_OK              = 0x00000000
	MB_ICONERROR       = 0x00000010
	MB_ICONINFORMATION = 0x00000040
)

func showError(message string) {
	title, _ := syscall.UTF16PtrFromString("Image Uploader - Error")
	msg, _ := syscall.UTF16PtrFromString(message)
	messageBoxW.Call(0, uintptr(unsafe.Pointer(msg)), uintptr(unsafe.Pointer(title)), MB_OK|MB_ICONERROR)
}

func showInfo(message string) {
	title, _ := syscall.UTF16PtrFromString("Image Uploader")
	msg, _ := syscall.UTF16PtrFromString(message)
	messageBoxW.Call(0, uintptr(unsafe.Pointer(msg)), uintptr(unsafe.Pointer(title)), MB_OK|MB_ICONINFORMATION)
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

var sxcuAllowedExtensions = map[string]bool{
	".png": true, ".gif": true, ".jpeg": true, ".jpg": true,
	".ico": true, ".bmp": true, ".tiff": true, ".tif": true,
	".webm": true, ".webp": true,
}

func isSxcuAllowedFileType(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return sxcuAllowedExtensions[ext]
}

var httpClient = &http.Client{
	Timeout: 5 * time.Minute,
}

func uploadFileToCatbox(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	writer.WriteField("reqtype", "fileupload")

	part, err := writer.CreateFormFile("fileToUpload", filepath.Base(filePath))
	if err != nil {
		return "", fmt.Errorf("failed to create form file: %w", err)
	}

	if _, err := io.Copy(part, file); err != nil {
		return "", fmt.Errorf("failed to copy file data: %w", err)
	}

	writer.Close()

	req, err := http.NewRequest("POST", "https://catbox.moe/user/api.php", &buf)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read response: %w", err)
	}

	result := strings.TrimSpace(string(body))
	if !strings.HasPrefix(result, "https://") {
		return "", fmt.Errorf("upload failed: %s", result)
	}

	return result, nil
}

func uploadURLToCatbox(url string) (string, error) {
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	writer.WriteField("reqtype", "urlupload")
	writer.WriteField("url", url)
	writer.Close()

	req, err := http.NewRequest("POST", "https://catbox.moe/user/api.php", &buf)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
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
	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)

	writer.WriteField("reqtype", "createalbum")
	writer.WriteField("title", title)
	writer.WriteField("desc", desc)
	writer.WriteField("files", strings.Join(fileNames, " "))
	writer.Close()

	req, err := http.NewRequest("POST", "https://catbox.moe/user/api.php", &buf)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
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

	for attempt := 0; attempt <= maxRetries; attempt++ {
		check := checkSxcuRateLimit(sxcuFileUploadBucket)
		if !check.Allowed {
			if attempt >= maxRetries {
				return nil, fmt.Errorf("rate limit exceeded, retry after %dms", check.WaitMs)
			}
			time.Sleep(time.Duration(check.WaitMs) * time.Millisecond)
			continue
		}

		file, err := os.Open(filePath)
		if err != nil {
			return nil, fmt.Errorf("failed to open file: %w", err)
		}

		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)

		part, err := writer.CreateFormFile("file", filepath.Base(filePath))
		if err != nil {
			file.Close()
			return nil, fmt.Errorf("failed to create form file: %w", err)
		}

		if _, err := io.Copy(part, file); err != nil {
			file.Close()
			return nil, fmt.Errorf("failed to copy file data: %w", err)
		}

		writer.WriteField("noembed", "")
		if collectionID != "" {
			writer.WriteField("collection", collectionID)
		}
		writer.Close()
		file.Close()

		req, err := http.NewRequest("POST", "https://sxcu.net/api/files/create", &buf)
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("User-Agent", "ImageUploader/1.0 (+https://github.com)")

		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			backoff := calculateExponentialBackoff(attempt, 1000, 120000)
			time.Sleep(backoff)
			continue
		}

		headers := parseRateLimitHeaders(resp)

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("failed to read response: %w", err)
			continue
		}

		var result SxcuResponse
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("failed to parse response: %w", err)
		}

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

		file, err := os.Open(filePath)
		if err != nil {
			return nil, fmt.Errorf("failed to open file: %w", err)
		}

		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)

		part, err := writer.CreateFormFile("file", filepath.Base(filePath))
		if err != nil {
			file.Close()
			return nil, fmt.Errorf("failed to create form file: %w", err)
		}

		if _, err := io.Copy(part, file); err != nil {
			file.Close()
			return nil, fmt.Errorf("failed to copy file data: %w", err)
		}

		writer.WriteField("noembed", "")
		if collectionID != "" {
			writer.WriteField("collection", collectionID)
		}
		writer.Close()
		file.Close()

		req, err := http.NewRequest("POST", "https://sxcu.net/api/files/create", &buf)
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("User-Agent", "ImageUploader/1.0 (+https://github.com)")

		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			backoff := calculateExponentialBackoff(attempt, 1000, 120000)
			time.Sleep(backoff)
			continue
		}

		headers := parseRateLimitHeaders(resp)

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("failed to read response: %w", err)
			continue
		}

		var result SxcuResponse
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("failed to parse response: %w", err)
		}

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

		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)

		writer.WriteField("title", title)
		writer.WriteField("desc", desc)
		writer.WriteField("private", "false")
		writer.WriteField("unlisted", "false")
		writer.Close()

		req, err := http.NewRequest("POST", "https://sxcu.net/api/collections/create", &buf)
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("User-Agent", "ImageUploader/1.0 (+https://github.com)")

		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			backoff := calculateExponentialBackoff(attempt, 1000, 120000)
			time.Sleep(backoff)
			continue
		}

		headers := parseRateLimitHeaders(resp)

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("failed to read response: %w", err)
			continue
		}

		var result SxcuCollectionResponse
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("failed to parse response: %w", err)
		}

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
		ID        string           `json:"id"`
		Link      string           `json:"link"`
		DeleteURL string           `json:"delete_url"`
		Images    []ImgchestImage  `json:"images"`
	} `json:"data"`
	Success bool   `json:"success"`
	Message string `json:"message"`
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

func getImgchestToken() (string, error) {
	if token := os.Getenv("IMGCHEST_API_TOKEN"); token != "" {
		return token, nil
	}

	appData := os.Getenv("APPDATA")
	if appData == "" {
		return "", fmt.Errorf("IMGCHEST_API_TOKEN not set and APPDATA not found")
	}

	configFile := filepath.Join(appData, "image_uploader_imgchest_token.txt")
	data, err := os.ReadFile(configFile)
	if err != nil {
		return "", fmt.Errorf("IMGCHEST_API_TOKEN not set. Set the environment variable or create %s with your token", configFile)
	}

	return strings.TrimSpace(string(data)), nil
}

type ImgchestBatchCallback func(batchNum int, totalBatches int, postURL string, imageLinks []string, err error)

func uploadToImgchestBatch(filePaths []string, title string, anonymous bool, maxRetries int) (*ImgchestPostResponse, error) {
	token, err := getImgchestToken()
	if err != nil {
		return nil, err
	}

	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		check := checkImgchestRateLimit()
		if !check.Allowed {
			if attempt >= maxRetries {
				return nil, fmt.Errorf("rate limit exceeded, retry after %dms", check.WaitMs)
			}
			time.Sleep(time.Duration(check.WaitMs) * time.Millisecond)
		}

		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)

		if title != "" {
			writer.WriteField("title", title)
		}
		writer.WriteField("privacy", "hidden")
		writer.WriteField("nsfw", "true")
		if anonymous {
			writer.WriteField("anonymous", "1")
		} else {
			writer.WriteField("anonymous", "0")
		}

		for _, filePath := range filePaths {
			file, err := os.Open(filePath)
			if err != nil {
				return nil, fmt.Errorf("failed to open file %s: %w", filePath, err)
			}

			part, err := writer.CreateFormFile("images[]", filepath.Base(filePath))
			if err != nil {
				file.Close()
				return nil, fmt.Errorf("failed to create form file: %w", err)
			}

			if _, err := io.Copy(part, file); err != nil {
				file.Close()
				return nil, fmt.Errorf("failed to copy file data: %w", err)
			}
			file.Close()
		}

		writer.Close()

		req, err := http.NewRequest("POST", "https://api.imgchest.com/v1/post", &buf)
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			backoff := calculateExponentialBackoff(attempt, 1000, 120000)
			time.Sleep(backoff)
			continue
		}

		headers := parseRateLimitHeaders(resp)
		updateImgchestRateLimit(headers)

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("failed to read response: %w", err)
			continue
		}

		if resp.StatusCode == 429 {
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

		var result ImgchestPostResponse
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("failed to parse response: %s", string(body))
		}

		if !result.Success && result.Message != "" {
			return nil, fmt.Errorf("API error: %s", result.Message)
		}

		return &result, nil
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("max retries exceeded")
}

func uploadToImgchest(filePaths []string, title string, anonymous bool, maxRetries int) (*ImgchestPostResponse, error) {
	return uploadToImgchestWithCallback(filePaths, title, anonymous, maxRetries, nil)
}

func uploadToImgchestWithCallback(filePaths []string, title string, anonymous bool, maxRetries int, callback ImgchestBatchCallback) (*ImgchestPostResponse, error) {
	if len(filePaths) == 0 {
		return nil, fmt.Errorf("no files to upload")
	}

	const batchSize = 20
	totalBatches := (len(filePaths) + batchSize - 1) / batchSize

	firstBatchEnd := batchSize
	if firstBatchEnd > len(filePaths) {
		firstBatchEnd = len(filePaths)
	}
	firstBatch := filePaths[:firstBatchEnd]

	resp, err := uploadToImgchestBatch(firstBatch, title, anonymous, maxRetries)
	if err != nil {
		if callback != nil {
			callback(1, totalBatches, "", nil, err)
		}
		return nil, err
	}

	var allImages []ImgchestImage
	allImages = append(allImages, resp.Data.Images...)

	if callback != nil {
		var links []string
		for _, img := range resp.Data.Images {
			links = append(links, img.Link)
		}
		callback(1, totalBatches, resp.GetPostURL(), links, nil)
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
					callback(batchNum, totalBatches, resp.GetPostURL(), nil, err)
				}
				continue
			}

			allImages = append(allImages, addResp.Data.Images...)

			if callback != nil {
				var links []string
				for _, img := range addResp.Data.Images {
					links = append(links, img.Link)
				}
				callback(batchNum, totalBatches, resp.GetPostURL(), links, nil)
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

	var lastErr error

	for attempt := 0; attempt <= maxRetries; attempt++ {
		check := checkImgchestRateLimit()
		if !check.Allowed {
			if attempt >= maxRetries {
				return nil, fmt.Errorf("rate limit exceeded, retry after %dms", check.WaitMs)
			}
			time.Sleep(time.Duration(check.WaitMs) * time.Millisecond)
		}

		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)

		for _, filePath := range filePaths {
			file, err := os.Open(filePath)
			if err != nil {
				return nil, fmt.Errorf("failed to open file %s: %w", filePath, err)
			}

			part, err := writer.CreateFormFile("images[]", filepath.Base(filePath))
			if err != nil {
				file.Close()
				return nil, fmt.Errorf("failed to create form file: %w", err)
			}

			if _, err := io.Copy(part, file); err != nil {
				file.Close()
				return nil, fmt.Errorf("failed to copy file data: %w", err)
			}
			file.Close()
		}

		writer.Close()

		url := fmt.Sprintf("https://api.imgchest.com/v1/post/%s/add", postID)
		req, err := http.NewRequest("POST", url, &buf)
		if err != nil {
			return nil, fmt.Errorf("failed to create request: %w", err)
		}
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.Header.Set("Authorization", "Bearer "+token)

		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			backoff := calculateExponentialBackoff(attempt, 1000, 120000)
			time.Sleep(backoff)
			continue
		}

		headers := parseRateLimitHeaders(resp)
		updateImgchestRateLimit(headers)

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("failed to read response: %w", err)
			continue
		}

		if resp.StatusCode == 429 {
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

		var result ImgchestPostResponse
		if err := json.Unmarshal(body, &result); err != nil {
			return nil, fmt.Errorf("failed to parse response: %s", string(body))
		}

		if !result.Success && result.Message != "" {
			return nil, fmt.Errorf("API error: %s", result.Message)
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
