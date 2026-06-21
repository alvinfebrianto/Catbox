import { Provider, UploadResult, ALLOWED_EXTENSIONS, IMGCHEST_ALLOWED_EXTENSIONS, KEK_ALLOWED_EXTENSIONS } from './types';
import { CatboxUploadInput, ImgchestUploadInput, KekUploadInput, SxcuUploadInput, UploadObserver } from './upload/contracts';
import { uploadToCatbox as runCatboxSequencer } from './upload/catbox';
import { uploadToImgchest as runImgchestSequencer } from './upload/imgchest';
import { uploadToKek as runKekSequencer } from './upload/kek';
import { uploadToSxcu as runSxcuSequencer } from './upload/sxcu';

declare const API_BASE_URL: string;

interface ExtendedFile extends Omit<File, 'webkitRelativePath'> {
  webkitRelativePath?: string;
  mozRelativePath?: string;
  path?: string;
}

function createSafeLink(url: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.rel = 'noopener noreferrer';
  a.target = '_blank';
  a.textContent = url;

  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      a.href = u.toString();
    } else {
      a.href = 'about:blank';
    }
  } catch {
    a.href = 'about:blank';
  }
  return a;
}

export class ImageUploader {
  private files: File[] = [];
  private provider: Provider;
  private uploadCompleted = false;
  private apiBaseUrl: string;

  private form!: HTMLFormElement;
  private providerSelect!: HTMLSelectElement;
  private filesInput!: HTMLInputElement;
  private dropZone!: HTMLElement;
  private fileList!: HTMLElement;
  private urlGroup!: HTMLElement;
  private createCollectionGroup!: HTMLElement;
  private sxcuOptions!: HTMLElement;
  private anonymousGroup!: HTMLElement;
  private postIdGroup!: HTMLElement;
  private uploadBtn!: HTMLButtonElement;
  private resultsDiv!: HTMLElement;
  private resultsContent!: HTMLElement;
  private progressDiv!: HTMLElement;
  private progressFill!: HTMLElement;
  private progressText!: HTMLElement;
  private urlsInput!: HTMLInputElement;
  private titleInput!: HTMLInputElement;
  private postIdInput!: HTMLInputElement;
  private fileTypesHint!: HTMLElement;
  private imgchestApiKeyGroup!: HTMLElement;
  private imgchestApiKeyInput!: HTMLInputElement;
  private toggleApiKeyBtn!: HTMLButtonElement;
  private kekApiKeyGroup!: HTMLElement;
  private kekApiKeyInput!: HTMLInputElement;
  private toggleKekApiKeyBtn!: HTMLButtonElement;
  private kekMatureGroup!: HTMLElement;
  private kekMatureCheckbox!: HTMLInputElement;
  private titleGroup!: HTMLElement;
  private descriptionGroup!: HTMLElement;
  private imgchestOptions!: HTMLElement;
  private imgchestPrivacySelect!: HTMLSelectElement;
  private imgchestNsfwCheckbox!: HTMLInputElement;

  constructor() {
    this.provider = (sessionStorage.getItem('image_uploader_provider') as Provider)
      || (localStorage.getItem('image_uploader_provider') as Provider)
      || 'imgchest';

    if (localStorage.getItem('image_uploader_provider')) {
      sessionStorage.setItem('image_uploader_provider', localStorage.getItem('image_uploader_provider')!);
      localStorage.removeItem('image_uploader_provider');
    }

    this.apiBaseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '';
    this.init();
  }

  private getAuthHeaders(): Record<string, string> {
    return {};
  }

  private getAllowedExtensions(): string[] {
    if (this.provider === 'imgchest') return IMGCHEST_ALLOWED_EXTENSIONS;
    if (this.provider === 'kek') return KEK_ALLOWED_EXTENSIONS;
    return ALLOWED_EXTENSIONS;
  }

