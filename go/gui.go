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
	mainWindow      *walk.MainWindow
	fileListBox     *walk.ListBox
	fileListModel   *FileListModel
	urlEdit         *walk.LineEdit
	titleEdit       *walk.LineEdit
	descEdit        *walk.LineEdit
	providerCombo   *walk.ComboBox
	albumCheck      *walk.CheckBox
	collectionCheck *walk.CheckBox
	anonymousCheck  *walk.CheckBox
	postIDEdit      *walk.LineEdit
	outputEdit      *walk.TextEdit
	uploadButton    *walk.PushButton
	selectedFiles   []string
	uploadCompleted bool

	urlComposite          *walk.Composite
	catboxOptsComposite   *walk.Composite
	sxcuOptsComposite     *walk.Composite
	imgchestOptsComposite *walk.Composite
}

type FileListModel struct {
	walk.ListModelBase
	items []string
}

func (m *FileListModel) ItemCount() int {
	return len(m.items)
}

func (m *FileListModel) Value(index int) interface{} {
	if index >= 0 && index < len(m.items) {
		return filepath.Base(m.items[index])
	}
	return ""
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
		MinSize:  Size{Width: 360, Height: 480},
		Size:     Size{Width: 380, Height: 520},
		Layout:   VBox{Margins: Margins{Left: 12, Top: 12, Right: 12, Bottom: 12}, Spacing: 8},
		Children: []Widget{
			Composite{
				Layout: HBox{MarginsZero: true, Spacing: 8},
				Children: []Widget{
					Composite{
						Layout:  HBox{MarginsZero: true, Spacing: 6},
						MaxSize: Size{Width: 160},
						Children: []Widget{
							Label{Text: "Provider:", MinSize: Size{Width: 55}},
							ComboBox{
								AssignTo:              &a.providerCombo,
								Model:                 providers,
								CurrentIndex:          2,
								OnCurrentIndexChanged: a.onProviderChanged,
								MinSize:               Size{Width: 90},
							},
						},
					},
					HSpacer{},
					PushButton{
						Text:      "＋ Add Files",
						OnClicked: a.onSelectFiles,
						MinSize:   Size{Width: 90},
					},
					PushButton{
						Text:      "✕ Remove",
						OnClicked: a.onRemoveSelected,
						MinSize:   Size{Width: 80},
					},
				},
			},

			ListBox{
				AssignTo:       &a.fileListBox,
				Model:          a.fileListModel,
				MinSize:        Size{Height: 90},
				MultiSelection: true,
				OnKeyDown:      a.onFileListKeyDown,
				ToolTipText:    "Selected files (shows filename only, full path on hover)",
			},

			Composite{
				AssignTo: &a.urlComposite,
				Layout:   HBox{MarginsZero: true, Spacing: 6},
				Children: []Widget{
					Label{Text: "URLs:", MinSize: Size{Width: 55}},
					LineEdit{
						AssignTo:    &a.urlEdit,
						ToolTipText: "Comma-separated URLs to upload",
					},
				},
			},

			Composite{
				Layout: Grid{Columns: 4, MarginsZero: true, Spacing: 6},
				Children: []Widget{
					Label{Text: "Title:", MinSize: Size{Width: 55}},
					LineEdit{
						AssignTo:   &a.titleEdit,
						ColumnSpan: 3,
					},
					Label{Text: "Description:", MinSize: Size{Width: 55}},
					LineEdit{
						AssignTo:   &a.descEdit,
						ColumnSpan: 3,
					},
				},
			},

			Composite{
				AssignTo: &a.catboxOptsComposite,
				Layout:   HBox{MarginsZero: true},
				Children: []Widget{
					CheckBox{
						AssignTo: &a.albumCheck,
						Text:     "Create Album",
						Checked:  true,
					},
				},
			},

			Composite{
				AssignTo: &a.sxcuOptsComposite,
				Layout:   HBox{MarginsZero: true},
				Visible:  false,
				Children: []Widget{
					CheckBox{
						AssignTo: &a.collectionCheck,
						Text:     "Create Collection",
						Checked:  true,
					},
				},
			},

			Composite{
				AssignTo: &a.imgchestOptsComposite,
				Layout:   HBox{MarginsZero: true, Spacing: 12},
				Visible:  false,
				Children: []Widget{
					CheckBox{
						AssignTo:         &a.anonymousCheck,
						Text:             "Anonymous",
						OnCheckedChanged: a.onAnonymousChanged,
					},
					Label{Text: "Post ID:"},
					LineEdit{
						AssignTo:    &a.postIDEdit,
						ToolTipText: "Add to existing post (leave empty for new)",
						MinSize:     Size{Width: 120},
					},
				},
			},

			PushButton{
				AssignTo:  &a.uploadButton,
				Text:      "⬆ Upload",
				OnClicked: a.onUpload,
				MinSize:   Size{Height: 32},
			},

			TextEdit{
				AssignTo: &a.outputEdit,
				ReadOnly: true,
				VScroll:  true,
				MinSize:  Size{Height: 100},
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

	isCatbox := provider == "catbox"
	isSxcu := provider == "sxcu"
	isImgchest := provider == "imgchest"

	a.urlComposite.SetVisible(isCatbox)
	if !isCatbox {
		a.urlEdit.SetText("")
	}

	a.catboxOptsComposite.SetVisible(isCatbox)
	a.albumCheck.SetEnabled(isCatbox)
	if isCatbox {
		a.albumCheck.SetChecked(true)
	} else {
		a.albumCheck.SetChecked(false)
	}

	a.sxcuOptsComposite.SetVisible(isSxcu)
	a.collectionCheck.SetEnabled(isSxcu)
	if isSxcu {
		a.collectionCheck.SetChecked(true)
	} else {
		a.collectionCheck.SetChecked(false)
	}

	a.imgchestOptsComposite.SetVisible(isImgchest)
	a.anonymousCheck.SetEnabled(isImgchest)
	if !isImgchest {
		a.anonymousCheck.SetChecked(false)
		a.postIDEdit.SetText("")
	}
	a.postIDEdit.SetEnabled(isImgchest && !a.anonymousCheck.Checked())
}

func (a *App) onAnonymousChanged() {
	if a.providerCombo.Text() == "imgchest" {
		a.postIDEdit.SetEnabled(!a.anonymousCheck.Checked())
		if a.anonymousCheck.Checked() {
			a.postIDEdit.SetText("")
		}
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

	removeSet := make(map[int]bool)
	for _, idx := range indices {
		removeSet[idx] = true
	}

	var newFiles []string
	var newItems []string
	for i, f := range a.selectedFiles {
		if !removeSet[i] {
			newFiles = append(newFiles, f)
			newItems = append(newItems, a.fileListModel.items[i])
		}
	}

	a.selectedFiles = newFiles
	a.fileListModel.items = newItems
	a.fileListModel.PublishItemsReset()
}

func (a *App) onUpload() {
	if len(a.selectedFiles) == 0 && a.urlEdit.Text() == "" {
		showError("Please select files or enter URLs to upload")
		return
	}

	acquired, err := TryAcquireUploadLock()
	if err != nil {
		showError(fmt.Sprintf("Failed to acquire upload lock: %v", err))
		return
	}

	a.uploadButton.SetEnabled(false)

	if !acquired {
		a.outputEdit.SetText("Waiting for another upload to complete...\r\n")
		go func() {
			err := AcquireUploadLock()
			if err != nil {
				a.mainWindow.Synchronize(func() {
					a.outputEdit.SetText(fmt.Sprintf("Failed to acquire lock: %v", err))
					a.uploadButton.SetEnabled(true)
				})
				return
			}
			a.mainWindow.Synchronize(func() {
				a.startUpload()
			})
		}()
		return
	}

	a.startUpload()
}

func (a *App) startUpload() {
	a.outputEdit.SetText("Starting upload...\r\n")

	go func() {
		defer ReleaseUploadLock()

		provider := a.providerCombo.Text()
		title := a.titleEdit.Text()
		desc := a.descEdit.Text()

		var results []string
		var groupResult string
		var errors []string
		var successCount int

		updateOutput := func(text string) {
			a.mainWindow.Synchronize(func() {
				a.outputEdit.SetText(text)
			})
		}

		switch provider {
		case "catbox":
			urls := a.urlEdit.Text()
			createAlbum := a.albumCheck.Checked()
			results, groupResult, errors = a.uploadCatbox(urls, title, desc, createAlbum)
			successCount = len(results)

		case "sxcu":
			createCollection := a.collectionCheck.Checked()
			results, groupResult, errors = a.uploadSxcu(title, desc, createCollection, updateOutput)
			successCount = len(results)

		case "imgchest":
			anonymous := a.anonymousCheck.Checked()
			postID := a.postIDEdit.Text()
			results, groupResult, errors, successCount = a.uploadImgchest(title, anonymous, postID, updateOutput)
		}

		a.mainWindow.Synchronize(func() {
			var output strings.Builder

			if len(errors) > 0 {
				output.WriteString(fmt.Sprintf("Done: %d success, %d failed\r\n\r\n", successCount, len(errors)))
			} else {
				output.WriteString(fmt.Sprintf("Done: %d uploaded\r\n\r\n", successCount))
			}

			if groupResult != "" {
				output.WriteString(groupResult + "\r\n")
			}

			for _, r := range results {
				output.WriteString(r + "\r\n")
			}

			if len(errors) > 0 {
				output.WriteString("\r\nErrors:\r\n")
				for _, e := range errors {
					output.WriteString("• " + e + "\r\n")
				}
			}

			a.outputEdit.SetText(output.String())
			a.uploadButton.SetEnabled(true)

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

	for _, filePath := range a.selectedFiles {
		url, err := uploadFileToCatbox(filePath)
		if err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", filepath.Base(filePath), err))
		} else {
			results = append(results, url)
			uploadedFilenames = append(uploadedFilenames, extractCatboxFilename(url))
		}
	}

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

func (a *App) uploadImgchest(title string, anonymous bool, postID string, updateOutput func(string)) ([]string, string, []string, int) {
	var results []string
	var postResult string
	var errors []string

	if len(a.selectedFiles) == 0 {
		return results, postResult, errors, 0
	}

	totalFiles := len(a.selectedFiles)

	uploadedCount := 0
	useUploadedCount := false

	buildOutput := func() string {
		var output strings.Builder
		var successCount int
		if useUploadedCount {
			successCount = uploadedCount
		} else {
			successCount = len(results)
		}
		failCount := len(errors)
		if failCount > 0 {
			output.WriteString(fmt.Sprintf("Uploading... %d/%d (%d failed)\r\n\r\n", successCount, totalFiles, failCount))
		} else {
			output.WriteString(fmt.Sprintf("Uploading... %d/%d\r\n\r\n", successCount, totalFiles))
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
		return output.String()
	}

	if postID != "" {
		const batchSize = 20
		totalBatches := (len(a.selectedFiles) + batchSize - 1) / batchSize
		seenLinks := make(map[string]bool)
		useUploadedCount = true

		for batchNum := 1; batchNum <= totalBatches; batchNum++ {
			start := (batchNum - 1) * batchSize
			end := start + batchSize
			if end > len(a.selectedFiles) {
				end = len(a.selectedFiles)
			}
			batch := a.selectedFiles[start:end]

			resp, err := addToImgchestPost(postID, batch, 3)
			if err != nil {
				errors = append(errors, fmt.Sprintf("Batch %d: %s", batchNum, err.Error()))
			} else {
				if postResult == "" {
					postResult = fmt.Sprintf("Post: %s", resp.GetPostURL())
				}
				uploadedCount += len(batch)
				for _, img := range resp.Data.Images {
					if !seenLinks[img.Link] {
						seenLinks[img.Link] = true
						results = append(results, img.Link)
					}
				}
			}
			updateOutput(buildOutput())
		}
		return results, postResult, errors, uploadedCount
	}

	seenLinks := make(map[string]bool)
	callback := func(batchNum int, totalBatches int, postURL string, imageLinks []string, err error) {
		if err != nil {
			errors = append(errors, fmt.Sprintf("Batch %d: %s", batchNum, err.Error()))
		} else {
			if postResult == "" && postURL != "" {
				postResult = fmt.Sprintf("Post: %s", postURL)
			}
			for _, link := range imageLinks {
				if !seenLinks[link] {
					seenLinks[link] = true
					results = append(results, link)
				}
			}
		}
		updateOutput(buildOutput())
	}

	uploadToImgchestWithCallback(a.selectedFiles, title, anonymous, 3, callback)

	return results, postResult, errors, len(results)
}
