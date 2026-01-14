package main

import (
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/lxn/walk"
	. "github.com/lxn/walk/declarative"
)

var timeNow = time.Now
var timeSleep = time.Sleep

type App struct {
	mainWindow       *walk.MainWindow
	fileListBox      *walk.ListBox
	fileListModel    *FileListModel
	urlEdit          *walk.LineEdit
	titleEdit        *walk.LineEdit
	descEdit         *walk.LineEdit
	providerCombo    *walk.ComboBox
	albumCheck       *walk.CheckBox
	collectionCheck  *walk.CheckBox
	anonymousCheck   *walk.CheckBox
	postIDEdit       *walk.LineEdit
	postIDLabel      *walk.Label
	outputEdit       *walk.TextEdit
	uploadButton     *walk.PushButton
	selectedFiles    []string
	uploadCompleted  bool
}

type FileListModel struct {
	walk.ListModelBase
	items []string
}

func (m *FileListModel) ItemCount() int {
	return len(m.items)
}

func (m *FileListModel) Value(index int) interface{} {
	return m.items[index]
}

func NewApp() *App {
	return &App{
		fileListModel: &FileListModel{items: []string{}},
	}
}

func (a *App) Run() error {
	providers := []string{"catbox", "sxcu", "imgchest"}

	err := MainWindow{
		AssignTo: &a.mainWindow,
		Title:    "Image Uploader",
		MinSize:  Size{Width: 400, Height: 600},
		Size:     Size{Width: 420, Height: 650},
		Layout:   VBox{MarginsZero: false, Margins: Margins{Left: 10, Top: 10, Right: 10, Bottom: 10}},
		Children: []Widget{
			// Provider selection
			Composite{
				Layout: HBox{MarginsZero: true},
				Children: []Widget{
					Label{Text: "Provider:"},
					ComboBox{
						AssignTo:      &a.providerCombo,
						Model:         providers,
						CurrentIndex:  0,
						OnCurrentIndexChanged: a.onProviderChanged,
					},
				},
			},

			// File selection
			Label{Text: "Files:"},
			Composite{
				Layout: HBox{MarginsZero: true},
				Children: []Widget{
					PushButton{
						Text:      "Select Files",
						OnClicked: a.onSelectFiles,
					},
					PushButton{
						Text:      "Remove Selected",
						OnClicked: a.onRemoveSelected,
					},
				},
			},
			ListBox{
				AssignTo:       &a.fileListBox,
				Model:          a.fileListModel,
				MinSize:        Size{Height: 100},
				MultiSelection: true,
				OnKeyDown:      a.onFileListKeyDown,
			},

			// URL input (catbox only)
			Label{Text: "URLs (comma-separated, catbox only):"},
			LineEdit{
				AssignTo: &a.urlEdit,
			},

			// Title
			Label{Text: "Title:"},
			LineEdit{
				AssignTo: &a.titleEdit,
			},

			// Description
			Label{Text: "Description:"},
			LineEdit{
				AssignTo: &a.descEdit,
			},

			// Create Album checkbox (catbox only)
			CheckBox{
				AssignTo: &a.albumCheck,
				Text:     "Create Album (catbox only)",
				Checked:  true,
			},

			// Create Collection checkbox (sxcu only)
			CheckBox{
				AssignTo: &a.collectionCheck,
				Text:     "Create Collection (sxcu only)",
				Checked:  true,
				Enabled:  false,
			},

			// Anonymous checkbox (imgchest only)
			CheckBox{
				AssignTo: &a.anonymousCheck,
				Text:     "Anonymous (imgchest only)",
				Enabled:  false,
			},

			// Post ID (imgchest only)
			Label{
				AssignTo: &a.postIDLabel,
				Text:     "Post ID (add to existing, imgchest only):",
			},
			LineEdit{
				AssignTo: &a.postIDEdit,
				Enabled:  false,
			},

			// Upload button
			PushButton{
				AssignTo:  &a.uploadButton,
				Text:      "Upload",
				OnClicked: a.onUpload,
			},

			// Output
			Label{Text: "Output:"},
			TextEdit{
				AssignTo: &a.outputEdit,
				ReadOnly: true,
				VScroll:  true,
				MinSize:  Size{Height: 120},
			},
		},
	}.Create()

	if err != nil {
		return err
	}

	a.mainWindow.Run()
	return nil
}

