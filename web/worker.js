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
  const formData = await request.formData();
  const reqtype = formData.get("reqtype");

  const response = await fetch("https://catbox.moe/user/api.php", {
    method: "POST",
    body: formData,
  });
  const text = await response.text();
  return new Response(text, {
    headers: CORS_HEADERS,
    status: response.ok ? 200 : response.status
  });
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
    json.rateLimitResetAfter = rateLimitHeaders.get("X-RateLimit-Reset-After") || 60;
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