  private init(): void {
    this.form = document.getElementById('uploadForm') as HTMLFormElement;
    this.providerSelect = document.getElementById('provider') as unknown as HTMLSelectElement;
    this.filesInput = document.getElementById('files') as HTMLInputElement;
    this.dropZone = document.getElementById('dropZone') as HTMLElement;
    this.fileList = document.getElementById('fileList') as HTMLElement;
    this.urlGroup = document.getElementById('urlGroup') as HTMLElement;
    this.createCollectionGroup = document.getElementById('createCollectionGroup') as HTMLElement;
    this.sxcuOptions = document.getElementById('sxcuOptions') as HTMLElement;
    this.anonymousGroup = document.getElementById('anonymousGroup') as HTMLElement;
    this.postIdGroup = document.getElementById('postIdGroup') as HTMLElement;
    this.uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement;
    this.resultsDiv = document.getElementById('results') as HTMLElement;
    this.resultsContent = document.getElementById('resultsContent') as HTMLElement;
    this.progressDiv = document.getElementById('progress') as HTMLElement;
    this.progressFill = document.getElementById('progressFill') as HTMLElement;
    this.progressText = document.getElementById('progressText') as HTMLElement;
    this.urlsInput = document.getElementById('urls') as HTMLInputElement;
    this.titleInput = document.getElementById('title') as HTMLInputElement;
    this.postIdInput = document.getElementById('postId') as HTMLInputElement;
    this.fileTypesHint = document.getElementById('fileTypesHint') as HTMLElement;
    this.imgchestApiKeyGroup = document.getElementById('imgchestApiKeyGroup') as HTMLElement;
    this.imgchestApiKeyInput = document.getElementById('imgchestApiKey') as HTMLInputElement;
    this.toggleApiKeyBtn = document.getElementById('toggleApiKeyVisibility') as HTMLButtonElement;
    this.kekApiKeyGroup = document.getElementById('kekApiKeyGroup') as HTMLElement;
    this.kekApiKeyInput = document.getElementById('kekApiKey') as HTMLInputElement;
    this.toggleKekApiKeyBtn = document.getElementById('toggleKekApiKeyVisibility') as HTMLButtonElement;
    this.kekMatureGroup = document.getElementById('kekMatureGroup') as HTMLElement;
    this.kekMatureCheckbox = document.getElementById('kekMature') as HTMLInputElement;
    this.titleGroup = document.getElementById('titleGroup') as HTMLElement;
    this.descriptionGroup = document.getElementById('descriptionGroup') as HTMLElement;
    this.imgchestOptions = document.getElementById('imgchestOptions') as HTMLElement;
    this.imgchestPrivacySelect = document.getElementById('imgchestPrivacy') as unknown as HTMLSelectElement;
    this.imgchestNsfwCheckbox = document.getElementById('imgchestNsfw') as HTMLInputElement;

    this.providerSelect.value = this.provider;

    let savedApiKey = sessionStorage.getItem('imgchest_api_key');
    if (!savedApiKey && localStorage.getItem('imgchest_api_key')) {
      savedApiKey = localStorage.getItem('imgchest_api_key');
      sessionStorage.setItem('imgchest_api_key', savedApiKey!);
      localStorage.removeItem('imgchest_api_key');
    }
    if (savedApiKey && this.imgchestApiKeyInput) {
      this.imgchestApiKeyInput.value = savedApiKey;
    }

    const savedKekApiKey = sessionStorage.getItem('kek_api_key');
    if (savedKekApiKey && this.kekApiKeyInput) {
      this.kekApiKeyInput.value = savedKekApiKey;
    }

    this.bindEvents();
    this.updateUI();
  }

