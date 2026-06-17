# SXCU API

The API is located at https://sxcu.net/api

Clients must provide a valid `User-Agent` header in the format `sxcuUploader/$versionNumber (+$url)`.

## Snowflakes

IDs use a customized Twitter snowflake format. They are base-63 encoded strings (up to 53 bits).

### Snowflake ID Format

| Field | Bits | Description |
|-------|------|-------------|
| Timestamp | 53 to 22 (31 bits) | Seconds since sxcu.net epoch (1326466131) |
| Object type | 21 to 18 (4 bits) | Type of object |
| Object flag | 17 to 14 (4 bits) | File type when object type is 1 |
| Sequence | 13 to 0 (14 bits) | Incremented per ID in same second |

### Object Types

| Value | Type |
|-------|------|
| 1 | Uploaded file |
| 2 | Redirect (link) |
| 3 | Collection |
| 4 | Paste (cancer-co.de) |
| 5 | Subdomain/domain (internal) |
| 6 | Self-destructing file |

### Object Flags (file types)

| Value | Type |
|-------|------|
| 1 | png |
| 2 | jpeg |
| 3 | gif |
| 4 | ico |
| 5 | bmp |
| 6 | tiff |
| 7 | webm |
| 8 | webp |

## Error Reference

Errors return HTTP 400 with an internal `code` and `error` message. Rate limits return HTTP 429.

### Global API Errors

| Error | Message |
|-------|---------|
| 02 | Global rate limit exceeded |
| 03 | Cannot call API via this domain |

## Rate Limits

- **Global**: 240 requests per minute
- **Per-route**: Varies by endpoint; exposed via `X-RateLimit-Bucket` header

### Rate Limit Headers

| Header | Description |
|--------|-------------|
| X-RateLimit-Global | Present on HTTP 429 when global limit hit |
| X-RateLimit-Limit | Max requests allowed |
| X-RateLimit-Remaining | Requests remaining |
| X-RateLimit-Reset | Epoch timestamp when limit resets |
| X-RateLimit-Reset-After | Seconds until bucket resets |
| X-RateLimit-Bucket | Unique bucket identifier |

## Files

### Upload new file

```
POST /api/files/create
Content-Type: multipart/form-data
Rate limit: 3 req./min.
```

Max file size: 95 MB. Allowed types: png, gif, jpeg, ico, bmp, tiff, webm, webp.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| file | file | yes | The file to upload |
| token | string | no | Subdomain upload token |
| collection | snowflake | no | Collection ID to upload to |
| collection_token | string | no | Collection upload token |
| noembed | void | no | If present, returns direct file URL instead of page |
| self_destruct | void | no | File auto-deletes after 24 hours |
| og_properties | string | no | JSON object for OpenGraph meta tags |

**OG Properties** (JSON object):

| Name | Type | Description |
|------|------|-------------|
| title | string \| boolean | OpenGraph title (false to omit) |
| description | string \| boolean | OpenGraph description (false to omit) |
| color | string \| boolean | HEX color for theme-color (false to omit) |
| site_name | string \| boolean | OpenGraph site name (false to omit) |
| discord_hide_url | boolean | If false, prevents Discord from hiding URL |

**Response (200)**:
```json
{
    "id": "snowflake",
    "url": "https://sxcu.net/...",
    "del_url": "https://sxcu.net/...",
    "thumb": "https://sxcu.net/..."
}
```

**Error codes (400)**:

| Error | Message |
|-------|---------|
| 801 | File type not allowed |
| 802 | Internal upload error 101x |
| 803 | User-agent header not set |
| 804 | File is over max size limit |
| 805 | File is under min size limit |
| 806 | Malformed JSON in OG properties |
| 807 | og_properties object too long |
| 808 | Subdomain is private, token required |
| 809 | Invalid upload token |
| 810 | Invalid collection token |
| 811 | Collection is private, token required |
| 812 | Collection not found |
| 813 | Unknown upload error |
| 814 | No file sent |
| 815 | Rate limit exceeded (429) |

### Get file meta

```
GET /api/files/{fileId}
```

**Response (200)**:
```json
{
    "id": "snowflake",
    "url": "https://sxcu.net/...",
    "views": 0,
    "viewable": true,
    "collection": "snowflake|null",
    "size": 12345,
    "creation_time": 1626000000,
    "og_properties": [
        {
            "color": "#7289DA",
            "title": "...",
            "description": "...",
            "discord_hide_url": false
        }
    ]
}
```

**Error codes (400)**:

