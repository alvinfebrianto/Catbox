function CatboxUploader() {
    this.files = [];
    this.provider = localStorage.getItem('catbox_provider') || 'imgchest';
    this.uploadCompleted = false;
    this.apiBaseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '';
    this.init();
}

CatboxUploader.prototype.init = function() {
    this.form = document.getElementById('uploadForm');
    this.providerSelect = document.getElementById('provider');
    this.filesInput = document.getElementById('files');
    this.dropZone = document.getElementById('dropZone');
    this.fileList = document.getElementById('fileList');
    this.urlGroup = document.getElementById('urlGroup');
    this.createCollectionGroup = document.getElementById('createCollectionGroup');
    this.sxcuOptions = document.getElementById('sxcuOptions');
    this.anonymousGroup = document.getElementById('anonymousGroup');
    this.postIdGroup = document.getElementById('postIdGroup');
    this.uploadBtn = document.getElementById('uploadBtn');
    this.resultsDiv = document.getElementById('results');
    this.resultsContent = document.getElementById('resultsContent');
    this.progressDiv = document.getElementById('progress');
    this.progressFill = document.getElementById('progressFill');
    this.progressText = document.getElementById('progressText');
    this.urlsInput = document.getElementById('urls');
    this.titleInput = document.getElementById('title');
    this.postIdInput = document.getElementById('postId');
    this.fileTypesHint = document.getElementById('fileTypesHint');

    this.providerSelect.value = this.provider;

    this.bindEvents();
    this.updateUI();
};

CatboxUploader.prototype.bindEvents = function() {
    var self = this;

    this.form.addEventListener('submit', function(e) {
        self.handleSubmit(e);
    });

    this.providerSelect.addEventListener('change', function() {
        self.provider = self.providerSelect.value;
        localStorage.setItem('catbox_provider', self.provider);
        self.updateUI();
    });

    var anonymousCheckbox = document.getElementById('anonymous');
    if (anonymousCheckbox) {
        anonymousCheckbox.addEventListener('change', function() {
            self.updateAnonymousWarning();
            self.updatePostIdVisibility();
        });
    }

    var createCollectionCheckbox = document.getElementById('createCollection');
    if (createCollectionCheckbox) {
        createCollectionCheckbox.addEventListener('change', function() {
            if (self.sxcuOptions) {
                self.sxcuOptions.classList.toggle('hidden', !this.checked);
            }
        });
    }

    this.filesInput.addEventListener('change', function(e) {
        if (self.uploadCompleted) {
            self.files = [];
            self.fileList.innerHTML = '';
            self.titleInput.value = '';
            self.postIdInput.value = '';
            self.urlsInput.value = '';
            self.resultsDiv.style.display = 'none';
            self.uploadCompleted = false;
        }

        var files = e.target.files;
        if (files && files.length > 0) {
            var allowedExtensions = ['.png', '.gif', '.jpeg', '.jpg', '.ico', '.bmp', '.tiff', '.tif', '.webm', '.webp'];
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                var ext = '.' + file.name.split('.').pop().toLowerCase();
                if (allowedExtensions.indexOf(ext) !== -1) {
                    var exists = false;
                    for (var j = 0; j < self.files.length; j++) {
                        if (self.files[j].name === file.name && self.files[j].size === file.size) {
                            exists = true;
                            break;
                        }
                    }
                    if (!exists) {
                        self.files.push(file);
                    }
                }
            }

            self.renderFileList();
            self.updateAnonymousWarning();

            if (self.files.length > 0 && !self.titleInput.value) {
                var firstFile = self.files[0];
                var path = firstFile.webkitRelativePath || firstFile.mozRelativePath || firstFile.path || firstFile.name;
                var lastSlash = path.lastIndexOf('/');
                if (lastSlash > 0) {
                    var folderName = path.substring(0, lastSlash).split('/').pop();
                    self.titleInput.value = folderName;
                } else {
                    self.titleInput.value = firstFile.name.replace(/\.[^/.]+$/, '');
                }
            }
        }

        self.filesInput.value = '';
    });

    this.dropZone.addEventListener('dragover', function(e) {
        e.preventDefault();
        self.dropZone.classList.add('dragover');
    });

    this.dropZone.addEventListener('dragleave', function() {
        self.dropZone.classList.remove('dragover');
    });

    this.dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        self.dropZone.classList.remove('dragover');
        self.addFiles(e.dataTransfer.files);
    });

    this.dropZone.addEventListener('click', function(e) {
        if (e.target !== self.filesInput) {
            self.filesInput.click();
        }
    });
};

