function CatboxUploader() {
    this.files = [];
    this.provider = localStorage.getItem('catbox_provider') || 'imgchest';
    this.uploadCompleted = false;
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
            if (this.checked && self.files.length > 20) {
                var warning = document.createElement('div');
                warning.className = 'result-item warning anonymous-warning';
                warning.style.marginTop = '10px';
                warning.textContent = 'Warning: Anonymous posts are limited to 20 images. Only the first 20 files will be uploaded.';
                var existingWarning = self.fileList.parentNode.querySelector('.anonymous-warning');
                if (!existingWarning) {
                    self.fileList.parentNode.insertBefore(warning, self.fileList.nextSibling);
                }
            } else {
                var existingWarning = self.fileList.parentNode.querySelector('.anonymous-warning');
                if (existingWarning) {
                    existingWarning.remove();
                }
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
};

CatboxUploader.prototype.updateUI = function() {
    var isSxcu = this.provider === 'sxcu';
    var isImgchest = this.provider === 'imgchest';
    var isCatbox = this.provider === 'catbox';

    this.urlGroup.classList.toggle('hidden', isSxcu || isImgchest);
    this.createCollectionGroup.classList.toggle('hidden', !isSxcu);
    this.anonymousGroup.classList.toggle('hidden', !isImgchest);
    this.postIdGroup.classList.toggle('hidden', !isImgchest);

    var allowedTypes = [
        '.png', '.gif', '.jpeg', '.jpg', '.ico', '.bmp',
        '.tiff', '.tif', '.webm', '.webp'
    ];

    var fileInput = this.filesInput;
    fileInput.setAttribute('accept', allowedTypes.join(','));
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

    // Show warning for anonymous post limit
    var anonymousCheckbox = document.getElementById('anonymous');
    if (anonymousCheckbox && anonymousCheckbox.checked && this.files.length > 20) {
        var warning = document.createElement('div');
        warning.className = 'result-item warning';
        warning.style.marginTop = '10px';
        warning.textContent = 'Warning: Anonymous posts are limited to 20 images. Only the first 20 files will be uploaded.';
        var existingWarning = this.fileList.parentNode.querySelector('.anonymous-warning');
        if (existingWarning) {
            existingWarning.remove();
        }
        warning.className += ' anonymous-warning';
        this.fileList.parentNode.insertBefore(warning, this.fileList.nextSibling);
    } else {
        var existingWarning = this.fileList.parentNode.querySelector('.anonymous-warning');
        if (existingWarning) {
            existingWarning.remove();
        }
    }

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
    this.resultsDiv.style.display = 'none';
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

    var uploadFile = function(file, callback) {
        self.updateProgress((completedItems / totalItems) * 100, 'Uploading ' + file.name + '...');

        var formData = new FormData();
        formData.append('reqtype', 'fileupload');
        formData.append('fileToUpload', file);

        fetch('/upload/catbox', {
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
            results.push({ type: 'success', url: url.trim() });
            completedItems++;
            callback();
        })
        .catch(function(error) {
            results.push({ type: 'error', message: 'Failed to upload ' + file.name + ': ' + error.message });
            completedItems++;
            callback();
        });
    };

    var uploadUrl = function(url, callback) {
        self.updateProgress(((self.files.length + completedItems) / totalItems) * 100, 'Uploading ' + url + '...');

        var formData = new FormData();
        formData.append('reqtype', 'urlupload');
        formData.append('url', url);

        fetch('/upload/catbox', {
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
            results.push({ type: 'success', url: uploadedUrl.trim() });
            completedItems++;
            callback();
        })
        .catch(function(error) {
            results.push({ type: 'error', message: 'Failed to upload ' + url + ': ' + error.message });
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

        fetch('/upload/catbox', {
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
                results.push({ type: 'success', url: albumUrl, isAlbum: true });
                self.updateProgress(100, 'Done!');
                self.displayResults(results, totalItems);
            })
            .catch(function(error) {
                results.push({ type: 'error', message: 'Failed to create album: ' + error.message });
                self.updateProgress(100, 'Done!');
                self.displayResults(results, totalItems);
            });
        } else {
            self.updateProgress(100, 'Done!');
            self.displayResults(results, totalItems);
        }
    };

    var processNext = function() {
        if (completedItems >= self.files.length + urls.length) {
            createAlbum();
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
    var createCollection = document.getElementById('createCollection').checked;
    var title = this.titleInput.value;
    var description = document.getElementById('description').value;
    var collectionId = '';

    var uploadFile = function(file, callback) {
        self.updateProgress((completedFiles / totalFiles) * 100, 'Uploading ' + file.name + '...');

        var formData = new FormData();
        formData.append('file', file);
        formData.append('noembed', '');

        if (collectionId) {
            formData.append('collection', collectionId);
        }

        fetch('/upload/sxcu/files', {
            method: 'POST',
            body: formData,
            headers: {
                'User-Agent': 'sxcuUploader/1.0'
            }
        })
        .then(function(response) {
            if (!response.ok) {
                throw new Error('Upload failed: ' + response.statusText);
            }
            return response.json();
        })
        .then(function(data) {
            results.push({ type: 'success', url: data.url });
            completedFiles++;
            callback();
        })
        .catch(function(error) {
            results.push({ type: 'error', message: 'Failed to upload ' + file.name + ': ' + error.message });
            completedFiles++;
            callback();
        });
    };

    var processNext = function() {
        if (completedFiles >= totalFiles) {
            self.updateProgress(100, 'Done!');
            self.displayResults(results, totalFiles);
            return;
        }

        uploadFile(self.files[completedFiles], processNext);
    };

    if (createCollection) {
        this.updateProgress(0, 'Creating collection...');

        var formData = new FormData();
        formData.append('title', title || 'Untitled');
        formData.append('desc', description);
        formData.append('private', 'false');
        formData.append('unlisted', 'false');

        fetch('/upload/sxcu/collections', {
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
            collectionId = data.collection_id;
            results.push({ type: 'success', url: 'https://sxcu.net/c/' + collectionId, isCollection: true });
            totalFiles = self.files.length;
            var completedFiles = 0;
            processNext();
        })
        .catch(function(error) {
            results.push({ type: 'error', message: 'Failed to create collection: ' + error.message });
            self.updateProgress(100, 'Done!');
            self.displayResults(results, totalFiles);
        });
    } else {
        var totalFiles = this.files.length;
        var completedFiles = 0;
        processNext();
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

    if (postId) {
        this.uploadImgchestPost(postId, this.files, results, totalFiles);
    } else {
        this.uploadImgchestPost(null, this.files, results, totalFiles);
    }
};

CatboxUploader.prototype.uploadImgchestPost = function(postId, files, results, totalFiles) {
    var self = this;
    var anonymous = document.getElementById('anonymous').checked;
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
        ? '/upload/imgchest/post/' + postId + '/add'
        : '/upload/imgchest/post';

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

            results.push({ type: 'success', url: 'https://imgchest.com/p/' + data.data.id, isPost: true });

            var newImages;
            if (postId) {
                var existingCount = data.data.image_count - files.length;
                newImages = data.data.images.slice(existingCount);
            } else {
                newImages = data.data.images;
            }

            for (var i = 0; i < newImages.length; i++) {
                results.push({ type: 'success', url: newImages[i].link });
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

CatboxUploader.prototype.updateProgress = function(percent, text) {
    this.progressFill.style.width = percent + '%';
    this.progressText.textContent = text;
};

CatboxUploader.prototype.setLoading = function(loading) {
    this.uploadBtn.disabled = loading;
    this.uploadBtn.querySelector('.btn-text').style.display = loading ? 'none' : 'inline';
    this.uploadBtn.querySelector('.btn-loading').style.display = loading ? 'inline' : 'none';
};

CatboxUploader.prototype.displayResults = function(results, totalFiles) {
    this.resultsDiv.style.display = 'block';
    this.resultsContent.innerHTML = '';

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
    this.resultsContent.appendChild(summary);

    for (var i = 0; i < results.length; i++) {
        var result = results[i];
        var item = document.createElement('div');
        item.className = 'result-item ' + result.type;

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
        } else if (result.type === 'warning') {
            item.textContent = result.message;
        } else {
            item.textContent = result.message;
        }

        this.resultsContent.appendChild(item);
    }
};

CatboxUploader.prototype.showError = function(message) {
    this.resultsDiv.style.display = 'block';
    this.resultsContent.innerHTML = '<div class="result-item error">' + message + '</div>';
};

document.addEventListener('DOMContentLoaded', function() {
    new CatboxUploader();
});
