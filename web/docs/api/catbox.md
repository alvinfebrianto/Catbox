# API

The API is located at https://catbox.moe/user/api.php

There are 8 different "request types" that are valid to the Catbox API. 3 of them are for files, the other 5 are for albums. Italicized arguments are optional. Obviously the actual order of the variables doesn't matter, but for sensibility you should keep them as so.

## File uploads

Note: for anonymous uploads, simply don't supply a userhash.

**File Uploads**

```
reqtype="fileupload"    *userhash="####"*    fileToUpload=(file data here)
```

**URL Uploads**

```
reqtype="urlupload"    *userhash="####"*    url="http://i.imgur.com/aksF5Gk.jpg"
```

## Deleting Files

**Deleting Files**

```
reqtype="deletefiles"    userhash="####"    files="eh871k.png d9pove.gif"
```

## Album Management

For an anonymous album, don't give a userhash. Albums created anonymously CANNOT be edited or deleted. Albums are currently limited to 500 files. This may be removed in the future.

**Creating an album**

```
reqtype="createalbum"    userhash="####"    title="Title Here"    desc="*Description Here*"    files="8ce67f.jpg f51d7d.jpg 65ea43.jpg"
```

The `files` argument should be SINGLE SPACE SEPARATED FILES which exist on Catbox. Duplicate file entries in the file argument will be removed, but please don't do that anyway.

**Editing an album**

```
reqtype="editalbum"    userhash="####"    short="pd412w"    title="Title Here"    desc="Description Here"    files="8ce67f.jpg f51d7d.jpg 65ea43.jpg"
```

**EDITALBUM IS A VERY POWERFUL REQUEST TYPE.** You **MUST** supply every argument, or else it will be taken as "". Think of it as a direct input.

The "short" is the 6 alphanumeric characters in the url that's generated. If you want to easily add or remove files, use the following two request types.

**Adding files to an album**

```
reqtype="addtoalbum"    userhash="####"    short="pd412w"    files="8ce67f.jpg f51d7d.jpg 65ea43.jpg"
```

**Removing files from an album**

```
reqtype="removefromalbum"    userhash="####"    short="pd412w"    files="8ce67f.jpg f51d7d.jpg 65ea43.jpg"
```

**Deleting an album**

```
reqtype="deletealbum"    userhash="####"    short="pd412w"
```

## cURL to API

If you want to make curl requests to the API, here are examples of both.

```sh
curl -F "reqtype=urlupload" -F "userhash=####" -F "url=https://files.catbox.moe/174bac.jpg" https://catbox.moe/user/api.php
```

```sh
curl -F "reqtype=fileupload" -F "userhash=####" -F "fileToUpload=@cutie.png" https://catbox.moe/user/api.php
```