  private bindEvents(): void {
    this.form.addEventListener('submit', (e) => { void this.handleSubmit(e).catch(() => {}); });

    this.providerSelect.addEventListener('change', () => {
      this.provider = this.providerSelect.value as Provider;
      sessionStorage.setItem('image_uploader_provider', this.provider);
      this.updateUI();
    });

    const anonymousCheckbox = document.getElementById('anonymous') as HTMLInputElement;
    if (anonymousCheckbox) {
      anonymousCheckbox.addEventListener('change', () => {
        this.updateAnonymousWarning();
        this.updatePostIdVisibility();
        this.updatePrivacySelectState();
      });
    }

    const createCollectionCheckbox = document.getElementById('createCollection') as HTMLInputElement;
    if (createCollectionCheckbox) {
      createCollectionCheckbox.addEventListener('change', () => {
        if (this.sxcuOptions) {
          this.sxcuOptions.classList.toggle('hidden', !createCollectionCheckbox.checked);
        }
      });
    }

    if (this.imgchestApiKeyInput) {
      this.imgchestApiKeyInput.addEventListener('change', () => {
        const value = this.imgchestApiKeyInput.value.trim();
        if (value) {
          sessionStorage.setItem('imgchest_api_key', value);
        } else {
          sessionStorage.removeItem('imgchest_api_key');
        }
      });
    }

    if (this.toggleApiKeyBtn) {
      this.toggleApiKeyBtn.addEventListener('click', () => {
        if (this.imgchestApiKeyInput.type === 'password') {
          this.imgchestApiKeyInput.type = 'text';
          this.toggleApiKeyBtn.textContent = '🙈';
        } else {
          this.imgchestApiKeyInput.type = 'password';
          this.toggleApiKeyBtn.textContent = '👁';
        }
      });
    }

    if (this.kekApiKeyInput) {
      this.kekApiKeyInput.addEventListener('change', () => {
        const value = this.kekApiKeyInput.value.trim();
        if (value) {
          sessionStorage.setItem('kek_api_key', value);
        } else {
          sessionStorage.removeItem('kek_api_key');
        }
      });
    }

    if (this.toggleKekApiKeyBtn) {
      this.toggleKekApiKeyBtn.addEventListener('click', () => {
        if (this.kekApiKeyInput.type === 'password') {
          this.kekApiKeyInput.type = 'text';
          this.toggleKekApiKeyBtn.textContent = '🙈';
        } else {
          this.kekApiKeyInput.type = 'password';
          this.toggleKekApiKeyBtn.textContent = '👁';
        }
      });
    }

    this.filesInput.addEventListener('change', (e) => {
      if (this.uploadCompleted) {
        this.files = [];
        this.fileList.innerHTML = '';
        this.titleInput.value = '';
        this.postIdInput.value = '';
        this.urlsInput.value = '';
        this.resultsDiv.style.display = 'none';
        this.uploadCompleted = false;
      }

      const input = e.target as HTMLInputElement;
      const fileList = input.files;
      if (fileList && fileList.length > 0) {
        const allowedExtensions = this.getAllowedExtensions();
        for (let i = 0; i < fileList.length; i++) {
          const file = fileList[i];
          const ext = '.' + file.name.split('.').pop()?.toLowerCase();
          if (allowedExtensions.includes(ext)) {
            const exists = this.files.some(f => f.name === file.name && f.size === file.size);
            if (!exists) {
              this.files.push(file);
            }
          }
        }

        this.renderFileList();
        this.updateAnonymousWarning();

        if (this.files.length > 0 && !this.titleInput.value) {
          const firstFile = this.files[0] as ExtendedFile;
          const path = firstFile.webkitRelativePath || firstFile.mozRelativePath || firstFile.name;
          const lastSlash = path.lastIndexOf('/');
          if (lastSlash > 0) {
            const folderName = path.substring(0, lastSlash).split('/').pop();
            this.titleInput.value = folderName || '';
          } else {
            this.titleInput.value = firstFile.name.replace(/\.[^/.]+$/, '');
          }
        }
      }

      this.filesInput.value = '';
    });

    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('dragover');
    });

    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('dragover');
    });

    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('dragover');
      if (e.dataTransfer?.files) {
        this.addFiles(e.dataTransfer.files);
      }
    });

    this.dropZone.addEventListener('click', (e) => {
      if (e.target !== this.filesInput) {
        this.filesInput.click();
      }
    });
  }

  private updateAnonymousWarning(): void {
    const anonymousCheckbox = document.getElementById('anonymous') as HTMLInputElement;
    const existingWarning = this.fileList.parentNode?.querySelector('.anonymous-limit-warning');
    const isImgchest = this.provider === 'imgchest';

    if (isImgchest && anonymousCheckbox?.checked && this.files.length > 20) {
      if (!existingWarning) {
        const warning = document.createElement('div');
        warning.className = 'anonymous-limit-warning';
        warning.textContent = '⚠ Anonymous posts are limited to 20 images. Only the first 20 files will be uploaded.';
        this.fileList.parentNode?.insertBefore(warning, this.fileList.nextSibling);
      }
    } else {
      existingWarning?.remove();
    }
  }

  private updatePostIdVisibility(): void {
    const anonymousCheckbox = document.getElementById('anonymous') as HTMLInputElement;
    const isImgchest = this.provider === 'imgchest';

    if (this.postIdGroup) {
      const shouldHide = !isImgchest || anonymousCheckbox?.checked;
      this.postIdGroup.classList.toggle('hidden', shouldHide);
    }
  }

  private updatePrivacySelectState(): void {
    if (!this.imgchestPrivacySelect) return;

    const anonymousCheckbox = document.getElementById('anonymous') as HTMLInputElement;
    const isImgchest = this.provider === 'imgchest';
    const isAnonymous = anonymousCheckbox?.checked ?? false;

    if (!isImgchest) {
      this.imgchestPrivacySelect.disabled = false;
      return;
    }

    this.imgchestPrivacySelect.disabled = isAnonymous;
    if (isAnonymous) {
      this.imgchestPrivacySelect.value = 'hidden';
    }
  }

  private updateUI(): void {
    const isSxcu = this.provider === 'sxcu';
    const isImgchest = this.provider === 'imgchest';
    const isCatbox = this.provider === 'catbox';
    const isKek = this.provider === 'kek';

    this.urlGroup.classList.toggle('hidden', isSxcu || isImgchest);
    this.createCollectionGroup.classList.toggle('hidden', !isSxcu);

    if (this.sxcuOptions) {
      const createCollectionCheckbox = document.getElementById('createCollection') as HTMLInputElement;
      this.sxcuOptions.classList.toggle('hidden', !isSxcu || !createCollectionCheckbox?.checked);
    }

    this.anonymousGroup.classList.toggle('hidden', !isImgchest);
    if (this.imgchestApiKeyGroup) {
      this.imgchestApiKeyGroup.classList.toggle('hidden', !isImgchest);
    }
    if (this.imgchestOptions) {
      this.imgchestOptions.classList.toggle('hidden', !isImgchest);
    }
    if (this.kekApiKeyGroup) {
      this.kekApiKeyGroup.classList.toggle('hidden', !isKek);
    }
    if (this.kekMatureGroup) {
      this.kekMatureGroup.classList.toggle('hidden', !isKek);
    }
    if (this.descriptionGroup) {
      this.descriptionGroup.classList.toggle('hidden', isImgchest || isKek);
    }
    if (this.titleGroup) {
      this.titleGroup.classList.toggle('hidden', isKek);
    }
    this.updatePostIdVisibility();
    this.updateAnonymousWarning();
    this.updatePrivacySelectState();

    const createAlbumGroup = document.getElementById('createAlbumGroup');
    if (createAlbumGroup) {
      createAlbumGroup.classList.toggle('hidden', !isCatbox);
    }

    this.filesInput.setAttribute('accept', this.getAllowedExtensions().join(','));

    if (this.fileTypesHint) {
      if (isCatbox) {
        this.fileTypesHint.textContent = 'Blocked: EXE, SCR, CPL, DOC*, JAR';
      } else if (isSxcu) {
        this.fileTypesHint.textContent = 'Allowed: PNG, GIF, JPEG, ICO, BMP, TIFF, WEBM, WEBP';
      } else if (isKek) {
        this.fileTypesHint.textContent = 'Allowed: JPG, JPEG, PNG, GIF, WEBP (max 50MB)';
      } else {
        this.fileTypesHint.textContent = 'Allowed: JPG, JPEG, PNG, GIF, WEBP, MP4 (max 30MB)';
      }
    }
  }

  private addFiles(fileList: FileList): void {
    const allowedExtensions = this.getAllowedExtensions();
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (allowedExtensions.includes(ext)) {
        const exists = this.files.some(f => f.name === file.name && f.size === file.size);
        if (!exists) {
          this.files.push(file);
        }
      }
    }

    this.renderFileList();
    this.updateAnonymousWarning();

    if (this.files.length > 0 && !this.titleInput.value) {
      const firstFile = this.files[0] as ExtendedFile;
      const path = firstFile.webkitRelativePath || firstFile.mozRelativePath || firstFile.name;
      const lastSlash = path.lastIndexOf('/');
      if (lastSlash > 0) {
        const folderName = path.substring(0, lastSlash).split('/').pop();
        this.titleInput.value = folderName || '';
      } else {
        this.titleInput.value = firstFile.name.replace(/\.[^/.]+$/, '');
      }
    }
  }

  private removeFile(index: number): void {
    this.files.splice(index, 1);
    this.renderFileList();
  }

  private renderFileList(): void {
    this.fileList.innerHTML = '';
    for (let i = 0; i < this.files.length; i++) {
      const file = this.files[i];
      const item = document.createElement('div');
      item.className = 'file-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'file-name';
      nameSpan.textContent = file.name + ' (' + this.formatSize(file.size) + ')';

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-btn';
      removeBtn.setAttribute('data-index', String(i));
      removeBtn.textContent = '×';
      const idx = i;
      removeBtn.onclick = () => this.removeFile(idx);

      item.appendChild(nameSpan);
      item.appendChild(removeBtn);
      this.fileList.appendChild(item);
    }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  private async handleSubmit(e: Event): Promise<void> {
    e.preventDefault();

    if (this.files.length === 0 && !this.urlsInput.value.trim()) {
      this.showError('Please select at least one file or enter URLs');
      return;
    }

    const postId = this.postIdInput.value.trim();
    const anonymous = (document.getElementById('anonymous') as HTMLInputElement).checked;
    if (postId && anonymous) {
      this.showError('Cannot add images to anonymous posts. Anonymous posts do not support adding images after creation.');
      return;
    }

    this.setLoading(true);
    this.resultsDiv.style.display = 'block';
    this.resultsContent.innerHTML = '<div class="summary warning">Uploading...</div>';
    this.progressDiv.style.display = 'block';
    this.progressFill.style.width = '0%';

    const urls = this.urlsInput.value.trim()
      ? this.urlsInput.value.split(',').map(u => u.trim())
      : [];

    try {
      switch (this.provider) {
        case 'catbox':
          await this.uploadToCatbox(urls);
          break;
        case 'sxcu':
          await this.uploadToSxcu([]);
          break;
        case 'imgchest':
          await this.uploadToImgchest([]);
          break;
        case 'kek':
          await this.uploadToKek(urls);
          break;
      }
    } catch (error) {
      this.showError((error as Error).message);
    } finally {
      this.setLoading(false);
      this.progressDiv.style.display = 'none';
    }
  }

  private makeObserver(totalItems: number, onRateLimitWait: (secondsRemaining: number) => void = () => {}): UploadObserver {
    return {
      onResult: (result, index) => this.addIncrementalResult(result, index),
      onProgress: (percent, label) => this.updateProgress(percent, label),
      onRateLimitWait,
    };
  }

  private updateRateLimitNotice(secondsRemaining: number): void {
    const existingNotice = this.resultsContent.querySelector('#rate-limit-notice');

    if (secondsRemaining <= 0) {
      if (existingNotice) existingNotice.remove();
      return;
    }

    const text = 'Rate limited! Waiting ' + secondsRemaining + 's before next upload...';
    if (existingNotice) {
      existingNotice.textContent = text;
      return;
    }

    const rateLimitNotice = document.createElement('div');
    rateLimitNotice.className = 'result-item warning';
    rateLimitNotice.textContent = text;
    rateLimitNotice.id = 'rate-limit-notice';
    this.resultsContent.insertBefore(rateLimitNotice, this.resultsContent.firstChild);
    rateLimitNotice.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  private async uploadToCatbox(urls: string[]): Promise<void> {
    const input: CatboxUploadInput = {
      apiBaseUrl: this.apiBaseUrl,
      files: this.files,
      urls,
      authHeaders: this.getAuthHeaders(),
      title: this.titleInput.value,
      description: (document.getElementById('description') as HTMLInputElement).value,
      createAlbum: (document.getElementById('createAlbum') as HTMLInputElement).checked,
    };
    const totalItems = this.files.length + urls.length;
    const results = await runCatboxSequencer(input, this.makeObserver(totalItems), window.fetch.bind(window));
    this.displayResults(results, totalItems);
  }


  private async uploadToKek(urls: string[]): Promise<void> {
    const input: KekUploadInput = {
      apiBaseUrl: this.apiBaseUrl,
      files: this.files,
      urls,
      authHeaders: this.getAuthHeaders(),
      apiKey: this.kekApiKeyInput?.value.trim(),
      mature: this.kekMatureCheckbox?.checked ?? false,
    };
    const totalItems = this.files.length + urls.length;
    const results = await runKekSequencer(input, this.makeObserver(totalItems), window.fetch.bind(window));
    this.displayResults(results, totalItems);
  }

  private async uploadToSxcu(_results: UploadResult[]): Promise<void> {
    const input: SxcuUploadInput = {
      apiBaseUrl: this.apiBaseUrl,
      files: this.files,
      urls: [],
      authHeaders: this.getAuthHeaders(),
      title: this.titleInput.value,
      description: (document.getElementById('description') as HTMLInputElement).value,
      createCollection: (document.getElementById('createCollection') as HTMLInputElement).checked,
      private: (document.getElementById('sxcuPrivate') as HTMLInputElement).checked,
    };

    const totalItems = this.files.length;
    const results = await runSxcuSequencer(
      input,
      this.makeObserver(totalItems, secondsRemaining => this.updateRateLimitNotice(secondsRemaining)),
      window.fetch.bind(window),
    );
    this.displayResults(results, totalItems);
  }


  private async uploadToImgchest(_results: UploadResult[]): Promise<void> {
    const input: ImgchestUploadInput = {
      apiBaseUrl: this.apiBaseUrl,
      files: this.files,
      urls: [],
      authHeaders: this.getAuthHeaders(),
      title: this.titleInput.value,
      postId: this.postIdInput.value.trim(),
      anonymous: (document.getElementById('anonymous') as HTMLInputElement).checked,
      privacy: this.imgchestPrivacySelect?.value || 'hidden',
      nsfw: this.imgchestNsfwCheckbox?.checked ?? true,
      apiToken: this.imgchestApiKeyInput?.value.trim(),
    };
    const totalItems = this.files.length;
    const results = await runImgchestSequencer(input, this.makeObserver(totalItems), window.fetch.bind(window));
    this.displayResults(results, totalItems);
  }

  private updateProgress(percent: number, text: string): void {
    this.progressFill.style.width = percent + '%';
    this.progressText.textContent = text;
  }

  private addIncrementalResult(result: UploadResult, index: number): void {
    const item = document.createElement('div');
    item.className = 'result-item ' + result.type;

    if (result.isAlbum || result.isCollection || result.isPost) {
      item.className += ' highlight';
    }

    item.setAttribute('data-result-index', String(index));
    item.id = 'result-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    if (result.type === 'success') {
      if (result.isAlbum) {
        item.textContent = 'Album: ';
        item.appendChild(createSafeLink(result.url || ''));
      } else if (result.isCollection) {
        item.textContent = 'Collection: ';
        item.appendChild(createSafeLink(result.url || ''));
      } else if (result.isPost) {
        item.textContent = 'Post: ';
        item.appendChild(createSafeLink(result.url || ''));
      } else {
        item.appendChild(createSafeLink(result.url || ''));
      }
    } else {
      item.textContent = result.message || '';
    }

    const insertAfterSummary = result.isAlbum || result.isCollection || result.isPost;
    const summaryContainer = this.resultsContent.querySelector('#final-summary');
    const existingItems = this.resultsContent.querySelectorAll('.result-item');

    if (insertAfterSummary) {
      if (summaryContainer?.nextSibling) {
        this.resultsContent.insertBefore(item, summaryContainer.nextSibling);
      } else if (summaryContainer) {
        this.resultsContent.appendChild(item);
      } else if (existingItems.length > 0) {
        this.resultsContent.insertBefore(item, existingItems[0]);
      } else {
        this.resultsContent.appendChild(item);
      }
    } else {
      this.resultsContent.appendChild(item);
    }

    setTimeout(() => {
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }

  private setLoading(loading: boolean): void {
    this.uploadBtn.disabled = loading;
    const btnText = this.uploadBtn.querySelector('.btn-text') as HTMLElement;
    const btnLoading = this.uploadBtn.querySelector('.btn-loading') as HTMLElement;
    btnText.style.display = loading ? 'none' : 'inline';
    btnLoading.style.display = loading ? 'inline' : 'none';
  }

  private displayResults(results: UploadResult[], totalFiles?: number): void {
    this.resultsDiv.style.display = 'block';

    const hasSummary = this.resultsContent.querySelector('.summary');
    if (hasSummary) hasSummary.remove();

    const imageUploads = results.filter(r => r.type === 'success' && !r.isPost && !r.isAlbum && !r.isCollection).length;
    const failed = results.filter(r => r.type === 'error').length;
    const warnings = results.filter(r => r.type === 'warning').length;

    if (imageUploads > 0) {
      this.uploadCompleted = true;
    }

    const filesCount = totalFiles ?? this.files.length;
    const skipped = warnings > 0 ? filesCount - imageUploads : 0;

    let summaryText = 'Successfully uploaded ' + imageUploads + ' out of ' + filesCount + ' files.';
    if (failed > 0) summaryText += ' ' + failed + ' failed.';
    if (skipped > 0) summaryText += ' ' + skipped + ' skipped (anonymous limit).';

    const summary = document.createElement('div');
    summary.className = 'summary ' + (failed > 0 ? 'warning' : 'success');
    summary.textContent = summaryText;

    const summaryContainer = document.createElement('div');
    summaryContainer.id = 'final-summary';
    summaryContainer.appendChild(summary);

    const existingItems = this.resultsContent.querySelectorAll('.result-item');
    this.resultsContent.insertBefore(summaryContainer, existingItems.length > 0 ? existingItems[0] : null);

    const specialIndices: number[] = [];
    const normalIndices: number[] = [];

    for (let i = 0; i < results.length; i++) {
      if (results[i].isAlbum || results[i].isCollection || results[i].isPost) {
        specialIndices.push(i);
      } else {
        normalIndices.push(i);
      }
    }
    const sortedIndices = [...specialIndices, ...normalIndices];

    const newItems: HTMLElement[] = [];

    for (const i of sortedIndices) {
      const result = results[i];
      const existingItem = this.resultsContent.querySelector('[data-result-index="' + i + '"]') as HTMLElement;

      if (!existingItem) {
        const item = document.createElement('div');
        item.className = 'result-item ' + result.type;
        if (result.isAlbum || result.isCollection || result.isPost) {
          item.className += ' highlight';
        }
        item.setAttribute('data-result-index', String(i));

        if (result.type === 'success') {
          if (result.isAlbum) {
            item.textContent = 'Album: ';
            item.appendChild(createSafeLink(result.url || ''));
          } else if (result.isCollection) {
            item.textContent = 'Collection: ';
            item.appendChild(createSafeLink(result.url || ''));
          } else if (result.isPost) {
            item.textContent = 'Post: ';
            item.appendChild(createSafeLink(result.url || ''));
          } else {
            item.appendChild(createSafeLink(result.url || ''));
          }
        } else if (result.type === 'warning') {
          item.textContent = result.message || '';
        } else {
          item.textContent = result.message || '';
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

    for (const item of newItems) {
      this.resultsContent.appendChild(item);
    }

    setTimeout(() => {
      this.resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  private showError(message: string): void {
    this.resultsDiv.style.display = 'block';
    this.resultsContent.innerHTML = '';
    const errorDiv = document.createElement('div');
    errorDiv.className = 'result-item error';
    errorDiv.textContent = message;
    this.resultsContent.appendChild(errorDiv);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ImageUploader();
});
