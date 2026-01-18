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
	descEdit          *walk.LineEdit
	descComposite     *walk.Composite
	providerCombo   *walk.ComboBox
	albumCheck      *walk.CheckBox
	collectionCheck *walk.CheckBox
	anonymousCheck  *walk.CheckBox
	privacyCombo    *walk.ComboBox
	nsfwCheck       *walk.CheckBox
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

type FileItem struct {
	Path string
	Base string
}

type FileListModel struct {
	walk.ListModelBase
	items []FileItem
}

func (m *FileListModel) ItemCount() int {
	return len(m.items)
}

func (m *FileListModel) Value(index int) interface{} {
	if index >= 0 && index < len(m.items) {
		return m.items[index].Base
	}
	return ""
}

func NewApp() *App {
	return &App{
		fileListModel: &FileListModel{items: make([]FileItem, 0, 32)},
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
						Text:        "＋",
						ToolTipText: "Add Files",
						OnClicked:   a.onSelectFiles,
						MinSize:     Size{Width: 32},
						MaxSize:     Size{Width: 32},
					},
					PushButton{
						Text:        "－",
						ToolTipText: "Remove Selected",
						OnClicked:   a.onRemoveSelected,
						MinSize:     Size{Width: 32},
						MaxSize:     Size{Width: 32},
					},
					PushButton{
						Text:        "✕",
						ToolTipText: "Clear All",
						OnClicked:   a.onClearAll,
						MinSize:     Size{Width: 32},
						MaxSize:     Size{Width: 32},
					},
				},
			},

			ListBox{
				AssignTo:       &a.fileListBox,
				Model:          a.fileListModel,
				MinSize:        Size{Height: 90},
				MultiSelection: true,
				OnKeyDown:      a.onFileListKeyDown,
			},

			Composite{
				AssignTo: &a.urlComposite,
				Layout:   HBox{MarginsZero: true, Spacing: 6},
				Children: []Widget{
					Label{Text: "URLs:", MinSize: Size{Width: 70}, MaxSize: Size{Width: 70}},
					LineEdit{
						AssignTo:    &a.urlEdit,
						ToolTipText: "Comma-separated URLs to upload",
					},
				},
			},

			Composite{
				Layout: HBox{MarginsZero: true, Spacing: 6},
				Children: []Widget{
					Label{Text: "Title:", MinSize: Size{Width: 70}, MaxSize: Size{Width: 70}},
					LineEdit{
						AssignTo: &a.titleEdit,
					},
				},
			},

			Composite{
				AssignTo: &a.descComposite,
				Layout:   HBox{MarginsZero: true, Spacing: 6},
				Children: []Widget{
					Label{Text: "Description:", MinSize: Size{Width: 70}, MaxSize: Size{Width: 70}},
					LineEdit{
						AssignTo: &a.descEdit,
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
				Layout:   VBox{MarginsZero: true, Spacing: 8},
				Visible:  false,
				Children: []Widget{
					Composite{
						Layout: HBox{MarginsZero: true, Spacing: 6},
						Children: []Widget{
							Label{Text: "Privacy:", MinSize: Size{Width: 70}, MaxSize: Size{Width: 70}},
							ComboBox{
								AssignTo:     &a.privacyCombo,
								Model:        []string{"hidden", "public", "secret"},
								CurrentIndex: 0,
								MinSize:      Size{Width: 80},
								MaxSize:      Size{Width: 80},
							},
							HSpacer{},
							CheckBox{
								AssignTo: &a.nsfwCheck,
								Text:     "NSFW",
								Checked:  true,
							},
							HSpacer{},
							CheckBox{
								AssignTo:         &a.anonymousCheck,
								Text:             "Anonymous",
								OnCheckedChanged: a.onAnonymousChanged,
							},
						},
					},
					Composite{
						Layout: HBox{MarginsZero: true, Spacing: 6},
						Children: []Widget{
							Label{Text: "Post ID:", MinSize: Size{Width: 70}, MaxSize: Size{Width: 70}},
							LineEdit{
								AssignTo:      &a.postIDEdit,
								ToolTipText:   "Add to existing post (leave empty for new)",
								OnTextChanged: a.onPostIDChanged,
							},
						},
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

	if IsSystemDarkMode() {
		SetDarkModeTitleBar(uintptr(a.mainWindow.Handle()), true)
		ApplyDarkTheme(a)
	}

	a.onProviderChanged()

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

	a.descComposite.SetVisible(!isImgchest)
	if isImgchest {
		a.descEdit.SetText("")
	}

	if a.mainWindow != nil {
		a.mainWindow.Invalidate()
	}
}

func (a *App) onAnonymousChanged() {
	if a.providerCombo.Text() == "imgchest" {
		anonymous := a.anonymousCheck.Checked()
		a.postIDEdit.SetEnabled(!anonymous)
		a.privacyCombo.SetEnabled(!anonymous)
		if anonymous {
			a.postIDEdit.SetText("")
			a.privacyCombo.SetCurrentIndex(0)
		}
		a.updateNsfwCheckState()
	}
}

func (a *App) onPostIDChanged() {
	a.updateNsfwCheckState()
}

func (a *App) updateNsfwCheckState() {
	if a.providerCombo.Text() != "imgchest" {
		return
	}
	isNonAnonymous := !a.anonymousCheck.Checked()
	hasPostID := strings.TrimSpace(a.postIDEdit.Text()) != ""
	shouldDisable := isNonAnonymous && hasPostID
	a.nsfwCheck.SetEnabled(!shouldDisable)
	if shouldDisable {
		a.nsfwCheck.SetToolTipText("NSFW is set on the post and cannot be changed when adding images")
	} else {
		a.nsfwCheck.SetToolTipText("")
	}
}

func (a *App) onSelectFiles() {
	if a.uploadCompleted {
		a.selectedFiles = a.selectedFiles[:0]
		a.fileListModel.items = a.fileListModel.items[:0]
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
		a.fileListModel.items = append(a.fileListModel.items, FileItem{Path: path, Base: filepath.Base(path)})
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

	removeSet := make(map[int]struct{}, len(indices))
	for _, idx := range indices {
		removeSet[idx] = struct{}{}
	}

	newFiles := make([]string, 0, len(a.selectedFiles))
	newItems := make([]FileItem, 0, len(a.fileListModel.items))
	for i, f := range a.selectedFiles {
		if _, remove := removeSet[i]; !remove {
			newFiles = append(newFiles, f)
			newItems = append(newItems, a.fileListModel.items[i])
		}
	}

	a.selectedFiles = newFiles
	a.fileListModel.items = newItems
	a.fileListModel.PublishItemsReset()
}

func (a *App) onClearAll() {
	if len(a.selectedFiles) == 0 {
		return
	}
	a.selectedFiles = a.selectedFiles[:0]
	a.fileListModel.items = a.fileListModel.items[:0]
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
			postID := a.postIDEdit.Text()
			opts := ImgchestUploadOptions{
				Title:     title,
				Privacy:   a.privacyCombo.Text(),
				NSFW:      a.nsfwCheck.Checked(),
				Anonymous: a.anonymousCheck.Checked(),
			}
			results, groupResult, errors, successCount = a.uploadImgchest(opts, postID, updateOutput)
		}

		a.mainWindow.Synchronize(func() {
			var output strings.Builder
			output.Grow(2048)

			if len(errors) > 0 {
				output.WriteString(fmt.Sprintf("Done: %d success, %d failed\r\n\r\n", successCount, len(errors)))
			} else {
				output.WriteString(fmt.Sprintf("Done: %d uploaded\r\n\r\n", successCount))
			}

			if groupResult != "" {
				output.WriteString(groupResult)
				output.WriteString("\r\n")
			}

			for _, r := range results {
				output.WriteString(r)
				output.WriteString("\r\n")
			}

			if len(errors) > 0 {
				output.WriteString("\r\nErrors:\r\n")
				for _, e := range errors {
					output.WriteString("• ")
					output.WriteString(e)
					output.WriteString("\r\n")
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
	totalFiles := len(a.selectedFiles)
	results := make([]string, 0, totalFiles)
	errors := make([]string, 0, 4)
	uploadedFilenames := make([]string, 0, totalFiles)
	var albumResult string

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
			albumResult = "Album: " + albumURL
		}
	}

	return results, albumResult, errors
}

func (a *App) uploadSxcu(title, desc string, createCollection bool, updateOutput func(string)) ([]string, string, []string) {
	totalFiles := len(a.selectedFiles)
	results := make([]string, 0, totalFiles)
	errors := make([]string, 0, 4)
	var collectionResult string
	var collectionID string
	var rateLimitStatus string

	buildOutput := func() string {
		var output strings.Builder
		output.Grow(2048)
		successCount := len(results)
		failCount := len(errors)
		if failCount > 0 {
			output.WriteString(fmt.Sprintf("Uploading... %d/%d (%d failed)\r\n\r\n", successCount, totalFiles, failCount))
		} else {
			output.WriteString(fmt.Sprintf("Uploading... %d/%d\r\n\r\n", successCount, totalFiles))
		}
		if rateLimitStatus != "" {
			output.WriteString(rateLimitStatus)
			output.WriteString("\r\n")
		}
		if collectionResult != "" {
			output.WriteString(collectionResult)
			output.WriteString("\r\n")
		}
		for _, r := range results {
			output.WriteString(r)
			output.WriteString("\r\n")
		}
		for _, e := range errors {
			output.WriteString("Error: ")
			output.WriteString(e)
			output.WriteString("\r\n")
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
			collectionResult = "Collection: " + coll.GetURL()
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

func (a *App) uploadImgchest(opts ImgchestUploadOptions, postID string, updateOutput func(string)) ([]string, string, []string, int) {
	if len(a.selectedFiles) == 0 {
		return nil, "", nil, 0
	}

	validFiles := make([]string, 0, len(a.selectedFiles))
	errors := make([]string, 0, 4)

	for _, filePath := range a.selectedFiles {
		if err := ValidateImgchestFile(filePath); err != nil {
			errors = append(errors, fmt.Sprintf("%s: %v", filepath.Base(filePath), err))
		} else {
			validFiles = append(validFiles, filePath)
		}
	}

	if len(validFiles) == 0 {
		return nil, "", errors, 0
	}

	totalFiles := len(validFiles)
	results := make([]string, 0, totalFiles)
	var postResult string
	allImageIDs := make([]string, 0, totalFiles)

	uploadedCount := 0
	useUploadedCount := false

	buildOutput := func() string {
		var output strings.Builder
		output.Grow(2048)
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
			output.WriteString(postResult)
			output.WriteString("\r\n")
		}
		for _, r := range results {
			output.WriteString(r)
			output.WriteString("\r\n")
		}
		for _, e := range errors {
			output.WriteString("Error: ")
			output.WriteString(e)
			output.WriteString("\r\n")
		}
		return output.String()
	}

	if postID != "" {
		const batchSize = 20
		totalBatches := (len(validFiles) + batchSize - 1) / batchSize
		seenLinks := make(map[string]struct{}, totalFiles)
		useUploadedCount = true

		for batchNum := 1; batchNum <= totalBatches; batchNum++ {
			start := (batchNum - 1) * batchSize
			end := start + batchSize
			if end > len(validFiles) {
				end = len(validFiles)
			}
			batch := validFiles[start:end]

			resp, err := addToImgchestPost(postID, batch, 3)
			if err != nil {
				errors = append(errors, fmt.Sprintf("Batch %d: %s", batchNum, err.Error()))
			} else {
				if postResult == "" {
					postResult = "Post: " + resp.GetPostURL()
				}
				uploadedCount += len(batch)
				for _, img := range resp.Data.Images {
					if _, seen := seenLinks[img.Link]; !seen {
						seenLinks[img.Link] = struct{}{}
						results = append(results, img.Link)
						allImageIDs = append(allImageIDs, img.ID)
					}
				}
			}
			updateOutput(buildOutput())
		}

		if err := updateImgchestPost(postID, opts, 3); err != nil {
			errors = append(errors, fmt.Sprintf("Failed to update post settings: %v", err))
			updateOutput(buildOutput())
		}

		return results, postResult, errors, uploadedCount
	}

	seenLinks := make(map[string]struct{}, totalFiles)
	callback := func(batchNum int, totalBatches int, postURL string, imageLinks []string, imageIDs []string, err error) {
		if err != nil {
			errors = append(errors, fmt.Sprintf("Batch %d: %s", batchNum, err.Error()))
		} else {
			if postResult == "" && postURL != "" {
				postResult = "Post: " + postURL
			}
			for i, link := range imageLinks {
				if _, seen := seenLinks[link]; !seen {
					seenLinks[link] = struct{}{}
					results = append(results, link)
					if i < len(imageIDs) {
						allImageIDs = append(allImageIDs, imageIDs[i])
					}
				}
			}
		}
		updateOutput(buildOutput())
	}

	uploadToImgchestWithCallback(validFiles, opts, 3, callback)

	return results, postResult, errors, len(results)
}
