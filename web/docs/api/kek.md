# KEK API

### Overview

To start using our API you will need an API key, which you can grab from [this](https://kek.sh/settings/api) page after creating an account.

Once you've grabbed your key, you are ready to go.

`api base url` `https://kek.sh/api/v1`

### Authentication

Simply add the `x-kek-auth` header to your request, the value should be your API key.

### Creating a new post

You can create a new post by either uploading a file, or posting a valid URL pointing to it.

`endpoint` `/posts`

`method` `POST`

**File**

```bash
curl -X POST 'https://kek.sh/api/v1/posts' \
 -H 'x-kek-auth: <YOUR API KEY>' \
 -F 'file=@/path/to/file.png'
```

**URL (form)**

```bash
curl -X POST 'https://kek.sh/api/v1/posts' \
 -H 'x-kek-auth: <YOUR API KEY>' \
 -d 'url=https://example.com/image.png'
```

**URL (json)**

```bash
curl -X POST 'https://kek.sh/api/v1/posts' \
 -H 'x-kek-auth: <YOUR API KEY>' \
 -H 'Content-Type: application/json' \
 -d '{ "url": "https://example.com/image.png" }'
```

### Deleting a post

You can delete any of your posts with a simple delete request. Keep in mind, once you delete a post it's gone forever.

`endpoint` `/posts/:id`

`method` `DELETE`

```bash
curl -X DELETE 'https://kek.sh/api/v1/posts/<id>' \
 -H 'x-kek-auth: <YOUR API KEY>'
```

### Setting post publicity/maturity

You can set your post public or private if your plan allows it. You can check your current plan [here](https://kek.sh/pricing).

Changing the maturity of a post is always possible.

`endpoint` `/posts/:id/{public|mature}`

`method` `PUT`

```bash
curl -X PUT 'https://kek.sh/api/v1/posts/<id>/public' \
 -H 'x-kek-auth: <YOUR API KEY>' \
 -d '{ "value": false }'
```

### Get posts

You can list your posts by `descending` order. By default it will return maximum 48 posts. If you want to get more, use the `from` query parameter with the value of the last returned post's ID.

`endpoint` `/posts`

`method` `GET`

`query` `from` `number, optional`

```bash
curl 'https://kek.sh/api/v1/posts?from=123' \
 -H 'x-kek-auth: <YOUR API KEY>'
```

### Clear storage

This will purge your whole storage. There's no going back from this one, use with caution!

`endpoint` `/posts`

`method` `DELETE`

```bash
curl -X DELETE 'https://kek.sh/api/v1/posts' \
 -H 'x-kek-auth: <YOUR API KEY>'
```
