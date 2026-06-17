# Post

* * *

## [Post Information](https://imgchest.com/docs/api/1.0/endpoints/post\#post-info)

Provides information about a specific post.

| Method | URL |
| --- | --- |
| GET | `https://api.imgchest.com/v1/post/{id}` |

### Example Response

> If the post you are retrieving is your own, you will also be provided with a _delete\_url_ parameter for the post, as well as _original\_name_ for each image.

```json
{
    "data": {
        "id": "3qe4gdvj4j2",
        "title": "Donkey Kong - Video Game From The Mid 80's",
        "username": "LunarLandr",
        "privacy": "public",
        "report_status": 1,
        "views": 198,
        "nsfw": 0,
        "image_count": 4,
        "created": "2019-11-03T00:36:00.000000Z",
        "images": [
            {
                "id": "nw7w6cmlvye",
                "description": "Released in the arcades in 1981, Donkey Kong...",
                "link": "https://cdn.imgchest.com/files/nw7w6cmlvye.png",
                "position": 1,
                "created": "2019-11-03T00:36:00.000000Z"
            },
            {
                "id": "kwye3cpag4b",
                "description": null,
                "link": "https://cdn.imgchest.com/files/kwye3cpag4b.png",
                "position": 2,
                "created": "2019-11-03T00:36:00.000000Z"
            },
            {
                "id": "5g4z9c8ok72",
                "description": null,
                "link": "https://cdn.imgchest.com/files/5g4z9c8ok72.png",
                "position": 3,
                "created": "2019-11-03T00:36:00.000000Z"
            },
            {
                "id": "we4gdcv5j4r",
                "description": null,
                "link": "https://cdn.imgchest.com/files/we4gdcv5j4r.jpg",
                "position": 4,
                "created": "2019-11-03T00:36:00.000000Z"
            }
        ]
    }
}
```

## [Create A Post](https://imgchest.com/docs/api/1.0/endpoints/post\#create-post)

Allows you to create a new post.

| Method | URL |
| --- | --- |
| POST | `https://api.imgchest.com/v1/post` |

### Request Body Parameters

| Key | Description | Required |
| --- | --- | --- |
| title | The title of the post | Optional |
| privacy | The privacy setting of your post. Values are _public_, _hidden_ or _secret_. Default is hidden. | Optional |
| anonymous | This parameter can be true or false. If you do not want your post to not be tied to your user, simply set this parameter as true. | Optional |
| nsfw | This parameter can be true or false. | Optional |
| images\[\] | This can be one file or many. Limit 20 | Required |

### Example Response

> Although not shown, you will also be provided with a _delete\_url_ parameter for the post, as well as the _original\_name_ for each image.

```json
{
    "data": {
        "id": "3qe4gdvj4j2",
        "title": "Donkey Kong - Video Game From The Mid 80's",
        "username": "LunarLandr",
        "privacy": "public",
        "report_status": 1,
        "views": 198,
        "nsfw": 0,
        "image_count": 4,
        "created": "2019-11-03T00:36:00.000000Z",
        "images": [
            {
                "id": "nw7w6cmlvye",
                "description": "Released in the arcades in 1981, Donkey Kong...",
                "link": "https://cdn.imgchest.com/files/nw7w6cmlvye.png",
                "position": 1,
                "created": "2019-11-03T00:36:00.000000Z"
            },
            {
                "id": "kwye3cpag4b",
                "description": null,
                "link": "https://cdn.imgchest.com/files/kwye3cpag4b.png",
                "position": 2,
                "created": "2019-11-03T00:36:00.000000Z"
            },
            {
                "id": "5g4z9c8ok72",
                "description": null,
                "link": "https://cdn.imgchest.com/files/5g4z9c8ok72.png",
                "position": 3,
                "created": "2019-11-03T00:36:00.000000Z"
            },
            {
                "id": "we4gdcv5j4r",
                "description": null,
                "link": "https://cdn.imgchest.com/files/we4gdcv5j4r.jpg",
                "position": 4,
                "created": "2019-11-03T00:36:00.000000Z"
            }
        ]
    }
}
```

## [Update A Post](https://imgchest.com/docs/api/1.0/endpoints/post\#update-post)

Allows you to update details for a post. You may only update posts that you created.

| Method | URL |
| --- | --- |
| PUT or PATCH | `https://api.imgchest.com/v1/post/{id}` |

