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
)

// Windows API for MessageBox
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

// Rate limit structures
type RateLimitInfo struct {
	Remaining   int   `json:"remaining"`
	Reset       int64 `json:"reset"`
	Limit       int   `json:"limit"`
	WindowStart int64 `json:"windowStart"`
	Updated     int64 `json:"updated"`
}

var (
	sxcuRateLimit    *RateLimitInfo
	imgchestRateLimit *RateLimitInfo
	rateLimitMutex   sync.Mutex
)

func getRateLimitFilePath(provider string) string {
	return filepath.Join(os.TempDir(), fmt.Sprintf("image_uploader_%s_rate_limit.json", provider))
}

func loadRateLimitFromFile(provider string) *RateLimitInfo {
	path := getRateLimitFilePath(provider)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var info RateLimitInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return nil
	}
	
	now := time.Now().Unix()
	
	// For sxcu, check if reset time has passed
	if provider == "sxcu" && info.Reset > 0 && now >= info.Reset {
		return nil
	}
	
	// For imgchest, check if 60 second window has passed
	if provider == "imgchest" && info.WindowStart > 0 {
		if now-info.WindowStart >= 60 {
			return nil
		}
	}
	
	return &info
}

func saveRateLimitToFile(provider string, info *RateLimitInfo) {
	path := getRateLimitFilePath(provider)
	info.Updated = time.Now().Unix()
	if provider == "imgchest" && info.WindowStart == 0 {
		info.WindowStart = time.Now().Unix()
	}
	data, err := json.Marshal(info)
	if err != nil {
		return
	}
	os.WriteFile(path, data, 0644)
}

// Allowed file types for sxcu
var sxcuAllowedExtensions = map[string]bool{
	".png": true, ".gif": true, ".jpeg": true, ".jpg": true,
	".ico": true, ".bmp": true, ".tiff": true, ".tif": true,
	".webm": true, ".webp": true,
}

func isSxcuAllowedFileType(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return sxcuAllowedExtensions[ext]
}

// HTTP client with timeout
var httpClient = &http.Client{
	Timeout: 5 * time.Minute,
}

// Catbox API
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

// sxcu.net API
type SxcuResponse struct {
	ID    string `json:"id"`
	URL   string `json:"url"`
	Error string `json:"error"`
	Code  int    `json:"code"`
}

type SxcuCollectionResponse struct {
	CollectionID string `json:"collection_id"`
	URL          string `json:"url"`
	Error        string `json:"error"`
	Code         int    `json:"code"`
}

func uploadFileToSxcu(filePath, collectionID string, maxRetries int) (*SxcuResponse, error) {
	if !isSxcuAllowedFileType(filePath) {
		ext := filepath.Ext(filePath)
		return nil, fmt.Errorf("file type '%s' is not allowed for sxcu.net", ext)
	}

	var lastErr error
	baseDelay := 2 * time.Second

	for attempt := 0; attempt <= maxRetries; attempt++ {
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
			continue
		}

		// Parse rate limit headers
		if remaining := resp.Header.Get("X-RateLimit-Remaining"); remaining != "" {
			if reset := resp.Header.Get("X-RateLimit-Reset"); reset != "" {
				rateLimitMutex.Lock()
				rem, _ := strconv.Atoi(remaining)
				res, _ := strconv.ParseInt(reset, 10, 64)
				sxcuRateLimit = &RateLimitInfo{Remaining: rem, Reset: res}
				saveRateLimitToFile("sxcu", sxcuRateLimit)
				rateLimitMutex.Unlock()
			}
		}

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

		if result.Error != "" {
			// Rate limit error (code 815)
			if result.Code == 815 && attempt < maxRetries {
				delay := baseDelay * time.Duration(1<<attempt)
				time.Sleep(delay)
				lastErr = fmt.Errorf("rate limit hit: %s", result.Error)
				continue
			}
			return nil, fmt.Errorf("API error: %s (code: %d)", result.Error, result.Code)
		}

		return &result, nil
	}

	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("max retries exceeded")
}

