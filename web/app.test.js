import { test, expect, describe, beforeEach, afterEach } from "bun:test";

// Create mock DOM environment for testing
function createMockElement(id, options = {}) {
    const listeners = {};
    const classList = new Set(options.classList || []);
    const children = [];
    let attrStore = {};
    
    const element = {
        id,
        value: options.value || '',
        checked: options.checked || false,
        disabled: false,
        innerHTML: '',
        textContent: '',
        style: { display: '', width: '', marginTop: '' },
        classList: {
            add: (cls) => classList.add(cls),
            remove: (cls) => classList.delete(cls),
            toggle: (cls, force) => {
                if (force === undefined) {
                    if (classList.has(cls)) classList.delete(cls);
                    else classList.add(cls);
                } else if (force) {
                    classList.add(cls);
                } else {
                    classList.delete(cls);
                }
            },
            contains: (cls) => classList.has(cls),
        },
        addEventListener: (event, handler) => {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(handler);
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        appendChild: (child) => { children.push(child); return child; },
        insertBefore: (newNode, refNode) => { children.unshift(newNode); return newNode; },
        remove: () => {},
        setAttribute: (attr, val) => { attrStore[attr] = val; },
        getAttribute: (attr) => attrStore[attr] || null,
        scrollIntoView: () => {},
        parentNode: null,
        nextSibling: null,
        get children() { return children; },
        _listeners: listeners,
        _classList: classList,
    };
    
    return element;
}

// Inline CatboxUploader class for testing (extracted methods without DOM initialization)
class CatboxUploaderTestable {
    constructor(mockElements, mockLocalStorage) {
        this.files = [];
        this.provider = mockLocalStorage.getItem('catbox_provider') || 'imgchest';
        this.uploadCompleted = false;
        this.apiBaseUrl = 'http://localhost:3000';
        
        // Assign mock elements
        this.form = mockElements.uploadForm;
        this.providerSelect = mockElements.provider;
        this.filesInput = mockElements.files;
        this.dropZone = mockElements.dropZone;
        this.fileList = mockElements.fileList;
        this.urlGroup = mockElements.urlGroup;
        this.createCollectionGroup = mockElements.createCollectionGroup;
        this.sxcuOptions = mockElements.sxcuOptions;
        this.anonymousGroup = mockElements.anonymousGroup;
        this.postIdGroup = mockElements.postIdGroup;
        this.uploadBtn = mockElements.uploadBtn;
        this.resultsDiv = mockElements.results;
        this.resultsContent = mockElements.resultsContent;
        this.progressDiv = mockElements.progress;
        this.progressFill = mockElements.progressFill;
        this.progressText = mockElements.progressText;
        this.urlsInput = mockElements.urls;
        this.titleInput = mockElements.title;
        this.postIdInput = mockElements.postId;
        
        this._mockElements = mockElements;
        this._mockLocalStorage = mockLocalStorage;
    }

    updateUI() {
        const isSxcu = this.provider === 'sxcu';
        const isImgchest = this.provider === 'imgchest';

        this.urlGroup.classList.toggle('hidden', isSxcu || isImgchest);
        this.createCollectionGroup.classList.toggle('hidden', !isSxcu);
        
        if (this.sxcuOptions) {
            const createCollectionChecked = this._mockElements.createCollection?.checked || false;
            this.sxcuOptions.classList.toggle('hidden', !isSxcu || !createCollectionChecked);
        }

        this.anonymousGroup.classList.toggle('hidden', !isImgchest);
        this.postIdGroup.classList.toggle('hidden', !isImgchest);
    }

    addFiles(fileList) {
        const allowedExtensions = ['.png', '.gif', '.jpeg', '.jpg', '.ico', '.bmp', '.tiff', '.tif', '.webm', '.webp'];

        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const ext = '.' + file.name.split('.').pop().toLowerCase();
            if (allowedExtensions.indexOf(ext) !== -1) {
                let exists = false;
                for (let j = 0; j < this.files.length; j++) {
                    if (this.files[j].name === file.name && this.files[j].size === file.size) {
                        exists = true;
                        break;
                    }
                }
                if (!exists) {
                    this.files.push(file);
                }
            }
        }

        this.renderFileList();

        if (this.files.length > 0 && !this.titleInput.value) {
            const firstFile = this.files[0];
            const path = firstFile.webkitRelativePath || firstFile.mozRelativePath || firstFile.name;
            const lastSlash = path.lastIndexOf('/');
            if (lastSlash > 0) {
                const folderName = path.substring(0, lastSlash).split('/').pop();
                this.titleInput.value = folderName;
            } else {
                this.titleInput.value = firstFile.name.replace(/\.[^/.]+$/, '');
            }
        }
    }

    removeFile(index) {
        this.files.splice(index, 1);
        this.renderFileList();
    }

    renderFileList() {
        this.fileList.innerHTML = '';
        this.fileList.children.length = 0;
        for (let i = 0; i < this.files.length; i++) {
            const file = this.files[i];
            const item = createMockElement('file-item-' + i);
            item.className = 'file-item';
            item.innerHTML = '<span class="file-name">' + file.name + ' (' + this.formatSize(file.size) + ')</span>';
            this.fileList.appendChild(item);
        }
    }

    formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    handleSubmit(e) {
        e.preventDefault();

        if (this.files.length === 0 && !this.urlsInput.value.trim()) {
            this.showError('Please select at least one file or enter URLs');
            return;
        }

        this.setLoading(true);
        this.resultsDiv.style.display = 'block';
        this.resultsContent.innerHTML = '<div class="summary warning">Uploading...</div>';
        this.progressDiv.style.display = 'block';
        this.progressFill.style.width = '0%';

        const urls = this.urlsInput.value.trim() ? this.urlsInput.value.split(',').map(u => u.trim()) : [];

        try {
            switch (this.provider) {
                case 'catbox':
                    if (this.uploadToCatbox) this.uploadToCatbox([], urls);
                    break;
                case 'sxcu':
                    if (this.uploadToSxcu) this.uploadToSxcu([]);
                    break;
                case 'imgchest':
                    if (this.uploadToImgchest) this.uploadToImgchest([]);
                    break;
            }
        } catch (error) {
            this.showError(error.message);
        } finally {
            this.setLoading(false);
            this.progressDiv.style.display = 'none';
        }
    }

    updateProgress(percent, text) {
        this.progressFill.style.width = percent + '%';
        this.progressText.textContent = text;
    }

    addIncrementalResult(result, index) {
        const item = createMockElement('result-' + index);
        item.className = 'result-item ' + result.type;
        
        if (result.isAlbum || result.isCollection || result.isPost) {
            item.className += ' highlight';
        }

        item.setAttribute('data-result-index', index);

        if (result.type === 'success') {
            if (result.isAlbum) {
                item.innerHTML = 'Album URL: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
            } else if (result.isCollection) {
                item.innerHTML = 'Collection: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
            } else if (result.isPost) {
                item.innerHTML = 'Post URL: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
            } else {
                item.innerHTML = '<a href="' + result.url + '" target="_blank">' + result.url + '</a>';
            }
        } else {
            item.textContent = result.message;
        }

        this.resultsContent.appendChild(item);
    }

    setLoading(loading) {
        this.uploadBtn.disabled = loading;
        const btnText = this.uploadBtn._btnText || { style: {} };
        const btnLoading = this.uploadBtn._btnLoading || { style: {} };
        btnText.style.display = loading ? 'none' : 'inline';
        btnLoading.style.display = loading ? 'inline' : 'none';
    }

    displayResults(results, totalFiles) {
        this.resultsDiv.style.display = 'block';

        const imageUploads = results.filter(r => 
            r.type === 'success' && !r.isPost && !r.isAlbum && !r.isCollection
        ).length;

        if (imageUploads > 0) {
            this.uploadCompleted = true;
        }
    }

    showError(message) {
        this.resultsDiv.style.display = 'block';
        this.resultsContent.innerHTML = '<div class="result-item error">' + message + '</div>';
    }
}