### Request Body Parameters

| Key | Description | Required |
| --- | --- | --- |
| title | The title of the post | Optional |
| privacy | The privacy setting of your post. Values are _public_, _hidden_ or _secret_. | Optional |
| nsfw | This parameter can be true or false. | Optional |

### Example Response

```json
{
    "data": {
        "id": "3qe4gdvj4j2",
        "title": "Donkey Kong - Video Game From The Mid 80's",
        "username": "LunarLandr",
        "privacy": "public",
        "report_status": 1,
        "views": 198,
        "nsfw": 0,
        "image_count": 4,
        "created": "2019-11-03T00:36:00.000000Z",
        "images": [
            {
                "id": "nw7w6cmlvye",
                "description": "Released in the arcades in 1981, Donkey Kong...",
                "link": "https://cdn.imgchest.com/files/nw7w6cmlvye.png",
                "position": 1,
                "created": "2019-11-03T00:36:00.000000Z"
            },
            {
                "id": "kwye3cpag4b",
                "description": null,
                "link": "https://cdn.imgchest.com/files/kwye3cpag4b.png",
                "position": 2,
                "created": "2019-11-03T00:36:00.000000Z"
            },
            {
                "id": "5g4z9c8ok72",
                "description": null,
                "link": "https://cdn.imgchest.com/files/5g4z9c8ok72.png",
                "position": 3,
                "created": "2019-11-03T00:36:00.000000Z"
            },
            {
                "id": "we4gdcv5j4r",
                "description": null,
                "link": "https://cdn.imgchest.com/files/we4gdcv5j4r.jpg",
                "position": 4,
                "created": "2019-11-03T00:36:00.000000Z"
            }
        ]
    }
}
```

## [Delete A Post](https://imgchest.com/docs/api/1.0/endpoints/post\#delete-post)

Deletes a post and all associated files, comments, and ratings.

> You may provide either the post id or deletion url id.

| Method | URL |
| --- | --- |
| DELETE | `https://api.imgchest.com/v1/post/{id}` |

### Example Response

```json
{
    "success": "true"
}
```

## [Favorite A Post](https://imgchest.com/docs/api/1.0/endpoints/post\#favorite-post)

Either adds or removes a post from the user's favorites.

| Method | URL |
| --- | --- |
| POST | `https://api.imgchest.com/v1/post/{id}/favorite` |

### Example Response

```json
{
    "success": "true",
    "message": "Favorite added."
}
```

## [Add Images To A Post](https://imgchest.com/docs/api/1.0/endpoints/post\#add-images)

Adds images to an existing post.

| Method | URL |
| --- | --- |
| POST | `https://api.imgchest.com/v1/post/{id}/add` |

### Request Body Parameters

| Key | Description | Required |
| --- | --- | --- |
| images\[\] | This can be one file or many. Limit 20 | Required |

### Example Response

```json
{
    "data": {
        "id": "3qe4gdvj4j2",
        "title": "Donkey Kong - Video Game From The Mid 80's",
        "username": "LunarLandr",
        "privacy": "public",
        "report_status": 1,
        "views": 198,
        "nsfw": 0,
        "image_count": 4,
        "created": "2019-11-03T00:36:00.000000Z",
        "images": [
            {
                "id": "nw7w6cmlvye",
                "description": "Released in the arcades in 1981, Donkey Kong...",
                "link": "https://cdn.imgchest.com/files/nw7w6cmlvye.png",
                "position": 1,
                "created": "2019-11-03T00:36:00.000000Z"
            },
            {
                "id": "kwye3cpag4b",
                "description": null,
                "link": "https://cdn.imgchest.com/files/kwye3cpag4b.png",
                "position": 2,
                "created": "2019-11-03T00:36:00.000000Z"
            },
            {
                "id": "5g4z9c8ok72",
                "description": null,
                "link": "https://cdn.imgchest.com/files/5g4z9c8ok72.png",
                "position": 3,
                "created": "2019-11-03T00:36:00.000000Z"
            },
            {
                "id": "we4gdcv5j4r",
                "description": null,
                "link": "https://cdn.imgchest.com/files/we4gdcv5j4r.jpg",
                "position": 4,
                "created": "2019-11-03T00:36:00.000000Z"
            }
        ]
    }
}
```
