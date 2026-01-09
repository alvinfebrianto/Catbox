const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS, status: 204 });
    }

    if (method === "POST" && path === "/upload/catbox") {
      return handleCatboxUpload(request);
    }
    if (method === "POST" && path === "/upload/sxcu/collections") {
      return handleSxcuCollections(request);
    }
    if (method === "POST" && path === "/upload/sxcu/files") {
      return handleSxcuFiles(request);
    }
    if (method === "POST" && path === "/upload/imgchest/post") {
      return handleImgchestPost(request, env);
    }
    if (method === "POST" && path.startsWith("/upload/imgchest/post/") && path.endsWith("/add")) {
      return handleImgchestAdd(request, env);
    }

    return new Response("Not Found", { status: 404 });
  }
};

async function handleCatboxUpload(request) {
  try {
    const formData = await request.formData();
    const reqtype = formData.get("reqtype");

    if (!reqtype) {
      return new Response("Missing reqtype parameter", {
        headers: CORS_HEADERS,
        status: 400
      });
    }

    const validTypes = ['fileupload', 'urlupload', 'deletefiles', 'createalbum', 'editalbum', 'addtoalbum', 'removefromalbum', 'deletealbum'];
    if (!validTypes.includes(reqtype)) {
      return new Response("Invalid reqtype: " + reqtype, {
        headers: CORS_HEADERS,
        status: 400
      });
    }

    const catboxFormData = new FormData();
    
    switch(reqtype) {
      case 'fileupload':
        const fileToUpload = formData.get("fileToUpload");
        if (!fileToUpload) {
          return new Response("Missing fileToUpload parameter", {
            headers: CORS_HEADERS,
            status: 400
          });
        }
        catboxFormData.append("reqtype", "fileupload");
        catboxFormData.append("fileToUpload", fileToUpload);
        
        const userhashFile = formData.get("userhash");
        if (userhashFile) {
          catboxFormData.append("userhash", userhashFile);
        }
        break;

      case 'urlupload':
        const url = formData.get("url");
        if (!url) {
          return new Response("Missing url parameter", {
            headers: CORS_HEADERS,
            status: 400
          });
        }
        catboxFormData.append("reqtype", "urlupload");
        catboxFormData.append("url", url);
        
        const userhashUrl = formData.get("userhash");
        if (userhashUrl) {
          catboxFormData.append("userhash", userhashUrl);
        }
        break;

      case 'deletefiles':
        const filesToDelete = formData.get("files");
        if (!filesToDelete) {
          return new Response("Missing files parameter", {
            headers: CORS_HEADERS,
            status: 400
          });
        }
        catboxFormData.append("reqtype", "deletefiles");
        catboxFormData.append("files", filesToDelete);
        
        const userhashDelete = formData.get("userhash");
        if (userhashDelete) {
          catboxFormData.append("userhash", userhashDelete);
        }
        break;

      case 'createalbum':
        const albumFiles = formData.get("files");
        if (!albumFiles) {
          return new Response("Missing files parameter for album", {
            headers: CORS_HEADERS,
            status: 400
          });
        }
        catboxFormData.append("reqtype", "createalbum");
        catboxFormData.append("title", formData.get("title") || "");
        catboxFormData.append("desc", formData.get("desc") || "");
        catboxFormData.append("files", albumFiles);
        
        const userhashAlbum = formData.get("userhash");
        if (userhashAlbum) {
          catboxFormData.append("userhash", userhashAlbum);
        }
        break;

      case 'editalbum':
        const editShort = formData.get("short");
        if (!editShort) {
          return new Response("Missing short parameter for album edit", {
            headers: CORS_HEADERS,
            status: 400
          });
        }
        catboxFormData.append("reqtype", "editalbum");
        catboxFormData.append("short", editShort);
        catboxFormData.append("title", formData.get("title") || "");
        catboxFormData.append("desc", formData.get("desc") || "");
        catboxFormData.append("files", formData.get("files") || "");
        
        const userhashEdit = formData.get("userhash");
        if (userhashEdit) {
          catboxFormData.append("userhash", userhashEdit);
        }
        break;

      case 'addtoalbum':
        const addShort = formData.get("short");
        if (!addShort) {
          return new Response("Missing short parameter", {
            headers: CORS_HEADERS,
            status: 400
          });
        }
        const addFiles = formData.get("files");
        if (!addFiles) {
          return new Response("Missing files parameter", {
            headers: CORS_HEADERS,
            status: 400
          });
        }
        catboxFormData.append("reqtype", "addtoalbum");
        catboxFormData.append("short", addShort);
        catboxFormData.append("files", addFiles);
        
        const userhashAdd = formData.get("userhash");
        if (userhashAdd) {
          catboxFormData.append("userhash", userhashAdd);
        }
        break;

      case 'removefromalbum':
        const removeShort = formData.get("short");
        if (!removeShort) {
          return new Response("Missing short parameter", {
            headers: CORS_HEADERS,
            status: 400
          });
        }
        const removeFiles = formData.get("files");
        if (!removeFiles) {
          return new Response("Missing files parameter", {
            headers: CORS_HEADERS,
            status: 400
          });
        }
        catboxFormData.append("reqtype", "removefromalbum");
        catboxFormData.append("short", removeShort);
        catboxFormData.append("files", removeFiles);
        
        const userhashRemove = formData.get("userhash");
        if (userhashRemove) {
          catboxFormData.append("userhash", userhashRemove);
        }
        break;

      case 'deletealbum':
        const deleteShort = formData.get("short");
        if (!deleteShort) {
          return new Response("Missing short parameter", {
            headers: CORS_HEADERS,
            status: 400
          });
        }
        catboxFormData.append("reqtype", "deletealbum");
        catboxFormData.append("short", deleteShort);
        
        const userhashDeleteAlbum = formData.get("userhash");
        if (userhashDeleteAlbum) {
          catboxFormData.append("userhash", userhashDeleteAlbum);
        }
        break;
    }

    const response = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: catboxFormData,
      headers: {
        "User-Agent": "CatboxUploader/1.0"
      }
    });

    const text = await response.text();
    return new Response(text, {
      headers: CORS_HEADERS,
      status: response.ok ? 200 : response.status
    });

  } catch (error) {
    return new Response("Upload failed: " + error.message, {
      headers: CORS_HEADERS,
      status: 500
    });
  }
}