describe('CatboxUploader', () => {
    let mockElements;
    let mockLocalStorage;
    let uploader;

    function setupMocks() {
        mockLocalStorage = {
            data: {},
            getItem(key) { return this.data[key] || null; },
            setItem(key, val) { this.data[key] = val; },
            clear() { this.data = {}; }
        };

        mockElements = {
            uploadForm: createMockElement('uploadForm'),
            provider: createMockElement('provider', { value: 'imgchest' }),
            files: createMockElement('files'),
            dropZone: createMockElement('dropZone'),
            fileList: createMockElement('fileList'),
            urlGroup: createMockElement('urlGroup'),
            createCollectionGroup: createMockElement('createCollectionGroup'),
            sxcuOptions: createMockElement('sxcuOptions'),
            anonymousGroup: createMockElement('anonymousGroup'),
            postIdGroup: createMockElement('postIdGroup'),
            uploadBtn: createMockElement('uploadBtn'),
            results: createMockElement('results'),
            resultsContent: createMockElement('resultsContent'),
            progress: createMockElement('progress'),
            progressFill: createMockElement('progressFill'),
            progressText: createMockElement('progressText'),
            urls: createMockElement('urls'),
            title: createMockElement('title'),
            postId: createMockElement('postId'),
            anonymous: createMockElement('anonymous', { checked: false }),
            createCollection: createMockElement('createCollection', { checked: false }),
        };
        
        mockElements.uploadBtn._btnText = { style: { display: 'inline' } };
        mockElements.uploadBtn._btnLoading = { style: { display: 'none' } };
        
        mockElements.fileList.parentNode = {
            querySelector: () => null,
            insertBefore: () => {},
        };
    }

    beforeEach(() => {
        setupMocks();
        uploader = new CatboxUploaderTestable(mockElements, mockLocalStorage);
    });

    describe('Constructor', () => {
        test('initializes with default provider from localStorage', () => {
            mockLocalStorage.setItem('catbox_provider', 'catbox');
            uploader = new CatboxUploaderTestable(mockElements, mockLocalStorage);
            expect(uploader.provider).toBe('catbox');
        });

        test('initializes with imgchest if no localStorage value', () => {
            expect(uploader.provider).toBe('imgchest');
        });

        test('initializes files array as empty', () => {
            expect(uploader.files).toEqual([]);
        });

        test('initializes uploadCompleted as false', () => {
            expect(uploader.uploadCompleted).toBe(false);
        });

        test('sets apiBaseUrl', () => {
            expect(uploader.apiBaseUrl).toBe('http://localhost:3000');
        });

        test('retrieves all required DOM elements', () => {
            expect(uploader.form).toBeDefined();
            expect(uploader.providerSelect).toBeDefined();
            expect(uploader.filesInput).toBeDefined();
            expect(uploader.dropZone).toBeDefined();
            expect(uploader.fileList).toBeDefined();
            expect(uploader.urlGroup).toBeDefined();
            expect(uploader.uploadBtn).toBeDefined();
            expect(uploader.resultsDiv).toBeDefined();
            expect(uploader.progressDiv).toBeDefined();
        });
    });

    describe('updateUI()', () => {
        test('hides urlGroup for sxcu provider', () => {
            uploader.provider = 'sxcu';
            uploader.updateUI();
            expect(uploader.urlGroup._classList.has('hidden')).toBe(true);
        });

        test('hides urlGroup for imgchest provider', () => {
            uploader.provider = 'imgchest';
            uploader.updateUI();
            expect(uploader.urlGroup._classList.has('hidden')).toBe(true);
        });

        test('shows urlGroup for catbox provider', () => {
            uploader.provider = 'catbox';
            uploader.updateUI();
            expect(uploader.urlGroup._classList.has('hidden')).toBe(false);
        });

        test('shows createCollectionGroup only for sxcu', () => {
            uploader.provider = 'sxcu';
            uploader.updateUI();
            expect(uploader.createCollectionGroup._classList.has('hidden')).toBe(false);
        });

        test('hides createCollectionGroup for catbox', () => {
            uploader.provider = 'catbox';
            uploader.updateUI();
            expect(uploader.createCollectionGroup._classList.has('hidden')).toBe(true);
        });

        test('shows anonymousGroup only for imgchest', () => {
            uploader.provider = 'imgchest';
            uploader.updateUI();
            expect(uploader.anonymousGroup._classList.has('hidden')).toBe(false);
        });

        test('hides anonymousGroup for catbox', () => {
            uploader.provider = 'catbox';
            uploader.updateUI();
            expect(uploader.anonymousGroup._classList.has('hidden')).toBe(true);
        });

        test('shows postIdGroup only for imgchest', () => {
            uploader.provider = 'imgchest';
            uploader.updateUI();
            expect(uploader.postIdGroup._classList.has('hidden')).toBe(false);
        });

        test('hides postIdGroup for sxcu', () => {
            uploader.provider = 'sxcu';
            uploader.updateUI();
            expect(uploader.postIdGroup._classList.has('hidden')).toBe(true);
        });
    });

    describe('addFiles()', () => {
        test('adds valid image files', () => {
            const files = [
                { name: 'image1.png', size: 1024 },
                { name: 'image2.jpg', size: 2048 },
            ];
            uploader.addFiles(files);
            expect(uploader.files.length).toBe(2);
        });

        test('rejects invalid file extensions', () => {
            const files = [
                { name: 'document.pdf', size: 1024 },
                { name: 'script.js', size: 512 },
                { name: 'image.png', size: 2048 },
            ];
            uploader.addFiles(files);
            expect(uploader.files.length).toBe(1);
            expect(uploader.files[0].name).toBe('image.png');
        });

        test('accepts all allowed extensions', () => {
            const files = [
                { name: 'a.png', size: 100 },
                { name: 'b.gif', size: 100 },
                { name: 'c.jpeg', size: 100 },
                { name: 'd.jpg', size: 100 },
                { name: 'e.ico', size: 100 },
                { name: 'f.bmp', size: 100 },
                { name: 'g.tiff', size: 100 },
                { name: 'h.tif', size: 100 },
                { name: 'i.webm', size: 100 },
                { name: 'j.webp', size: 100 },
            ];
            uploader.addFiles(files);
            expect(uploader.files.length).toBe(10);
        });

        test('prevents duplicate files', () => {
            const files = [{ name: 'image.png', size: 1024 }];
            uploader.addFiles(files);
            uploader.addFiles(files);
            expect(uploader.files.length).toBe(1);
        });

        test('allows files with same name but different size', () => {
            uploader.addFiles([{ name: 'image.png', size: 1024 }]);
            uploader.addFiles([{ name: 'image.png', size: 2048 }]);
            expect(uploader.files.length).toBe(2);
        });

        test('sets title from first file name without extension', () => {
            const files = [{ name: 'my-image.png', size: 1024 }];
            uploader.addFiles(files);
            expect(uploader.titleInput.value).toBe('my-image');
        });

        test('sets title from folder path if available', () => {
            const files = [{ 
                name: 'image.png', 
                size: 1024,
                webkitRelativePath: 'MyFolder/SubFolder/image.png'
            }];
            uploader.addFiles(files);
            expect(uploader.titleInput.value).toBe('SubFolder');
        });

        test('handles case-insensitive extensions', () => {
            const files = [
                { name: 'image.PNG', size: 100 },
                { name: 'photo.JPG', size: 100 },
                { name: 'anim.GIF', size: 100 },
            ];
            uploader.addFiles(files);
            expect(uploader.files.length).toBe(3);
        });

        test('rejects .txt files', () => {
            uploader.addFiles([{ name: 'doc.txt', size: 100 }]);
            expect(uploader.files.length).toBe(0);
        });

        test('rejects .exe files', () => {
            uploader.addFiles([{ name: 'program.exe', size: 100 }]);
            expect(uploader.files.length).toBe(0);
        });

        test('rejects .mp4 files', () => {
            uploader.addFiles([{ name: 'video.mp4', size: 100 }]);
            expect(uploader.files.length).toBe(0);
        });

        test('rejects .svg files', () => {
            uploader.addFiles([{ name: 'image.svg', size: 100 }]);
            expect(uploader.files.length).toBe(0);
        });

        test('accepts .webm files (video supported)', () => {
            uploader.addFiles([{ name: 'video.webm', size: 100 }]);
            expect(uploader.files.length).toBe(1);
        });

        test('handles empty file list', () => {
            uploader.addFiles([]);
            expect(uploader.files.length).toBe(0);
        });

        test('handles file with no extension', () => {
            uploader.addFiles([{ name: 'noextension', size: 100 }]);
            expect(uploader.files.length).toBe(0);
        });

        test('handles file with multiple dots in name', () => {
            uploader.addFiles([{ name: 'my.image.file.png', size: 100 }]);
            expect(uploader.files.length).toBe(1);
        });
    });

    describe('removeFile()', () => {
        test('removes file at specified index', () => {
            uploader.files = [
                { name: 'a.png', size: 100 },
                { name: 'b.png', size: 200 },
                { name: 'c.png', size: 300 },
            ];
            uploader.removeFile(1);
            expect(uploader.files.length).toBe(2);
            expect(uploader.files[0].name).toBe('a.png');
            expect(uploader.files[1].name).toBe('c.png');
        });

        test('removes first file correctly', () => {
            uploader.files = [
                { name: 'a.png', size: 100 },
                { name: 'b.png', size: 200 },
            ];
            uploader.removeFile(0);
            expect(uploader.files.length).toBe(1);
            expect(uploader.files[0].name).toBe('b.png');
        });

        test('removes last file correctly', () => {
            uploader.files = [
                { name: 'a.png', size: 100 },
                { name: 'b.png', size: 200 },
            ];
            uploader.removeFile(1);
            expect(uploader.files.length).toBe(1);
            expect(uploader.files[0].name).toBe('a.png');
        });

        test('calls renderFileList after removal', () => {
            uploader.files = [{ name: 'a.png', size: 100 }];
            let renderCalled = false;
            const originalRender = uploader.renderFileList.bind(uploader);
            uploader.renderFileList = () => { renderCalled = true; originalRender(); };
            uploader.removeFile(0);
            expect(renderCalled).toBe(true);
        });
    });

    describe('renderFileList()', () => {
        test('clears fileList innerHTML', () => {
            uploader.fileList.innerHTML = 'old content';
            uploader.files = [];
            uploader.renderFileList();
            expect(uploader.fileList.innerHTML).toBe('');
        });

        test('creates file item for each file', () => {
            uploader.files = [
                { name: 'a.png', size: 1024 },
                { name: 'b.jpg', size: 2048 },
            ];
            uploader.renderFileList();
            expect(uploader.fileList.children.length).toBe(2);
        });

        test('file items contain file name and size', () => {
            uploader.files = [{ name: 'test.png', size: 1024 }];
            uploader.renderFileList();
            const item = uploader.fileList.children[0];
            expect(item.innerHTML).toContain('test.png');
            expect(item.innerHTML).toContain('1.0 KB');
        });
    });

    describe('formatSize()', () => {
        test('formats bytes correctly', () => {
            expect(uploader.formatSize(0)).toBe('0 B');
            expect(uploader.formatSize(100)).toBe('100 B');
            expect(uploader.formatSize(1023)).toBe('1023 B');
        });

        test('formats kilobytes correctly', () => {
            expect(uploader.formatSize(1024)).toBe('1.0 KB');
            expect(uploader.formatSize(1536)).toBe('1.5 KB');
            expect(uploader.formatSize(10240)).toBe('10.0 KB');
            expect(uploader.formatSize(1048575)).toBe('1024.0 KB');
        });

        test('formats megabytes correctly', () => {
            expect(uploader.formatSize(1048576)).toBe('1.0 MB');
            expect(uploader.formatSize(1572864)).toBe('1.5 MB');
            expect(uploader.formatSize(10485760)).toBe('10.0 MB');
            expect(uploader.formatSize(104857600)).toBe('100.0 MB');
        });

        test('handles edge cases at boundaries', () => {
            expect(uploader.formatSize(1024)).toBe('1.0 KB');
            expect(uploader.formatSize(1024 * 1024)).toBe('1.0 MB');
        });

        test('handles very large files', () => {
            const result = uploader.formatSize(1073741824);
            expect(result).toBe('1024.0 MB');
        });
    });

    describe('handleSubmit()', () => {
        test('prevents default form submission', () => {
            let defaultPrevented = false;
            const event = { preventDefault: () => { defaultPrevented = true; } };
            uploader.handleSubmit(event);
            expect(defaultPrevented).toBe(true);
        });

        test('shows error when no files and no URLs', () => {
            uploader.files = [];
            uploader.urlsInput.value = '';
            const event = { preventDefault: () => {} };
            uploader.handleSubmit(event);
            expect(uploader.resultsContent.innerHTML).toContain('Please select at least one file or enter URLs');
        });

        test('shows results div on submit with files', () => {
            uploader.files = [{ name: 'test.png', size: 100 }];
            const event = { preventDefault: () => {} };
            uploader.handleSubmit(event);
            expect(uploader.resultsDiv.style.display).toBe('block');
        });

        test('parses comma-separated URLs', () => {
            uploader.provider = 'catbox';
            uploader.urlsInput.value = 'http://example.com/a.png, http://example.com/b.png';
            let capturedUrls = [];
            uploader.uploadToCatbox = (results, urls) => { capturedUrls = urls; };
            const event = { preventDefault: () => {} };
            uploader.handleSubmit(event);
            expect(capturedUrls.length).toBe(2);
            expect(capturedUrls[0]).toBe('http://example.com/a.png');
            expect(capturedUrls[1]).toBe('http://example.com/b.png');
        });

        test('calls uploadToCatbox for catbox provider', () => {
            uploader.provider = 'catbox';
            uploader.files = [{ name: 'test.png', size: 100 }];
            let called = false;
            uploader.uploadToCatbox = () => { called = true; };
            const event = { preventDefault: () => {} };
            uploader.handleSubmit(event);
            expect(called).toBe(true);
        });

        test('calls uploadToSxcu for sxcu provider', () => {
            uploader.provider = 'sxcu';
            uploader.files = [{ name: 'test.png', size: 100 }];
            let called = false;
            uploader.uploadToSxcu = () => { called = true; };
            const event = { preventDefault: () => {} };
            uploader.handleSubmit(event);
            expect(called).toBe(true);
        });

        test('calls uploadToImgchest for imgchest provider', () => {
            uploader.provider = 'imgchest';
            uploader.files = [{ name: 'test.png', size: 100 }];
            let called = false;
            uploader.uploadToImgchest = () => { called = true; };
            const event = { preventDefault: () => {} };
            uploader.handleSubmit(event);
            expect(called).toBe(true);
        });
    });

    describe('updateProgress()', () => {
        test('sets progress bar width', () => {
            uploader.updateProgress(50, 'Uploading...');
            expect(uploader.progressFill.style.width).toBe('50%');
        });

        test('sets progress text', () => {
            uploader.updateProgress(75, 'Almost done...');
            expect(uploader.progressText.textContent).toBe('Almost done...');
        });

        test('handles 0% progress', () => {
            uploader.updateProgress(0, 'Starting...');
            expect(uploader.progressFill.style.width).toBe('0%');
        });

        test('handles 100% progress', () => {
            uploader.updateProgress(100, 'Done!');
            expect(uploader.progressFill.style.width).toBe('100%');
            expect(uploader.progressText.textContent).toBe('Done!');
        });
    });

    describe('addIncrementalResult()', () => {
        test('creates result item with success class', () => {
            const result = { type: 'success', url: 'http://example.com/image.png' };
            uploader.addIncrementalResult(result, 0);
            const item = uploader.resultsContent.children[0];
            expect(item.className).toContain('success');
        });

        test('creates result item with error class', () => {
            const result = { type: 'error', message: 'Upload failed' };
            uploader.addIncrementalResult(result, 0);
            const item = uploader.resultsContent.children[0];
            expect(item.className).toContain('error');
        });

        test('adds highlight class for album results', () => {
            const result = { type: 'success', url: 'http://catbox.moe/album/123', isAlbum: true };
            uploader.addIncrementalResult(result, 0);
            const item = uploader.resultsContent.children[0];
            expect(item.className).toContain('highlight');
        });

        test('adds highlight class for collection results', () => {
            const result = { type: 'success', url: 'https://sxcu.net/c/123', isCollection: true };
            uploader.addIncrementalResult(result, 0);
            const item = uploader.resultsContent.children[0];
            expect(item.className).toContain('highlight');
        });

        test('adds highlight class for post results', () => {
            const result = { type: 'success', url: 'https://imgchest.com/p/123', isPost: true };
            uploader.addIncrementalResult(result, 0);
            const item = uploader.resultsContent.children[0];
            expect(item.className).toContain('highlight');
        });

        test('formats album URL with prefix', () => {
            const result = { type: 'success', url: 'http://catbox.moe/album/123', isAlbum: true };
            uploader.addIncrementalResult(result, 0);
            const item = uploader.resultsContent.children[0];
            expect(item.innerHTML).toContain('Album URL:');
        });

        test('formats collection URL with prefix', () => {
            const result = { type: 'success', url: 'https://sxcu.net/c/123', isCollection: true };
            uploader.addIncrementalResult(result, 0);
            const item = uploader.resultsContent.children[0];
            expect(item.innerHTML).toContain('Collection:');
        });

        test('formats post URL with prefix', () => {
            const result = { type: 'success', url: 'https://imgchest.com/p/123', isPost: true };
            uploader.addIncrementalResult(result, 0);
            const item = uploader.resultsContent.children[0];
            expect(item.innerHTML).toContain('Post URL:');
        });

        test('shows error message for error results', () => {
            const result = { type: 'error', message: 'Connection failed' };
            uploader.addIncrementalResult(result, 0);
            const item = uploader.resultsContent.children[0];
            expect(item.textContent).toBe('Connection failed');
        });

        test('sets data-result-index attribute', () => {
            const result = { type: 'success', url: 'http://example.com/image.png' };
            uploader.addIncrementalResult(result, 5);
            const item = uploader.resultsContent.children[0];
            expect(item.getAttribute('data-result-index')).toBe(5);
        });
    });

    describe('setLoading()', () => {
        test('disables upload button when loading', () => {
            uploader.setLoading(true);
            expect(uploader.uploadBtn.disabled).toBe(true);
        });

        test('enables upload button when not loading', () => {
            uploader.uploadBtn.disabled = true;
            uploader.setLoading(false);
            expect(uploader.uploadBtn.disabled).toBe(false);
        });

        test('hides btn-text when loading', () => {
            uploader.setLoading(true);
            expect(uploader.uploadBtn._btnText.style.display).toBe('none');
        });

        test('shows btn-loading when loading', () => {
            uploader.setLoading(true);
            expect(uploader.uploadBtn._btnLoading.style.display).toBe('inline');
        });

        test('shows btn-text when not loading', () => {
            uploader.setLoading(false);
            expect(uploader.uploadBtn._btnText.style.display).toBe('inline');
        });

        test('hides btn-loading when not loading', () => {
            uploader.setLoading(false);
            expect(uploader.uploadBtn._btnLoading.style.display).toBe('none');
        });
    });

    describe('displayResults()', () => {
        test('shows results div', () => {
            uploader.resultsDiv.style.display = 'none';
            uploader.displayResults([], 0);
            expect(uploader.resultsDiv.style.display).toBe('block');
        });

        test('sets uploadCompleted when images uploaded', () => {
            uploader.uploadCompleted = false;
            const results = [
                { type: 'success', url: 'http://example.com/a.png' },
                { type: 'success', url: 'http://example.com/b.png' },
            ];
            uploader.displayResults(results, 2);
            expect(uploader.uploadCompleted).toBe(true);
        });

        test('does not set uploadCompleted when only special items', () => {
            uploader.uploadCompleted = false;
            const results = [
                { type: 'success', url: 'http://example.com/album', isAlbum: true },
            ];
            uploader.displayResults(results, 0);
            expect(uploader.uploadCompleted).toBe(false);
        });

        test('does not set uploadCompleted when only errors', () => {
            uploader.uploadCompleted = false;
            const results = [
                { type: 'error', message: 'Failed' },
            ];
            uploader.displayResults(results, 1);
            expect(uploader.uploadCompleted).toBe(false);
        });

        test('counts image uploads excluding posts/albums/collections', () => {
            uploader.uploadCompleted = false;
            const results = [
                { type: 'success', url: 'http://example.com/a.png' },
                { type: 'success', url: 'http://example.com/album', isAlbum: true },
                { type: 'success', url: 'http://example.com/b.png' },
                { type: 'success', url: 'http://example.com/post', isPost: true },
            ];
            uploader.displayResults(results, 2);
            expect(uploader.uploadCompleted).toBe(true);
        });
    });

    describe('showError()', () => {
        test('shows results div', () => {
            uploader.resultsDiv.style.display = 'none';
            uploader.showError('Test error');
            expect(uploader.resultsDiv.style.display).toBe('block');
        });

        test('displays error message in results content', () => {
            uploader.showError('Something went wrong');
            expect(uploader.resultsContent.innerHTML).toContain('Something went wrong');
        });

        test('adds error class to result item', () => {
            uploader.showError('Error message');
            expect(uploader.resultsContent.innerHTML).toContain('class="result-item error"');
        });
    });

    describe('Provider switching', () => {
        test('switching to catbox shows URL group', () => {
            uploader.provider = 'catbox';
            uploader.updateUI();
            expect(uploader.urlGroup._classList.has('hidden')).toBe(false);
        });

        test('switching to sxcu hides URL group', () => {
            uploader.provider = 'sxcu';
            uploader.updateUI();
            expect(uploader.urlGroup._classList.has('hidden')).toBe(true);
        });

        test('switching to imgchest shows anonymous group', () => {
            uploader.provider = 'imgchest';
            uploader.updateUI();
            expect(uploader.anonymousGroup._classList.has('hidden')).toBe(false);
        });
    });
});
