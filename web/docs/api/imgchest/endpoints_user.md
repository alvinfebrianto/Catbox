# User

* * *

## [Current User Information](https://imgchest.com/docs/api/1.0/endpoints/user\#current-user-info)

Retrieves information about the authenticated user.

| Method | URL |
| --- | --- |
| GET | `https://api.imgchest.com/v1/users/me` |

### Example Response

Returns comprehensive information about the authenticated user:

```json
{
    "data": {
        "id": 123,
        "name": "YourUsername",
        "email": "user@example.com",
        "email_verified": true,
        "biography": "A brief description about myself",
        "avatar_url": "https://cdn.imgchest.com/files/avatar/user_avatar.png",
        "role_id": 0,
        "allow_nsfw": false,
        "show_nsfw_media": false,
        "email_notifications": true,
        "email_promotions": false,
        "posts": 247,
        "comments": 152,
        "favorites": 89,
        "post_views": 125000,
        "created_at": "2019-09-25T01:00:45.000000Z",
        "updated_at": "2024-12-15T14:30:00.000000Z",
        "experience": {
            "points": 1250,
            "level": 15
        },
        "achievements": 8,
        "is_subscribed": false
    }
}
```

## [User Information](https://imgchest.com/docs/api/1.0/endpoints/user\#user-info)

Provides information about a specific user.

| Method | URL |
| --- | --- |
| GET | `https://api.imgchest.com/v1/user/{username}` |

### Behavior

- **Viewing your own profile:** Returns all public data plus private settings (email, preferences).
- **Viewing another user's profile:** Returns only public information.

### Example Response - Own Profile

When viewing your own profile, you get additional private data:

```json
{
    "data": {
        "name": "YourUsername",
        "biography": "A brief description about myself",
        "avatar_url": "https://cdn.imgchest.com/files/avatar/user_avatar.png",
        "posts": 247,
        "comments": 152,
        "favorites": 89,
        "post_views": "125000",
        "created": "2019-09-25T01:00:45.000000Z",
        "experience": {
            "points": 1250,
            "level": 15
        },
        "achievements": 8,
        "email": "user@example.com",
        "email_verified": true,
        "allow_nsfw": false,
        "show_nsfw_media": false,
        "email_notifications": true,
        "email_promotions": false
    }
}
```

### Example Response - Other User's Profile

When viewing another user's profile, only public information is shown:

```json
{
    "data": {
        "name": "LunarLandr",
        "biography": "Retro gaming enthusiast",
        "avatar_url": "https://cdn.imgchest.com/files/avatar/lunar_avatar.png",
        "posts": 247,
        "comments": 89,
        "favorites": 156,
        "post_views": "87500",
        "created": "2019-09-25T01:00:45.000000Z",
        "experience": {
            "points": 950,
            "level": 12
        },
        "achievements": 5
    }
}
```

## [User Posts](https://imgchest.com/docs/api/1.0/endpoints/user\#user-posts)

Retrieves a paginated list of posts for a specific user.

| Method | URL |
| --- | --- |
| GET | `https://api.imgchest.com/v1/user/{username}/posts` |

### Behavior

- **Viewing your own posts:** Returns all posts regardless of privacy settings (public, hidden, secret).
- **Viewing another user's posts:** Returns only public posts. NSFW posts are filtered based on your account's NSFW preferences.

### Query Parameters

| Parameter | Description | Default |
| --- | --- | --- |
| per\_page | Number of posts per page (max 100) | 15 |
| sort | Sort order: `new`, `old`, or `views` | new |

### Example Response - Own Posts

When viewing your own posts, you get the same simplified format as other endpoints:

```json
{
    "data": [
        {
            "id": "3qe4gdvj4j2",
            "title": "My Private Gallery",
            "slug": "3qe4gdvj4j2",
            "link": "https://imgchest.com/p/3qe4gdvj4j2",
            "nsfw": 0,
            "score": 15,
            "comments": 3,
            "views": 42,
            "thumbnail": {
                "id": "nw7w6cmlvye",
                "description": "First image",
                "link": "https://cdn.imgchest.com/files/thumb/nw7w6cmlvye.png",
                "mp4": 0,
                "position": 1,
                "mime_type": "image/png",
                "nsfw": false
            }
        }
    ],
    "links": {
        "first": "https://api.imgchest.com/v1/user/YourUsername/posts?page=1",
        "last": "https://api.imgchest.com/v1/user/YourUsername/posts?page=5",
        "prev": null,
        "next": "https://api.imgchest.com/v1/user/YourUsername/posts?page=2"
    },
    "meta": {
        "current_page": 1,
        "from": 1,
        "last_page": 5,
        "path": "https://api.imgchest.com/v1/user/YourUsername/posts",
        "per_page": 15,
        "to": 15,
        "total": 73
    }
}
```

### Example Response - Other User's Posts

When viewing another user's posts, only public posts are shown in the same simplified format:

```json
{
    "data": [
        {
            "id": "3qe4gdvj4j2",
            "title": "Donkey Kong - Video Game From The Mid 80's",
            "slug": "3qe4gdvj4j2",
            "link": "https://imgchest.com/p/3qe4gdvj4j2",
            "nsfw": 0,
            "score": 125,
            "comments": 8,
            "views": 1523,
            "thumbnail": {
                "id": "nw7w6cmlvye",
                "description": "Released in the arcades in 1981...",
                "link": "https://cdn.imgchest.com/files/thumb/nw7w6cmlvye.png",
                "mp4": 0,
                "position": 1,
                "mime_type": "image/png",
                "nsfw": false
            }
        }
    ],
    "links": {
        "first": "https://api.imgchest.com/v1/user/LunarLandr/posts?page=1",
        "last": "https://api.imgchest.com/v1/user/LunarLandr/posts?page=10",
        "prev": null,
        "next": "https://api.imgchest.com/v1/user/LunarLandr/posts?page=2"
    },
    "meta": {
        "current_page": 1,
        "from": 1,
        "last_page": 10,
        "path": "https://api.imgchest.com/v1/user/LunarLandr/posts",
        "per_page": 15,
        "to": 15,
        "total": 147
    }
}
```