func (a *App) onProviderChanged() {
	provider := a.providerCombo.Text()

	// Toggle URL field (catbox only)
	a.urlEdit.SetEnabled(provider == "catbox")
	if provider != "catbox" {
		a.urlEdit.SetText("")
	}

	// Toggle album checkbox (catbox only)
	a.albumCheck.SetEnabled(provider == "catbox")
	if provider != "catbox" {
		a.albumCheck.SetChecked(false)
	} else {
		a.albumCheck.SetChecked(true)
	}

	// Toggle collection checkbox (sxcu only)
	a.collectionCheck.SetEnabled(provider == "sxcu")
	if provider != "sxcu" {
		a.collectionCheck.SetChecked(false)
	} else {
		a.collectionCheck.SetChecked(true)
	}

	// Toggle anonymous checkbox (imgchest only)
	a.anonymousCheck.SetEnabled(provider == "imgchest")
	if provider != "imgchest" {
		a.anonymousCheck.SetChecked(false)
	}

	// Toggle post ID field (imgchest only)
	a.postIDEdit.SetEnabled(provider == "imgchest")
	if provider != "imgchest" {
		a.postIDEdit.SetText("")
	}
}

func (a *App) onSelectFiles() {
	if a.uploadCompleted {
		a.selectedFiles = []string{}
		a.fileListModel.items = []string{}
		a.fileListModel.PublishItemsReset()
		a.titleEdit.SetText("")
		a.postIDEdit.SetText("")
		a.uploadCompleted = false
	}

	dlg := new(walk.FileDialog)
	dlg.Title = "Select Files"
	dlg.Filter = "Image files (*.jpg;*.jpeg;*.png;*.gif;*.bmp;*.ico;*.tif;*.tiff;*.webp)|*.jpg;*.jpeg;*.png;*.gif;*.bmp;*.ico;*.tif;*.tiff;*.webp|Video files (*.webm)|*.webm|All files (*.*)|*.*"

	if ok, err := dlg.ShowOpenMultiple(a.mainWindow); err != nil {
		showError(fmt.Sprintf("Failed to open file dialog: %v", err))
		return
	} else if !ok {
		return
	}

	for _, path := range dlg.FilePaths {
		a.selectedFiles = append(a.selectedFiles, path)
		a.fileListModel.items = append(a.fileListModel.items, path)
	}
	a.fileListModel.PublishItemsReset()

	// Auto-fill title from folder name
	if a.titleEdit.Text() == "" && len(a.selectedFiles) > 0 {
		folderPath := filepath.Dir(a.selectedFiles[0])
		a.titleEdit.SetText(filepath.Base(folderPath))
	}
}

func (a *App) onFileListKeyDown(key walk.Key) {
	if key == walk.KeyDelete {
		a.onRemoveSelected()
	}
}

func (a *App) onRemoveSelected() {
	indices := a.fileListBox.SelectedIndexes()
	if len(indices) == 0 {
		return
	}

	// Build new list excluding selected indices
	indexMap := make(map[int]bool)
	for _, idx := range indices {
		indexMap[idx] = true
	}

	newFiles := []string{}
	newItems := []string{}
	for i, f := range a.selectedFiles {
		if !indexMap[i] {
			newFiles = append(newFiles, f)
			newItems = append(newItems, a.fileListModel.items[i])
		}
	}

	a.selectedFiles = newFiles
	a.fileListModel.items = newItems
	a.fileListModel.PublishItemsReset()

	if len(a.selectedFiles) == 0 {
		a.titleEdit.SetText("")
	}
}