async function handleSxcuCollections(request) {
  const formData = await request.formData();
  const response = await fetch("https://sxcu.net/api/collections/create", {
    method: "POST",
    body: formData,
    headers: { "User-Agent": "sxcuUploader/1.0" },
  });
  const json = await response.json();
  const responseHeaders = new Headers({ ...CORS_HEADERS, "Content-Type": "application/json" });
  const rateLimitHeaders = ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "X-RateLimit-Reset-After", "X-RateLimit-Bucket", "X-RateLimit-Global"];
  rateLimitHeaders.forEach(h => {
    if (response.headers.get(h)) responseHeaders.set(h, response.headers.get(h));
  });
  return new Response(JSON.stringify(json), {
    headers: responseHeaders,
    status: response.ok ? 200 : response.status,
  });
}

async function handleSxcuFiles(request) {
  const formData = await request.formData();
  const response = await fetch("https://sxcu.net/api/files/create", {
    method: "POST",
    body: formData,
    headers: { "User-Agent": "sxcuUploader/1.0" },
  });

  const rateLimitHeaders = new Headers();
  const rateLimitHeaderNames = ["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", "X-RateLimit-Reset-After", "X-RateLimit-Bucket", "X-RateLimit-Global"];
  rateLimitHeaderNames.forEach(h => {
    if (response.headers.get(h)) rateLimitHeaders.set(h, response.headers.get(h));
  });

  const text = await response.text();
  let json = {};
  try { json = JSON.parse(text); } catch { json = { error: text }; }

  if (response.status === 429) {
    json.rateLimitExceeded = true;
    json.rateLimitReset = parseInt(rateLimitHeaders.get("X-RateLimit-Reset")) || Math.floor(Date.now() / 1000) + 60;
    json.rateLimitResetAfter = parseFloat(rateLimitHeaders.get("X-RateLimit-Reset-After")) || 60;
  }

  const responseHeaders = new Headers({ ...CORS_HEADERS, "Content-Type": "application/json" });
  rateLimitHeaderNames.forEach(h => {
    if (rateLimitHeaders.get(h)) responseHeaders.set(h, rateLimitHeaders.get(h));
  });

  return new Response(JSON.stringify(json), {
    headers: responseHeaders,
    status: response.ok ? 200 : response.status,
  });
}

