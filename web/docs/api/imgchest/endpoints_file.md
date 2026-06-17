# File

* * *

## [File Information](https://imgchest.com/docs/api/1.0/endpoints/file\#file-info)

Provides information about a specific file.

| Method | URL |
| --- | --- |
| GET | `https://api.imgchest.com/v1/file/{id}` |

### Example Response

```json
{
    "data": {
        "id": "nw7w6cmlvye",
        "description": "Released in the arcades in 1981, Donkey Kong...",
        "link": "https://cdn.imgchest.com/files/nw7w6cmlvye.png",
        "position": 1,
        "created": "2019-11-03T00:36:00.000000Z"
    }
}
```

## [Update A File](https://imgchest.com/docs/api/1.0/endpoints/file\#update-file)

Allows you to update details for a file. You may only update files that you created.

| Method | URL |
| --- | --- |
| PUT or PATCH | `https://api.imgchest.com/v1/file/{id}` |

### Request Body Parameters

| Key | Description | Required |
| --- | --- | --- |
| description | The description for the file. | Optional |

### Example Response

```json
{
    "success": "true"
}
```

## [Delete A File](https://imgchest.com/docs/api/1.0/endpoints/file\#delete-file)

Deletes a file.

| Method | URL |
| --- | --- |
| DELETE | `https://api.imgchest.com/v1/file/{id}` |

### Example Response

```json
{
    "success": "true"
}
```

## [Bulk File Updates](https://imgchest.com/docs/api/1.0/endpoints/file\#bulk-file-updates)

Allows you to update the details for multiple files. You may only update files that you created.

| Method | URL |
| --- | --- |
| PATCH | `https://api.imgchest.com/v1/files` |

### Request Body Parameters

The body of this request needs to be a data array with objects for each file you'd like to update. Each object should contain the following keys: `id`, `description`.

| Key | Description | Required |
| --- | --- | --- |
| id | The ID of the file. | Required |
| description | The description for the file. | Required, Nullable |

### Example Request Body

```json
{
    "data": [
        {
            "id": "nw7w6cmlvye",
            "description": "Released in the arcades in 1981, Donkey Kong..."
        },
        {
            "id": "kwye3cpag4b",
            "description": "Mario's character design, particularly his large nose, draws on western influences;"
        }
    ]
}
```

### Example Response

```json
{
    "data": [
        {
            "id": "nw7w6cmlvye",
            "description": "Released in the arcades in 1981, Donkey Kong...",
            "link": "https://cdn.imgchest.com/files/nw7w6cmlvye.png",
            "position": 1,
            "created": "2019-11-03T00:36:00.000000Z"
        },
        {
            "id": "kwye3cpag4b",
            "description": "Mario's character design, particularly his large nose, draws on western influences;",
            "link": "https://cdn.imgchest.com/files/kwye3cpag4b.png",
            "position": 2,
            "created": "2019-11-03T00:36:00.000000Z"
        }
    ]
}
```