func (a *App) onUpload() {
	provider := a.providerCombo.Text()
	urls := strings.TrimSpace(a.urlEdit.Text())
	title := a.titleEdit.Text()
	desc := a.descEdit.Text()
	createAlbum := a.albumCheck.Checked()
	createCollection := a.collectionCheck.Checked()
	anonymous := a.anonymousCheck.Checked()
	postID := strings.TrimSpace(a.postIDEdit.Text())

	if len(a.selectedFiles) == 0 && urls == "" {
		showError("Please select files or enter URLs to upload.")
		return
	}

	// Validate: sxcu and imgchest don't support URL uploads
	if (provider == "sxcu" || provider == "imgchest") && urls != "" {
		showError(fmt.Sprintf("%s does not support URL uploads.", provider))
		return
	}

	a.uploadButton.SetEnabled(false)
	a.uploadButton.SetText("Uploading...")
	a.outputEdit.SetText("")

	go func() {
		// Acquire cross-instance upload lock - blocks until we get our turn
		a.mainWindow.Synchronize(func() {
			a.uploadButton.SetText("Waiting...")
		})
		if err := AcquireUploadLock(); err != nil {
			a.mainWindow.Synchronize(func() {
				a.uploadButton.SetEnabled(true)
				a.uploadButton.SetText("Upload")
				a.outputEdit.SetText("Error: Failed to acquire upload lock: " + err.Error())
			})
			return
		}
		defer ReleaseUploadLock()

		a.mainWindow.Synchronize(func() {
			a.uploadButton.SetText("Uploading...")
		})

		var results []string
		var albumResult string
		var collectionResult string
		var postResult string
		var errors []string

		switch provider {
		case "catbox":
			results, albumResult, errors = a.uploadCatbox(urls, title, desc, createAlbum)
		case "sxcu":
			results, collectionResult, errors = a.uploadSxcu(title, desc, createCollection, func(text string) {
				a.mainWindow.Synchronize(func() {
					a.outputEdit.SetText(text)
				})
			})
		case "imgchest":
			results, postResult, errors = a.uploadImgchest(title, anonymous, postID)
		}

		a.mainWindow.Synchronize(func() {
			a.uploadButton.SetEnabled(true)
			a.uploadButton.SetText("Upload")

			totalInputs := len(a.selectedFiles)
			if urls != "" {
				for _, u := range strings.Split(urls, ",") {
					if strings.TrimSpace(u) != "" {
						totalInputs++
					}
				}
			}
			successCount := len(results)
			failCount := len(errors)

			var output strings.Builder
			if failCount > 0 {
				output.WriteString(fmt.Sprintf("Uploaded %d/%d (%d failed)\r\n\r\n", successCount, totalInputs, failCount))
			} else {
				output.WriteString(fmt.Sprintf("Uploaded %d/%d\r\n\r\n", successCount, totalInputs))
			}

			if albumResult != "" {
				output.WriteString(albumResult + "\r\n")
			}
			if collectionResult != "" {
				output.WriteString(collectionResult + "\r\n")
			}
			if postResult != "" {
				output.WriteString(postResult + "\r\n")
			}
			for _, r := range results {
				output.WriteString(r + "\r\n")
			}
			for _, e := range errors {
				output.WriteString("Error: " + e + "\r\n")
			}

			a.outputEdit.SetText(output.String())

			if successCount > 0 {
				a.uploadCompleted = true
			}
		})
	}()
}

func (a *App) uploadCatbox(urls, title, desc string, createAlbum bool) ([]string, string, []string) {
	var results []string
	var albumResult string
	var errors []string
	var uploadedFilenames []string

	// Upload files
	for _, filePath := range a.selectedFiles {
		url, err := uploadFileToCatbox(filePath)
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", filepath.Base(filePath), err))
		} else {
			results = append(results, url)
			uploadedFilenames = append(uploadedFilenames, extractCatboxFilename(url))
		}
	}

	// Upload URLs
	if urls != "" {
		for _, u := range strings.Split(urls, ",") {
			u = strings.TrimSpace(u)
			if u == "" {
				continue
			}
			url, err := uploadURLToCatbox(u)
			if err != nil {
				errors = append(errors, fmt.Sprintf("URL %s: %v", u, err))
			} else {
				results = append(results, url)
				uploadedFilenames = append(uploadedFilenames, extractCatboxFilename(url))
			}
		}
	}

	// Create album if requested and we have files
	if createAlbum && len(uploadedFilenames) > 0 {
		albumURL, err := createCatboxAlbum(uploadedFilenames, title, desc)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Album creation: %v", err))
		} else {
			albumResult = fmt.Sprintf("Album: %s", albumURL)
		}
	}

	return results, albumResult, errors
}