CatboxUploader.prototype.updateAnonymousWarning = function() {
    var anonymousCheckbox = document.getElementById('anonymous');
    var existingWarning = this.fileList.parentNode.querySelector('.anonymous-limit-warning');
    
    if (anonymousCheckbox && anonymousCheckbox.checked && this.files.length > 20) {
        if (!existingWarning) {
            var warning = document.createElement('div');
            warning.className = 'anonymous-limit-warning';
            warning.textContent = '⚠ Anonymous posts are limited to 20 images. Only the first 20 files will be uploaded.';
            this.fileList.parentNode.insertBefore(warning, this.fileList.nextSibling);
        }
    } else {
        if (existingWarning) {
            existingWarning.remove();
        }
    }
};

CatboxUploader.prototype.updatePostIdVisibility = function() {
    var anonymousCheckbox = document.getElementById('anonymous');
    var isImgchest = this.provider === 'imgchest';
    
    if (this.postIdGroup) {
        var shouldHide = !isImgchest || (anonymousCheckbox && anonymousCheckbox.checked);
        this.postIdGroup.classList.toggle('hidden', shouldHide);
    }
};

CatboxUploader.prototype.updateUI = function() {
    var isSxcu = this.provider === 'sxcu';
    var isImgchest = this.provider === 'imgchest';
    var isCatbox = this.provider === 'catbox';

    this.urlGroup.classList.toggle('hidden', isSxcu || isImgchest);
    this.createCollectionGroup.classList.toggle('hidden', !isSxcu);

    if (this.sxcuOptions) {
        var createCollectionChecked = document.getElementById('createCollection').checked;
        this.sxcuOptions.classList.toggle('hidden', !isSxcu || !createCollectionChecked);
    }

    this.anonymousGroup.classList.toggle('hidden', !isImgchest);
    this.updatePostIdVisibility();
    this.updateAnonymousWarning();

    var createAlbumGroup = document.getElementById('createAlbumGroup');
    if (createAlbumGroup) {
        createAlbumGroup.classList.toggle('hidden', !isCatbox);
    }

    var allowedTypes = [
        '.png', '.gif', '.jpeg', '.jpg', '.ico', '.bmp',
        '.tiff', '.tif', '.webm', '.webp'
    ];

    var fileInput = this.filesInput;
    fileInput.setAttribute('accept', allowedTypes.join(','));

    if (this.fileTypesHint) {
        if (isCatbox) {
            this.fileTypesHint.textContent = 'Blocked: EXE, SCR, CPL, DOC*, JAR';
        } else if (isSxcu) {
            this.fileTypesHint.textContent = 'Allowed: PNG, GIF, JPEG, ICO, BMP, TIFF, WEBM, WEBP';
        } else {
            this.fileTypesHint.textContent = 'Allowed: JPG, JPEG, PNG, GIF, WEBP';
        }
    }
};

