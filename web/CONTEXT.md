# Image Uploader

## Glossary

### Provider
One of the image/file hosting services supported by this application: catbox.moe, sxcu.net, imgchest.com, kek.sh. The user selects a provider before uploading.

### Upload (file upload)
Sending a local file to a provider's API via multipart form-data with the file content attached directly.

### Upload (URL upload)
Sending a remote URL to a provider's API, where the provider fetches the file from the URL on the user's behalf. The application proxies the URL to the provider. No file content passes through the application server.

### URL Group
The `#urlGroup` element in the HTML form: a comma-separated text input for entering remote URLs to upload. Used by catbox and kek providers.

### API Key
Authentication credential for provider APIs. Can be set per-provider in the UI (stored in sessionStorage) or via environment variables (`KEK_API_KEY`, `IMGCHEST_API_TOKEN`).

### Rate Limiting
Exponential backoff retry logic applied to failed upload requests (429 responses). Shared between file and URL uploads for the same provider.

### File Validation
Extension and size checks applied client-side before upload. For URL uploads, only URL format validation (valid HTTP/HTTPS URL) is performed.

### Mature Flag (kek)
A boolean NSFW/content flag settable on kek.sh posts. The app sets it after upload via `PUT /posts/:id/mature`. Defaults to `true` (mature) with an optional UI checkbox to opt out.