| Error | Message |
|-------|---------|
| 71 | Requested file not found |
| 72 | File ID not sent |

### Delete file

```
GET /api/files/delete/{fileId}/{deletionToken}
Rate limit: 3 req./min.
```

**Response (200)**:
```json
{
    "message": "File deleted successfully"
}
```

**Error codes (400)**:

| Error | Message |
|-------|---------|
| 101 | Link not found |
| 102 | File not found |
| 103 | Missing object ID or deletion token |
| 104 | Rate limit exceeded (429) |

## Subdomains

### List subdomains

```
GET /api/subdomains
```

**Response (200)**:
```json
{
    "domain": "example",
    "upload_count": 10,
    "public": true,
    "file_views": 1000
}
```

### Get subdomain meta

```
GET /api/subdomains/{subdomain}
```

**Response (200)**:
```json
{
    "id": "snowflake",
    "files": 10,
    "links": 5,
    "file_views": 1000,
    "public": true,
    "root": false,
    "last_activity": 1626000000
}
```

**Error codes (400)**:

| Error | Message |
|-------|---------|
| 401 | No subdomain provided |
| 402 | Subdomain not found |

### Check if subdomain exists

```
GET /api/subdomains/check/{subdomain}
```

**Response (200)**:
```json
{
    "exists": true
}
```

**Error codes (400)**:

| Error | Message |
|-------|---------|
| 31 | Subdomain not provided |

## Collections

### Create new collection

```
POST /api/collections/create
Content-Type: application/x-www-form-urlencoded
Rate limit: 2 req./min.
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| title | string | yes | Title (max 250 chars) |
| desc | string | no | Description (max 2000 chars) |
| private | boolean | yes | Whether collection is private |
| unlisted | string | yes | Whether collection is unlisted |

**Response (200)**:
```json
{
    "collection_id": "snowflake",
    "title": "My Collection",
    "description": "...",
    "unlisted": false,
    "private": true,
    "collection_token": "..." // present if private=true
}
```

**Error codes (400)**:

| Error | Message |
|-------|---------|
| 11 | Title not provided |
| 12 | Privacy setting not provided |
| 13 | Unlisted parameter not provided |
| 16 | Error creating collection |
| 17 | Title too long |
| 18 | Description too long |
| 19 | Rate limit exceeded (429) |

### Get collection meta

```
GET /api/collections/{collectionId}
```

**Response (200)**:
```json
{
    "id": "snowflake",
    "title": "My Collection",
    "desc": "...",
    "views": 0,
    "creation_time": 1626000000,
    "public": true,
    "unlisted": false,
    "file_views": 0,
    "files": [
        {
            "id": "snowflake",
            "url": "https://sxcu.net/...",
            "thumb": "https://sxcu.net/...",
            "views": 0
        }
    ]
}
```

**Error codes (400)**:

| Error | Message |
|-------|---------|
| 301 | Collection not found |
| 302 | No collection ID provided |

## Links

### Create link redirect

```
POST /api/links/create
Content-Type: application/x-www-form-urlencoded
Rate limit: 3 req./min.
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| link | url | yes | Redirect URL (max 1500 chars) |

**Response (200)**:
```json
{
    "url": "https://sxcu.net/...",
    "del_url": "https://sxcu.net/..."
}
```

**Error codes (400)**:

| Error | Message |
|-------|---------|
| 51 | No URL parameter sent |
| 52 | URL parameter too long |
| 53 | Rate limit exceeded (429) |

### Delete link redirect

```
GET /api/links/delete/{linkId}/{deletionToken}
Rate limit: 3 req./min.
```

**Response (200)**:
```json
{
    "message": "Link deleted successfully"
}
```

**Error codes (400)**: Same as file delete (101-104).

## Text (cancer-co.de)

### Create paste

```
POST https://cancer-co.de/upload
Content-Type: application/x-www-form-urlencoded
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| text | string | yes | Text content (max 8,000,000 chars) |

**Response (200)**:
```json
{
    "url": "https://cancer-co.de/...",
    "del_url": "https://cancer-co.de/..."
}
```

**Error codes (400)**:

| Error | Message |
|-------|---------|
| 61 | Text is too long |
| 62 | No text sent |

### Delete paste

```
GET https://cancer-co.de/d/{pasteId}/{deletionToken}
```

**Response (200)**:
```json
{
    "message": "Paste deleted successfully"
}
```

**Error codes (400)**:

| Error | Message |
|-------|---------|
| 63 | Paste document not found |
| 64 | Missing document ID or deletion token |