CatboxUploader.prototype.addFiles = function(fileList) {
    var self = this;
    var allowedExtensions = ['.png', '.gif', '.jpeg', '.jpg', '.ico', '.bmp', '.tiff', '.tif', '.webm', '.webp'];

    for (var i = 0; i < fileList.length; i++) {
        var file = fileList[i];
        var ext = '.' + file.name.split('.').pop().toLowerCase();
        if (allowedExtensions.indexOf(ext) !== -1) {
            var exists = false;
            for (var j = 0; j < this.files.length; j++) {
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
    this.updateAnonymousWarning();

    if (this.files.length > 0 && !this.titleInput.value) {
        var firstFile = this.files[0];
        var path = firstFile.webkitRelativePath || firstFile.mozRelativePath || firstFile.name;
        var lastSlash = path.lastIndexOf('/');
        if (lastSlash > 0) {
            var folderName = path.substring(0, lastSlash).split('/').pop();
            this.titleInput.value = folderName;
        } else {
            this.titleInput.value = firstFile.name.replace(/\.[^/.]+$/, '');
        }
    }
};

CatboxUploader.prototype.removeFile = function(index) {
    this.files.splice(index, 1);
    this.renderFileList();
};

CatboxUploader.prototype.renderFileList = function() {
    var self = this;
    this.fileList.innerHTML = '';
    for (var i = 0; i < this.files.length; i++) {
        var file = this.files[i];
        var item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = '<span class="file-name">' + file.name + ' (' + self.formatSize(file.size) + ')</span><button type="button" class="remove-btn" data-index="' + i + '">&times;</button>';
        item.querySelector('.remove-btn').onclick = (function(idx) {
            return function() { self.removeFile(idx); };
        })(i);
        this.fileList.appendChild(item);
    }
};

CatboxUploader.prototype.formatSize = function(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

CatboxUploader.prototype.handleSubmit = function(e) {
    var self = this;
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

    var results = [];
    var urls = this.urlsInput.value.trim() ? this.urlsInput.value.split(',').map(function(u) { return u.trim(); }) : [];

    try {
        switch (this.provider) {
            case 'catbox':
                this.uploadToCatbox(results, urls);
                break;
            case 'sxcu':
                this.uploadToSxcu(results);
                break;
            case 'imgchest':
                this.uploadToImgchest(results);
                break;
        }
    } catch (error) {
        this.showError(error.message);
    } finally {
        this.setLoading(false);
        this.progressDiv.style.display = 'none';
    }
};

CatboxUploader.prototype.uploadToCatbox = function(results, urls) {
    var self = this;
    var title = this.titleInput.value;
    var description = document.getElementById('description').value;
    var totalItems = this.files.length + urls.length;
    var completedItems = 0;

        var self = this;
        var apiBaseUrl = self.apiBaseUrl;

        var uploadFile = function(file, callback) {
            self.updateProgress((completedItems / totalItems) * 100, 'Uploading ' + file.name + '...');

            var formData = new FormData();
            formData.append('reqtype', 'fileupload');
            formData.append('fileToUpload', file);

            fetch(apiBaseUrl + '/upload/catbox', {
            method: 'POST',
            body: formData
        })
        .then(function(response) {
            if (!response.ok) {
                throw new Error('Upload failed: ' + response.statusText);
            }
            return response.text();
        })
        .then(function(url) {
            var result = { type: 'success', url: url.trim() };
            results.push(result);
            self.addIncrementalResult(result, results.length - 1);
            completedItems++;
            callback();
        })
        .catch(function(error) {
            var result = { type: 'error', message: 'Failed to upload ' + file.name + ': ' + error.message };
            results.push(result);
            self.addIncrementalResult(result, results.length - 1);
            completedItems++;
            callback();
        });
    };

    var uploadUrl = function(url, callback) {
        self.updateProgress(((self.files.length + completedItems) / totalItems) * 100, 'Uploading ' + url + '...');

        var formData = new FormData();
        formData.append('reqtype', 'urlupload');
        formData.append('url', url);

        fetch(apiBaseUrl + '/upload/catbox', {
            method: 'POST',
            body: formData
        })
        .then(function(response) {
            if (!response.ok) {
                throw new Error('URL upload failed: ' + response.statusText);
            }
            return response.text();
        })
        .then(function(uploadedUrl) {
            var result = { type: 'success', url: uploadedUrl.trim() };
            results.push(result);
            self.addIncrementalResult(result, results.length - 1);
            completedItems++;
            callback();
        })
        .catch(function(error) {
            var result = { type: 'error', message: 'Failed to upload ' + url + ': ' + error.message };
            results.push(result);
            self.addIncrementalResult(result, results.length - 1);
            completedItems++;
            callback();
        });
    };

    var createAlbum = function() {
        self.updateProgress(95, 'Creating album...');

        var uploadedUrls = results.filter(function(r) { return r.type === 'success'; }).map(function(r) { return r.url; });

        if (uploadedUrls.length > 0) {
            var fileNames = uploadedUrls.map(function(url) {
                try {
                    var uri = new URL(url);
                    return uri.pathname.split('/').pop();
                } catch (e) {
                    return url;
                }
            });

            var albumFormData = new FormData();
            albumFormData.append('reqtype', 'createalbum');
            albumFormData.append('title', title);
            albumFormData.append('desc', description);
            albumFormData.append('files', fileNames.join(' '));

        fetch(apiBaseUrl + '/upload/catbox', {
                method: 'POST',
                body: albumFormData
            })
            .then(function(response) {
                if (response.ok) {
                    return response.text();
                }
                throw new Error('Album creation failed');
            })
            .then(function(albumCode) {
                var albumUrl = albumCode.indexOf('http') === 0 ? albumCode : 'https://catbox.moe/album/' + albumCode;
                var albumResult = { type: 'success', url: albumUrl, isAlbum: true };
                results.push(albumResult);
                self.addIncrementalResult(albumResult, results.length - 1);
                self.updateProgress(100, 'Done!');
                self.displayResults(results, totalItems);
            })
            .catch(function(error) {
                var errorResult = { type: 'error', message: 'Failed to create album: ' + error.message };
                results.push(errorResult);
                self.addIncrementalResult(errorResult, results.length - 1);
                self.updateProgress(100, 'Done!');
                self.displayResults(results, totalItems);
            });
        } else {
            self.updateProgress(100, 'Done!');
            self.displayResults(results, totalItems);
        }
    };

    var shouldCreateAlbum = document.getElementById('createAlbum').checked;

    var processNext = function() {
        if (completedItems >= self.files.length + urls.length) {
            if (shouldCreateAlbum) {
                createAlbum();
            } else {
                self.updateProgress(100, 'Done!');
                self.displayResults(results, totalItems);
            }
            return;
        }

        if (completedItems < self.files.length) {
            uploadFile(self.files[completedItems], processNext);
        } else {
            uploadUrl(urls[completedItems - self.files.length], processNext);
        }
    };

    processNext();
};

CatboxUploader.prototype.uploadToSxcu = function(results) {
    var self = this;
    var apiBaseUrl = self.apiBaseUrl;
    var createCollection = document.getElementById('createCollection').checked;
    var isPrivate = document.getElementById('sxcuPrivate').checked;
    var title = this.titleInput.value;
    var description = document.getElementById('description').value;
    var collectionId = '';
    var collectionToken = '';
    var totalFiles = this.files.length;
    var completedFiles = 0;
    var filesToUpload = [];
    for (var i = 0; i < totalFiles; i++) filesToUpload.push(i);
    var rateLimitState = {
        limit: 5,
        remaining: 5,
        reset: 0,
        bucket: null
    };

    var parseRateLimitHeaders = function(headers) {
        return {
            limit: parseInt(headers.get('X-RateLimit-Limit')) || 5,
            remaining: parseInt(headers.get('X-RateLimit-Remaining')) || 0,
            reset: parseInt(headers.get('X-RateLimit-Reset')) || 0,
            bucket: headers.get('X-RateLimit-Bucket') || null
        };
    };

    var getWaitSeconds = function() {
        if (rateLimitState.reset <= 0) return 60;
        var now = Math.floor(Date.now() / 1000);
        var wait = rateLimitState.reset - now + 1;
        return wait > 0 ? wait : 1;
    };

    var uploadFile = function(fileIndex, callback) {
        var file = self.files[fileIndex];
        self.updateProgress((completedFiles / totalFiles) * 100, 'Uploading ' + file.name + '...');

        var formData = new FormData();
        formData.append('file', file);
        formData.append('noembed', 'true');

        if (collectionId) {
            formData.append('collection', collectionId);
        }

        if (collectionToken) {
            formData.append('collection_token', collectionToken);
        }

        fetch(apiBaseUrl + '/upload/sxcu/files', {
            method: 'POST',
            body: formData,
            headers: {
                'User-Agent': 'sxcuUploader/1.0'
            }
        })
        .then(function(response) {
            var newRateLimit = parseRateLimitHeaders(response.headers);
            rateLimitState.limit = newRateLimit.limit;
            rateLimitState.remaining = newRateLimit.remaining;
            if (newRateLimit.reset > 0) rateLimitState.reset = newRateLimit.reset;
            if (newRateLimit.bucket) rateLimitState.bucket = newRateLimit.bucket;

            return response.json().then(function(data) {
                if (response.status === 429) {
                    if (data.rateLimitReset) {
                        rateLimitState.reset = parseInt(data.rateLimitReset);
                    } else if (data.rateLimitResetAfter) {
                        rateLimitState.reset = Math.floor(Date.now() / 1000) + parseFloat(data.rateLimitResetAfter);
                    }
                    throw new Error('Rate limit exceeded');
                }

                if (!response.ok) {
                    var msg = data.message || (data.error && data.error.message) || data.error || response.statusText;
                    if (typeof msg === 'object') msg = JSON.stringify(msg);
                    throw new Error('Upload failed: ' + msg);
                }
                return data;
            });
        })
        .then(function(data) {
            results.push({ type: 'success', url: data.url });
            completedFiles++;
            callback(null, true);
        })
        .catch(function(error) {
            callback(error, false);
        });
    };

    var processNextBurst = function() {
        if (filesToUpload.length === 0) {
            self.updateProgress(100, 'Done!');
            self.displayResults(results, totalFiles);
            return;
        }

        var burstSize = Math.min(4, filesToUpload.length);
        var currentRemaining = rateLimitState.remaining;

        if (currentRemaining < burstSize && currentRemaining > 0) {
            burstSize = currentRemaining;
        }

        var indicesToUpload = filesToUpload.slice(0, burstSize);
        var rateLimited = false;
        var uploadedCount = 0;

        var uploadNext = function(idx) {
            if (idx >= indicesToUpload.length) {
                if (rateLimited) {
                    var successfulInBurst = uploadedCount;
                    if (successfulInBurst > 0) {
                        filesToUpload = filesToUpload.slice(successfulInBurst);
                    }
                    var waitSeconds = getWaitSeconds();
                    self.updateProgress((completedFiles / totalFiles) * 100, 'Rate limited. Waiting ' + waitSeconds + 's...');
                    setTimeout(processNextBurst, waitSeconds * 1000);
                } else {
                    var rateLimitNotice = self.resultsContent.querySelector('#rate-limit-notice');
                    if (rateLimitNotice) rateLimitNotice.remove();
                    filesToUpload = filesToUpload.slice(burstSize);
                    if (filesToUpload.length > 0) {
                        setTimeout(processNextBurst, 200);
                    } else {
                        self.updateProgress(100, 'Done!');
                        self.displayResults(results, totalFiles);
                    }
                }
                return;
            }

            var fileIndex = indicesToUpload[idx];
            var file = self.files[fileIndex];
            self.updateProgress(((completedFiles + idx) / totalFiles) * 100, 'Uploading ' + file.name + '...');

            uploadFile(fileIndex, function(err, success) {
                if (success) {
                    uploadedCount++;
                    var lastResult = results[results.length - 1];
                    if (lastResult && lastResult.type === 'success') {
                        self.addIncrementalResult(lastResult, results.length - 1);
                    }
                    self.updateProgress(((completedFiles + uploadedCount + (indicesToUpload.length - idx - 1)) / totalFiles) * 100, 'Uploaded: ' + lastResult.url);
                } else if (err && (err.message.indexOf('Rate limit') !== -1 || err.message.indexOf('429') !== -1 || err.message.indexOf('Too Many Requests') !== -1)) {
                    rateLimited = true;
                    var waitSeconds = getWaitSeconds();
                    var rateLimitNotice = document.createElement('div');
                    rateLimitNotice.className = 'result-item warning';
                    rateLimitNotice.textContent = 'Rate limited! Waiting ' + waitSeconds + 's before next upload...';
                    rateLimitNotice.id = 'rate-limit-notice';
                    var existingNotice = self.resultsContent.querySelector('#rate-limit-notice');
                    if (existingNotice) existingNotice.remove();
                    self.resultsContent.insertBefore(rateLimitNotice, self.resultsContent.firstChild);
                    rateLimitNotice.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                uploadNext(idx + 1);
            });
        };

        self.updateProgress((completedFiles / totalFiles) * 100, 'Uploading ' + (completedFiles + 1) + '-' + (completedFiles + indicesToUpload.length) + ' of ' + totalFiles + '...');
        uploadNext(0);
    };

    if (createCollection) {
        this.updateProgress(0, 'Creating collection...');

        var formData = new FormData();
        formData.append('title', title || 'Untitled');
        formData.append('desc', description);
        formData.append('private', isPrivate ? 'true' : 'false');

        fetch(apiBaseUrl + '/upload/sxcu/collections', {
            method: 'POST',
            body: formData,
            headers: {
                'User-Agent': 'sxcuUploader/1.0'
            }
        })
        .then(function(response) {
            if (!response.ok) {
                throw new Error('Collection creation failed: ' + response.statusText);
            }
            return response.json();
        })
        .then(function(data) {
            collectionId = data.collection_id || data.id;
            collectionToken = data.collection_token || data.token;

            if (!collectionId && !collectionToken) {
                throw new Error('Invalid collection response. Keys: ' + Object.keys(data).join(', '));
            }

            var collectionResult = { type: 'success', url: 'https://sxcu.net/c/' + collectionId, isCollection: true };
            results.push(collectionResult);
            self.addIncrementalResult(collectionResult, results.length - 1);
            self.updateProgress(0, 'Collection created. Starting uploads...');
            processNextBurst();
        })
        .catch(function(error) {
            results.push({ type: 'error', message: 'Failed to create collection: ' + error.message });
            self.updateProgress(100, 'Done!');
            self.displayResults(results, totalFiles);
        });
    } else {
        processNextBurst();
    }
};

CatboxUploader.prototype.uploadToImgchest = function(results) {
    var self = this;
    var anonymous = document.getElementById('anonymous').checked;
    var postId = this.postIdInput.value.trim();
    var title = this.titleInput.value;

    if (postId && anonymous) {
        this.showError('Cannot add images to anonymous posts. Anonymous posts do not support adding images after creation.');
        this.setLoading(false);
        this.progressDiv.style.display = 'none';
        return;
    }

    var totalFiles = this.files.length;
    var filesToUpload = this.files.slice();

    if (anonymous) {
        filesToUpload = filesToUpload.slice(0, 20);
    }

    if (anonymous) {
        this.uploadImgchestBatch(postId, filesToUpload, results, totalFiles, anonymous);
    } else if (postId) {
        this.uploadImgchestProgressiveAddToPost(postId, filesToUpload, results, totalFiles);
    } else {
        this.uploadImgchestProgressive(filesToUpload, results, totalFiles, title);
    }
};

CatboxUploader.prototype.uploadImgchestBatch = function(postId, files, results, totalFiles, anonymous) {
    var self = this;
    var apiBaseUrl = self.apiBaseUrl;
    var title = this.titleInput.value;

    this.updateProgress(0, postId ? 'Adding images...' : 'Creating post...');

    var formData = new FormData();
    if (title) formData.append('title', title);
    formData.append('privacy', 'hidden');
    formData.append('nsfw', 'true');
    if (anonymous) formData.append('anonymous', '1');

    for (var i = 0; i < files.length; i++) {
        formData.append('images[]', files[i]);
    }

    var url = postId
        ? apiBaseUrl + '/upload/imgchest/post/' + postId + '/add'
        : apiBaseUrl + '/upload/imgchest/post';

    fetch(url, {
        method: 'POST',
        body: formData
    })
    .then(function(response) {
        return response.text();
    })
    .then(function(text) {
        try {
            var data = JSON.parse(text);
            if (data.error) {
                var errorMsg = data.error;
                if (data.details) {
                    errorMsg += ': ' + (typeof data.details === 'object' ? JSON.stringify(data.details) : data.details);
                }
                throw new Error(errorMsg);
            }

            var postResult = { type: 'success', url: 'https://imgchest.com/p/' + data.data.id, isPost: true };
            results.push(postResult);
            self.addIncrementalResult(postResult, results.length - 1);

            var newImages;
            if (postId) {
                var existingCount = data.data.image_count - files.length;
                newImages = data.data.images.slice(existingCount);
            } else {
                newImages = data.data.images;
            }

            for (var i = 0; i < newImages.length; i++) {
                var imgResult = { type: 'success', url: newImages[i].link };
                results.push(imgResult);
                self.addIncrementalResult(imgResult, results.length - 1);
            }

            self.updateProgress(100, 'Done!');
            self.displayResults(results, totalFiles);
        } catch (e) {
            results.push({ type: 'error', message: 'Failed to upload: ' + e.message });
            self.updateProgress(100, 'Done!');
            self.displayResults(results, totalFiles);
        }
    })
    .catch(function(error) {
        results.push({ type: 'error', message: 'Failed to upload: ' + error.message });
        self.updateProgress(100, 'Done!');
        self.displayResults(results, totalFiles);
    });
};

CatboxUploader.prototype.uploadImgchestProgressiveAddToPost = function(postId, files, results, totalFiles) {
    var self = this;
    var apiBaseUrl = self.apiBaseUrl;
    var completedFiles = 0;
    var postResultAdded = false;

    var uploadNextFile = function(index) {
        if (index >= files.length) {
            self.updateProgress(100, 'Done!');
            self.displayResults(results, totalFiles);
            return;
        }

        var file = files[index];
        self.updateProgress((index / files.length) * 100, 'Adding ' + file.name + ' to post...');

        var formData = new FormData();
        formData.append('images[]', file);

        var url = apiBaseUrl + '/upload/imgchest/post/' + postId + '/add';

        fetch(url, {
            method: 'POST',
            body: formData
        })
        .then(function(response) {
            return response.text();
        })
        .then(function(text) {
            try {
                var data = JSON.parse(text);
                if (data.error) {
                    var errorMsg = data.error;
                    if (data.details) {
                        errorMsg += ': ' + (typeof data.details === 'object' ? JSON.stringify(data.details) : data.details);
                    }
                    throw new Error(errorMsg);
                }

                if (!postResultAdded) {
                    var postResult = { type: 'success', url: 'https://imgchest.com/p/' + data.data.id, isPost: true };
                    results.push(postResult);
                    self.addIncrementalResult(postResult, results.length - 1);
                    postResultAdded = true;
                }

                var newImages = data.data.images.slice(-1);
                for (var i = 0; i < newImages.length; i++) {
                    var imgResult = { type: 'success', url: newImages[i].link };
                    results.push(imgResult);
                    self.addIncrementalResult(imgResult, results.length - 1);
                }

                completedFiles++;
                self.updateProgress((completedFiles / files.length) * 100, 'Added ' + completedFiles + ' of ' + files.length);
                uploadNextFile(index + 1);
            } catch (e) {
                var errResult = { type: 'error', message: 'Failed to add ' + file.name + ': ' + e.message };
                results.push(errResult);
                self.addIncrementalResult(errResult, results.length - 1);
                completedFiles++;
                uploadNextFile(index + 1);
            }
        })
        .catch(function(error) {
            var errResult = { type: 'error', message: 'Failed to add ' + file.name + ': ' + error.message };
            results.push(errResult);
            self.addIncrementalResult(errResult, results.length - 1);
            completedFiles++;
            uploadNextFile(index + 1);
        });
    };

    uploadNextFile(0);
};

CatboxUploader.prototype.uploadImgchestProgressive = function(files, results, totalFiles, title) {
    var self = this;
    var apiBaseUrl = self.apiBaseUrl;
    var currentPostId = null;
    var completedFiles = 0;

    var uploadNextFile = function(index) {
        if (index >= files.length) {
            self.updateProgress(100, 'Done!');
            self.displayResults(results, totalFiles);
            return;
        }

        var file = files[index];
        var isFirst = index === 0;
        self.updateProgress((index / files.length) * 100, 'Uploading ' + file.name + '...');

        var formData = new FormData();
        formData.append('images[]', file);

        if (isFirst) {
            if (title) formData.append('title', title);
            formData.append('privacy', 'hidden');
            formData.append('nsfw', 'true');
        }

        var url = isFirst
            ? apiBaseUrl + '/upload/imgchest/post'
            : apiBaseUrl + '/upload/imgchest/post/' + currentPostId + '/add';

        fetch(url, {
            method: 'POST',
            body: formData
        })
        .then(function(response) {
            return response.text();
        })
        .then(function(text) {
            try {
                var data = JSON.parse(text);
                if (data.error) {
                    var errorMsg = data.error;
                    if (data.details) {
                        errorMsg += ': ' + (typeof data.details === 'object' ? JSON.stringify(data.details) : data.details);
                    }
                    throw new Error(errorMsg);
                }

                if (isFirst) {
                    currentPostId = data.data.id;
                    var postResult = { type: 'success', url: 'https://imgchest.com/p/' + data.data.id, isPost: true };
                    results.push(postResult);
                    self.addIncrementalResult(postResult, results.length - 1);
                }

                var newImages = data.data.images;
                if (!isFirst) {
                    newImages = newImages.slice(-1);
                }

                for (var i = 0; i < newImages.length; i++) {
                    var imgResult = { type: 'success', url: newImages[i].link };
                    results.push(imgResult);
                    self.addIncrementalResult(imgResult, results.length - 1);
                }

                completedFiles++;
                self.updateProgress((completedFiles / files.length) * 100, 'Uploaded ' + completedFiles + ' of ' + files.length);
                uploadNextFile(index + 1);
            } catch (e) {
                var errResult = { type: 'error', message: 'Failed to upload ' + file.name + ': ' + e.message };
                results.push(errResult);
                self.addIncrementalResult(errResult, results.length - 1);
                completedFiles++;

                if (currentPostId || index > 0) {
                    uploadNextFile(index + 1);
                } else {
                    self.updateProgress(100, 'Done!');
                    self.displayResults(results, totalFiles);
                }
            }
        })
        .catch(function(error) {
            var errResult = { type: 'error', message: 'Failed to upload ' + file.name + ': ' + error.message };
            results.push(errResult);
            self.addIncrementalResult(errResult, results.length - 1);
            completedFiles++;

            if (currentPostId || index > 0) {
                uploadNextFile(index + 1);
            } else {
                self.updateProgress(100, 'Done!');
                self.displayResults(results, totalFiles);
            }
        });
    };

    uploadNextFile(0);
};

CatboxUploader.prototype.updateProgress = function(percent, text) {
    this.progressFill.style.width = percent + '%';
    this.progressText.textContent = text;
};

CatboxUploader.prototype.addIncrementalResult = function(result, index) {
    var item = document.createElement('div');
    item.className = 'result-item ' + result.type;

    if (result.isAlbum || result.isCollection || result.isPost) {
        item.className += ' highlight';
    }

    item.setAttribute('data-result-index', index);
    item.id = 'result-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    if (result.type === 'success') {
        if (result.isAlbum) {
            item.innerHTML = 'Album: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
        } else if (result.isCollection) {
            item.innerHTML = 'Collection: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
        } else if (result.isPost) {
            item.innerHTML = 'Post: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
        } else {
            item.innerHTML = '<a href="' + result.url + '" target="_blank">' + result.url + '</a>';
        }
    } else {
        item.textContent = result.message;
    }

    var insertAfterSummary = false;
    if (result.isAlbum || result.isCollection || result.isPost) {
        insertAfterSummary = true;
    }

    var summaryContainer = this.resultsContent.querySelector('#final-summary');
    var existingItems = this.resultsContent.querySelectorAll('.result-item');

    if (insertAfterSummary) {
        if (summaryContainer && summaryContainer.nextSibling) {
            this.resultsContent.insertBefore(item, summaryContainer.nextSibling);
        } else if (summaryContainer) {
             this.resultsContent.appendChild(item);
        } else if (existingItems.length > 0) {
             this.resultsContent.insertBefore(item, existingItems[0]);
        } else {
             this.resultsContent.appendChild(item);
        }
    } else {
        if (existingItems.length > 0) {
             this.resultsContent.appendChild(item);
        } else {
             this.resultsContent.appendChild(item);
        }
    }

    setTimeout(function() {
        item.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
};

CatboxUploader.prototype.setLoading = function(loading) {
    this.uploadBtn.disabled = loading;
    this.uploadBtn.querySelector('.btn-text').style.display = loading ? 'none' : 'inline';
    this.uploadBtn.querySelector('.btn-loading').style.display = loading ? 'inline' : 'none';
};

CatboxUploader.prototype.displayResults = function(results, totalFiles) {
    this.resultsDiv.style.display = 'block';

    var existingItems = this.resultsContent.querySelectorAll('.result-item');
    var hasSummary = this.resultsContent.querySelector('.summary');

    if (hasSummary) {
        hasSummary.remove();
    }

    var imageUploads = results.filter(function(r) {
        return r.type === 'success' && !r.isPost && !r.isAlbum && !r.isCollection;
    }).length;
    var failed = results.filter(function(r) { return r.type === 'error'; }).length;
    var warnings = results.filter(function(r) { return r.type === 'warning'; }).length;

    if (imageUploads > 0) {
        this.uploadCompleted = true;
    }

    var filesCount = totalFiles !== undefined ? totalFiles : this.files.length;
    var skipped = warnings > 0 ? filesCount - imageUploads : 0;

    var summaryText = 'Successfully uploaded ' + imageUploads + ' out of ' + filesCount + ' files.';
    if (failed > 0) {
        summaryText += ' ' + failed + ' failed.';
    }
    if (skipped > 0) {
        summaryText += ' ' + skipped + ' skipped (anonymous limit).';
    }

    var summary = document.createElement('div');
    summary.className = 'summary ' + (failed > 0 ? 'warning' : 'success');
    summary.textContent = summaryText;

    var summaryContainer = document.createElement('div');
    summaryContainer.id = 'final-summary';
    summaryContainer.appendChild(summary);

    this.resultsContent.insertBefore(summaryContainer, existingItems.length > 0 ? existingItems[0] : null);

    var newItems = [];

    var sortedIndices = [];
    var specialIndices = [];
    var normalIndices = [];

    for (var i = 0; i < results.length; i++) {
        if (results[i].isAlbum || results[i].isCollection || results[i].isPost) {
            specialIndices.push(i);
        } else {
            normalIndices.push(i);
        }
    }
    sortedIndices = specialIndices.concat(normalIndices);

    for (var k = 0; k < sortedIndices.length; k++) {
        var i = sortedIndices[k];
        var result = results[i];
        var existingItem = this.resultsContent.querySelector('[data-result-index="' + i + '"]');

        if (!existingItem) {
            var item = document.createElement('div');
            item.className = 'result-item ' + result.type;
            if (result.isAlbum || result.isCollection || result.isPost) {
                item.className += ' highlight';
            }
            item.setAttribute('data-result-index', i);

            if (result.type === 'success') {
                if (result.isAlbum) {
                    item.innerHTML = 'Album: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
                } else if (result.isCollection) {
                    item.innerHTML = 'Collection: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
                } else if (result.isPost) {
                    item.innerHTML = 'Post: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
                } else {
                    item.innerHTML = '<a href="' + result.url + '" target="_blank">' + result.url + '</a>';
                }
            } else if (result.type === 'warning') {
                item.textContent = result.message;
            } else {
                item.textContent = result.message;
            }

            newItems.push(item);
        } else {
             if (result.isAlbum || result.isCollection || result.isPost) {
                 if (!existingItem.classList.contains('highlight')) {
                     existingItem.classList.add('highlight');
                 }
             }

             newItems.push(existingItem);
        }
    }

    for (var j = 0; j < newItems.length; j++) {
        this.resultsContent.appendChild(newItems[j]);
    }

    var self = this;
    setTimeout(function() {
        self.resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
};

CatboxUploader.prototype.showError = function(message) {
    this.resultsDiv.style.display = 'block';
    this.resultsContent.innerHTML = '<div class="result-item error">' + message + '</div>';
};

document.addEventListener('DOMContentLoaded', function() {
    new CatboxUploader();
});