func createSxcuCollection(title, desc string) (*SxcuCollectionResponse, error) {
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
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	var result SxcuCollectionResponse
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w", err)
	}

	if result.Error != "" {
		return nil, fmt.Errorf("API error: %s (code: %d)", result.Error, result.Code)
	}

	return &result, nil
}

// imgchest API
type ImgchestPostResponse struct {
	Data struct {
		ID        string `json:"id"`
		Link      string `json:"link"`
		DeleteURL string `json:"delete_url"`
		Images    []struct {
			ID   string `json:"id"`
			Link string `json:"link"`
		} `json:"images"`
	} `json:"data"`
	Success bool   `json:"success"`
	Message string `json:"message"`
}

func getImgchestToken() (string, error) {
	// First check environment variable
	if token := os.Getenv("IMGCHEST_API_TOKEN"); token != "" {
		return token, nil
	}

	// Then check config file
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

func uploadToImgchest(filePaths []string, title string, anonymous bool, maxRetries int) (*ImgchestPostResponse, error) {
	token, err := getImgchestToken()
	if err != nil && !anonymous {
		return nil, err
	}

	var lastErr error
	baseDelay := 2 * time.Second

	for attempt := 0; attempt <= maxRetries; attempt++ {
		var buf bytes.Buffer
		writer := multipart.NewWriter(&buf)

		if title != "" {
			writer.WriteField("title", title)
		}
		writer.WriteField("privacy", "hidden")
		if anonymous {
			writer.WriteField("anonymous", "true")
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
		if token != "" && !anonymous {
			req.Header.Set("Authorization", "Bearer "+token)
		}

		resp, err := httpClient.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("request failed: %w", err)
			continue
		}

		// Parse rate limit headers
		if remaining := resp.Header.Get("X-RateLimit-Remaining"); remaining != "" {
			rateLimitMutex.Lock()
			rem, _ := strconv.Atoi(remaining)
			limit := 60
			if l := resp.Header.Get("X-RateLimit-Limit"); l != "" {
				limit, _ = strconv.Atoi(l)
			}
			imgchestRateLimit = &RateLimitInfo{Remaining: rem, Limit: limit, WindowStart: time.Now().Unix()}
			saveRateLimitToFile("imgchest", imgchestRateLimit)
			rateLimitMutex.Unlock()
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("failed to read response: %w", err)
			continue
		}

		// Check for rate limit
		if resp.StatusCode == 429 && attempt < maxRetries {
			delay := baseDelay * time.Duration(1<<attempt)
			time.Sleep(delay)
			lastErr = fmt.Errorf("rate limit exceeded")
			continue
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

func addToImgchestPost(postID string, filePaths []string, maxRetries int) (*ImgchestPostResponse, error) {
	token, err := getImgchestToken()
	if err != nil {
		return nil, err
	}

	var lastErr error
	baseDelay := 2 * time.Second

	for attempt := 0; attempt <= maxRetries; attempt++ {
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
			continue
		}

		// Parse rate limit headers
		if remaining := resp.Header.Get("X-RateLimit-Remaining"); remaining != "" {
			rateLimitMutex.Lock()
			rem, _ := strconv.Atoi(remaining)
			limit := 60
			if l := resp.Header.Get("X-RateLimit-Limit"); l != "" {
				limit, _ = strconv.Atoi(l)
			}
			imgchestRateLimit = &RateLimitInfo{Remaining: rem, Limit: limit, WindowStart: time.Now().Unix()}
			saveRateLimitToFile("imgchest", imgchestRateLimit)
			rateLimitMutex.Unlock()
		}

		body, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = fmt.Errorf("failed to read response: %w", err)
			continue
		}

		// Check for rate limit
		if resp.StatusCode == 429 && attempt < maxRetries {
			delay := baseDelay * time.Duration(1<<attempt)
			time.Sleep(delay)
			lastErr = fmt.Errorf("rate limit exceeded")
			continue
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

// Extract filename from catbox URL (e.g., "https://files.catbox.moe/abc123.png" -> "abc123.png")
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