func (a *App) uploadSxcu(title, desc string, createCollection bool, updateOutput func(string)) ([]string, string, []string) {
	var results []string
	var collectionResult string
	var errors []string
	var collectionID string
	var rateLimitStatus string

	totalFiles := len(a.selectedFiles)

	buildOutput := func() string {
		var output strings.Builder
		successCount := len(results)
		failCount := len(errors)
		if failCount > 0 {
			output.WriteString(fmt.Sprintf("Uploading... %d/%d (%d failed)\r\n\r\n", successCount, totalFiles, failCount))
		} else {
			output.WriteString(fmt.Sprintf("Uploading... %d/%d\r\n\r\n", successCount, totalFiles))
		}
		if rateLimitStatus != "" {
			output.WriteString(rateLimitStatus + "\r\n")
		}
		if collectionResult != "" {
			output.WriteString(collectionResult + "\r\n")
		}
		for _, r := range results {
			output.WriteString(r + "\r\n")
		}
		for _, e := range errors {
			output.WriteString("Error: " + e + "\r\n")
		}
		return output.String()
	}

	waitWithCountdown := func(waitMs int64, bucket string) {
		friendlyBucket := bucket
		switch bucket {
		case "__sxcu_file_upload__":
			friendlyBucket = "file upload"
		case "__sxcu_collection__":
			friendlyBucket = "collection"
		case "__sxcu_global__":
			friendlyBucket = "global"
		}
		endTime := timeNow().Add(time.Duration(waitMs) * time.Millisecond)
		for {
			remaining := endTime.Sub(timeNow())
			if remaining <= 0 {
				break
			}
			secs := int(remaining.Seconds())
			if secs >= 60 {
				rateLimitStatus = fmt.Sprintf("⏳ Rate limited (%s): %dm %ds remaining...", friendlyBucket, secs/60, secs%60)
			} else {
				rateLimitStatus = fmt.Sprintf("⏳ Rate limited (%s): %ds remaining...", friendlyBucket, secs)
			}
			updateOutput(buildOutput())
			sleepDuration := 500 * time.Millisecond
			if remaining < sleepDuration {
				sleepDuration = remaining
			}
			timeSleep(sleepDuration)
		}
		rateLimitStatus = ""
	}

	// Create collection first if requested
	if createCollection && len(a.selectedFiles) > 0 {
		collTitle := title
		if collTitle == "" {
			collTitle = "Untitled"
		}
		coll, err := createSxcuCollection(collTitle, desc, 5)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Collection creation: %v", err))
		} else {
			collectionID = coll.CollectionID
			collectionResult = fmt.Sprintf("Collection: %s", coll.GetURL())
		}
		updateOutput(buildOutput())
	}

	// Upload files
	for _, filePath := range a.selectedFiles {
		for {
			check := checkSxcuRateLimit(sxcuFileUploadBucket)
			if check.Allowed {
				break
			}
			waitWithCountdown(check.WaitMs, check.Bucket)
		}
		resp, err := uploadFileToSxcuWithRateLimitInfo(filePath, collectionID, 5, func(waitMs int64, bucket string) {
			waitWithCountdown(waitMs, bucket)
		})
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", filepath.Base(filePath), err))
		} else {
			results = append(results, resp.URL)
		}
		updateOutput(buildOutput())
	}

	return results, collectionResult, errors
}

func (a *App) uploadImgchest(title string, anonymous bool, postID string) ([]string, string, []string) {
	var results []string
	var postResult string
	var errors []string

	if len(a.selectedFiles) == 0 {
		return results, postResult, errors
	}

	// Adding to existing post
	if postID != "" {
		resp, err := addToImgchestPost(postID, a.selectedFiles, 3)
		if err != nil {
			errors = append(errors, err.Error())
		} else {
			postResult = fmt.Sprintf("Post: %s", resp.GetPostURL())
			for _, img := range resp.Data.Images {
				results = append(results, img.Link)
			}
		}
		return results, postResult, errors
	}

	// Create new post with all images
	resp, err := uploadToImgchest(a.selectedFiles, title, anonymous, 3)
	if err != nil {
		errors = append(errors, err.Error())
	} else {
		postResult = fmt.Sprintf("Post: %s", resp.GetPostURL())
		for _, img := range resp.Data.Images {
			results = append(results, img.Link)
		}
	}

	return results, postResult, errors
}