async function handleImgchestPost(request, env) {
  const token = env.IMGCHEST_API_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: "Imgchest API token not configured" }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      status: 401,
    });
  }

  const formData = await request.formData();
  const images = formData.getAll("images[]");
  const otherEntries = [];
  for (const [key, value] of formData.entries()) {
    if (key !== "images[]") otherEntries.push([key, value]);
  }

  const MAX_IMGCHEST_IMAGES_PER_REQUEST = 20;
  let finalResult = null;

  for (let i = 0; i < images.length; i += MAX_IMGCHEST_IMAGES_PER_REQUEST) {
    const chunk = images.slice(i, i + MAX_IMGCHEST_IMAGES_PER_REQUEST);
    const isFirstChunk = i === 0;
    const url = isFirstChunk
      ? "https://api.imgchest.com/v1/post"
      : `https://api.imgchest.com/v1/post/${finalResult.data.id}/add`;

    const chunkFormData = new FormData();
    for (const [key, value] of otherEntries) chunkFormData.append(key, value);
    for (const image of chunk) chunkFormData.append("images[]", image);

    const response = await fetch(url, {
      method: "POST",
      body: chunkFormData,
      headers: { "Authorization": "Bearer " + token },
    });

    const text = await response.text();
    try {
      finalResult = JSON.parse(text);
    } catch {
      return new Response(JSON.stringify({ error: "Failed to parse JSON", raw: text.substring(0, 200) }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        status: 500,
      });
    }
  }

  return new Response(JSON.stringify(finalResult), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    status: 200,
  });
}

async function handleImgchestAdd(request, env) {
  const url = new URL(request.url);
  const pathParts = url.pathname.split("/");
  const postId = pathParts[4];
  const token = env.IMGCHEST_API_TOKEN;

  if (!token) {
    return new Response(JSON.stringify({ error: "Imgchest API token not configured" }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      status: 401,
    });
  }

  const formData = await request.formData();
  const images = formData.getAll("images[]");

  const MAX_IMGCHEST_IMAGES_PER_REQUEST = 20;
  let finalResult = null;

  for (let i = 0; i < images.length; i += MAX_IMGCHEST_IMAGES_PER_REQUEST) {
    const chunk = images.slice(i, i + MAX_IMGCHEST_IMAGES_PER_REQUEST);
    const chunkFormData = new FormData();
    for (const image of chunk) chunkFormData.append("images[]", image);

    const response = await fetch(`https://api.imgchest.com/v1/post/${postId}/add`, {
      method: "POST",
      body: chunkFormData,
      headers: { "Authorization": "Bearer " + token },
    });

    const text = await response.text();
    try {
      finalResult = JSON.parse(text);
    } catch {
      return new Response(JSON.stringify({ error: "Failed to parse JSON", raw: text.substring(0, 200) }), {
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        status: 500,
      });
    }
  }

  return new Response(JSON.stringify(finalResult), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    status: 200,
  });
}

export {
  handleCatboxUpload,
  handleSxcuCollections,
  handleSxcuFiles,
  handleImgchestPost,
  handleImgchestAdd,
  CORS_HEADERS,
};
