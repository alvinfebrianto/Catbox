import { serve } from "bun";
import { writeFileSync, unlinkSync, mkdirSync, existsSync, readFileSync } from "fs";

const PORT = 3000;
const TEMP_DIR = "./temp_uploads";
let IMGCHEST_TOKEN_FILE = "C:\\Users\\lenovo\\AppData\\Roaming\\catbox_web_imgchest_token.txt";

function setImgchestTokenFile(path) {
  IMGCHEST_TOKEN_FILE = path;
}

if (import.meta.main) {
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }
}

function getImgchestToken() {
  const envToken = process.env.IMGCHEST_API_TOKEN;
  if (envToken) {
    return envToken;
  }
  if (existsSync(IMGCHEST_TOKEN_FILE)) {
    return readFileSync(IMGCHEST_TOKEN_FILE, "utf-8").trim();
  }
  return null;
}

function getRateLimitFile(provider) {
  return `./catbox_${provider}_rate_limit.json`;
}

function getRateLimit(provider) {
  const file = getRateLimitFile(provider);
  if (existsSync(file)) {
    try {
      return JSON.parse(readFileSync(file, "utf-8"));
    } catch {
      return null;
    }
  }
  return null;
}

function setRateLimit(provider, data) {
  writeFileSync(getRateLimitFile(provider), JSON.stringify(data));
}

function clearRateLimit(provider) {
  const file = getRateLimitFile(provider);
  if (existsSync(file)) {
    unlinkSync(file);
  }
}

async function handleCatboxUpload(req) {
  const formData = await req.formData();
  const reqtype = formData.get("reqtype");

  if (reqtype === "fileupload") {
    const response = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: formData,
    });
    const text = await response.text();
    return new Response(text, { status: response.ok ? 200 : response.status });
  }

  if (reqtype === "urlupload") {
    const response = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: formData,
    });
    const text = await response.text();
    return new Response(text, { status: response.ok ? 200 : response.status });
  }

  if (reqtype === "createalbum") {
    const response = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: formData,
    });
    const text = await response.text();
    return new Response(text, { status: response.ok ? 200 : response.status });
  }

  return new Response("Unknown request type", { status: 400 });
}

async function handleSxcuCollections(req) {
  await waitForRateLimitAsync("sxcu", 1);

  const formData = await req.formData();
  const response = await fetch("https://sxcu.net/api/collections/create", {
    method: "POST",
    body: formData,
    headers: { "User-Agent": "sxcuUploader/1.0" },
  });

  const json = await response.json();
  console.log("SXCU Collection Create Response:", JSON.stringify(json, null, 2));

  const limit = response.headers.get("X-RateLimit-Limit");
  const remaining = response.headers.get("X-RateLimit-Remaining");
  const reset = response.headers.get("X-RateLimit-Reset");
  
  if (limit && remaining !== null) {
    setRateLimit("sxcu", {
      remaining: parseInt(remaining),
      limit: parseInt(limit),
      reset: reset ? parseInt(reset) : Math.floor(Date.now() / 1000) + 60,
      windowStart: Math.floor(Date.now() / 1000),
    });
  }

  if (response.status === 429) {
    const resetAfter = response.headers.get("X-RateLimit-Reset-After");
    let waitSeconds = resetAfter ? parseFloat(resetAfter) + 1 : 61;
    
    console.log(`Rate limited. Waiting ${waitSeconds}s before retry...`);
    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
    
    clearRateLimit("sxcu");
    
    console.log("Retrying collection creation after rate limit...");
    const retryResponse = await fetch("https://sxcu.net/api/collections/create", {
      method: "POST",
      body: formData,
      headers: { "User-Agent": "sxcuUploader/1.0" },
    });
    
    const retryJson = await retryResponse.json();
    
    const retryLimit = retryResponse.headers.get("X-RateLimit-Limit");
    const retryRemaining = retryResponse.headers.get("X-RateLimit-Remaining");
    const retryReset = retryResponse.headers.get("X-RateLimit-Reset");
    
    if (retryLimit && retryRemaining !== null) {
      setRateLimit("sxcu", {
        remaining: parseInt(retryRemaining),
        limit: parseInt(retryLimit),
        reset: retryReset ? parseInt(retryReset) : Math.floor(Date.now() / 1000) + 60,
        windowStart: Math.floor(Date.now() / 1000),
      });
    }
    
    return new Response(JSON.stringify(retryJson), {
      headers: { "Content-Type": "application/json" },
      status: retryResponse.ok ? 200 : retryResponse.status,
    });
  }

  return new Response(JSON.stringify(json), {
    headers: { "Content-Type": "application/json" },
    status: response.ok ? 200 : response.status,
  });
}

async function handleSxcuFiles(req) {
  await waitForRateLimitAsync("sxcu", 1);

  const formData = await req.formData();
  
  console.log("SXCU File Upload Request Data:");
  for (const [key, value] of formData.entries()) {
    if (key === 'file') {
      console.log(`  ${key}: [File: ${value.name}, size: ${value.size}]`);
    } else {
      console.log(`  ${key}: ${value}`);
    }
  }

  const response = await fetch("https://sxcu.net/api/files/create", {
    method: "POST",
    body: formData,
    headers: { "User-Agent": "sxcuUploader/1.0" },
  });

  const text = await response.text();
  console.log("SXCU File Upload Response:", text);
  
  let json = {};

  try {
    json = JSON.parse(text);
  } catch {
    json = { error: text };
  }

  const limit = response.headers.get("X-RateLimit-Limit");
  const remaining = response.headers.get("X-RateLimit-Remaining");
  const reset = response.headers.get("X-RateLimit-Reset");
  
  if (limit && remaining !== null) {
    setRateLimit("sxcu", {
      remaining: parseInt(remaining),
      limit: parseInt(limit),
      reset: reset ? parseInt(reset) : Math.floor(Date.now() / 1000) + 60,
      windowStart: Math.floor(Date.now() / 1000),
    });
  }

  if (response.status === 429) {
    const resetAfter = response.headers.get("X-RateLimit-Reset-After");
    let waitSeconds = resetAfter ? parseFloat(resetAfter) + 1 : 61;
    
    console.log(`Rate limited. Waiting ${waitSeconds}s before retry...`);
    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
    
    clearRateLimit("sxcu");
    
    console.log("Retrying upload after rate limit...");
    const retryResponse = await fetch("https://sxcu.net/api/files/create", {
      method: "POST",
      body: formData,
      headers: { "User-Agent": "sxcuUploader/1.0" },
    });
    
    const retryText = await retryResponse.text();
    try {
      json = JSON.parse(retryText);
    } catch {
      json = { error: retryText };
    }
    
    const retryLimit = retryResponse.headers.get("X-RateLimit-Limit");
    const retryRemaining = retryResponse.headers.get("X-RateLimit-Remaining");
    const retryReset = retryResponse.headers.get("X-RateLimit-Reset");
    
    if (retryLimit && retryRemaining !== null) {
      setRateLimit("sxcu", {
        remaining: parseInt(retryRemaining),
        limit: parseInt(retryLimit),
        reset: retryReset ? parseInt(retryReset) : Math.floor(Date.now() / 1000) + 60,
        windowStart: Math.floor(Date.now() / 1000),
      });
    }
    
    return new Response(JSON.stringify(json), {
      headers: { "Content-Type": "application/json" },
      status: retryResponse.ok ? 200 : retryResponse.status,
    });
  }

  return new Response(JSON.stringify(json), {
    headers: { "Content-Type": "application/json" },
    status: response.ok ? 200 : response.status,
  });
}

const MAX_IMGCHEST_IMAGES_PER_REQUEST = 20;

async function handleImgchestPost(req) {
  await waitForRateLimitAsync("imgchest", 1);

  const token = getImgchestToken();
  if (!token) {
    return new Response(JSON.stringify({ error: "Imgchest API token not found. Set IMGCHEST_API_TOKEN environment variable or create catbox_imgchest_token.txt" }), {
      headers: { "Content-Type": "application/json" },
      status: 401,
    });
  }

  const formData = await req.formData();

  const images = formData.getAll("images[]");
  const isAnonymous = formData.get("anonymous") === "1" || formData.get("anonymous") === "true";

  if (images.length === 0) {
    return new Response(JSON.stringify({ error: "No images provided" }), {
      headers: { "Content-Type": "application/json" },
      status: 400,
    });
  }

  if (isAnonymous && images.length > 20) {
    return new Response(JSON.stringify({ error: "Anonymous posts are limited to 20 images. Please deselect anonymous mode or upload fewer images." }), {
      headers: { "Content-Type": "application/json" },
      status: 400,
    });
  }

  const otherEntries = [];
  for (const [key, value] of formData.entries()) {
    if (key !== "images[]") {
      otherEntries.push([key, value]);
    }
  }

  const chunks = [];
  for (let i = 0; i < images.length; i += MAX_IMGCHEST_IMAGES_PER_REQUEST) {
    chunks.push(images.slice(i, i + MAX_IMGCHEST_IMAGES_PER_REQUEST));
  }

  let finalResult = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isFirstChunk = i === 0;
    const url = isFirstChunk
      ? "https://api.imgchest.com/v1/post"
      : `https://api.imgchest.com/v1/post/${finalResult.data.id}/add`;

    await waitForRateLimitAsync("imgchest", 1);

    const chunkFormData = new FormData();
    for (const [key, value] of otherEntries) {
      chunkFormData.append(key, value);
    }
    for (const image of chunk) {
      chunkFormData.append("images[]", image);
    }

    const response = await fetch(url, {
      method: "POST",
      body: chunkFormData,
      headers: {
        "Authorization": "Bearer " + token,
      },
    });

    const text = await response.text();

    if (text.trim().startsWith("<")) {
      return new Response(JSON.stringify({ error: "Imgchest API error", details: "Unauthorized or API error", chunk: i + 1 }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      });
    }

    try {
      const json = JSON.parse(text);
      const remaining = response.headers.get("x-ratelimit-remaining");
      const limit = response.headers.get("x-ratelimit-limit");

      if (remaining && limit) {
        setRateLimit("imgchest", {
          remaining: parseInt(remaining),
          limit: parseInt(limit),
          windowStart: Math.floor(Date.now() / 1000),
        });
      }

      if (!response.ok) {
        return new Response(JSON.stringify({ error: "Imgchest API error", status: response.status, details: json, raw: text.substring(0, 500), chunk: i + 1 }), {
          headers: { "Content-Type": "application/json" },
          status: response.status,
        });
      }

      finalResult = json;
    } catch (e) {
      return new Response(JSON.stringify({ error: "Failed to parse JSON", raw: text.substring(0, 200), chunk: i + 1 }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      });
    }
  }

  return new Response(JSON.stringify(finalResult), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

async function handleImgchestAdd(req) {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  const postId = pathParts[4];

  await waitForRateLimitAsync("imgchest", 1);

  const token = getImgchestToken();
  if (!token) {
    return new Response(JSON.stringify({ error: "Imgchest API token not found" }), {
      headers: { "Content-Type": "application/json" },
      status: 401,
    });
  }

  const formData = await req.formData();

  const images = formData.getAll("images[]");

  if (images.length === 0) {
    return new Response(JSON.stringify({ error: "No images provided" }), {
      headers: { "Content-Type": "application/json" },
      status: 400,
    });
  }

  const chunks = [];
  for (let i = 0; i < images.length; i += MAX_IMGCHEST_IMAGES_PER_REQUEST) {
    chunks.push(images.slice(i, i + MAX_IMGCHEST_IMAGES_PER_REQUEST));
  }

  let finalResult = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    await waitForRateLimitAsync("imgchest", 1);

    const chunkFormData = new FormData();
    for (const image of chunk) {
      chunkFormData.append("images[]", image);
    }

    const response = await fetch(`https://api.imgchest.com/v1/post/${postId}/add`, {
      method: "POST",
      body: chunkFormData,
      headers: {
        "Authorization": "Bearer " + token,
      },
    });

    const text = await response.text();

    if (text.trim().startsWith("<")) {
      return new Response(JSON.stringify({ error: "Imgchest API error", details: "Unauthorized or API error", chunk: i + 1 }), {
        headers: { "Content-Type": "application/json" },
        status: 401,
      });
    }

    try {
      const json = JSON.parse(text);
      const remaining = response.headers.get("x-ratelimit-remaining");
      const limit = response.headers.get("x-ratelimit-limit");

      if (remaining && limit) {
        setRateLimit("imgchest", {
          remaining: parseInt(remaining),
          limit: parseInt(limit),
          windowStart: Math.floor(Date.now() / 1000),
        });
      }

      if (!response.ok) {
        return new Response(JSON.stringify({ error: "Imgchest API error", status: response.status, details: json, raw: text.substring(0, 500), chunk: i + 1 }), {
          headers: { "Content-Type": "application/json" },
          status: response.status,
        });
      }

      finalResult = json;
    } catch (e) {
      return new Response(JSON.stringify({ error: "Failed to parse JSON", raw: text.substring(0, 200), chunk: i + 1 }), {
        headers: { "Content-Type": "application/json" },
        status: 500,
      });
    }
  }

  return new Response(JSON.stringify(finalResult), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

async function waitForRateLimitAsync(provider, cost = 1) {
  const file = getRateLimitFile(provider);
  const now = Math.floor(Date.now() / 1000);
  
  if (existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, "utf-8"));
      
      const windowElapsed = now - data.windowStart;
      if (windowElapsed >= 60) {
        clearRateLimit(provider);
        console.log(`Rate limit window reset for ${provider}. Proceeding.`);
        return;
      }
      
      if ((data.remaining - cost) < 0) {
        const waitSeconds = Math.max(60 - windowElapsed + 1, 1);
        console.log(`Rate limit exhausted (${data.remaining}/${data.limit} remaining). Waiting ${waitSeconds}s...`);
        await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
        clearRateLimit(provider);
      }
    } catch (e) {
      console.error("Rate limit check failed:", e);
    }
  }
}

if (import.meta.main) {
  const server = serve({
    port: PORT,

    fetch(req) {
      const url = new URL(req.url);
      const method = req.method;
      const path = url.pathname;

      if (method === "POST" && path === "/upload/catbox") {
        return handleCatboxUpload(req);
      }

      if (method === "POST" && path === "/upload/sxcu/collections") {
        return handleSxcuCollections(req);
      }

      if (method === "POST" && path === "/upload/sxcu/files") {
        return handleSxcuFiles(req);
      }

      if (method === "POST" && path === "/upload/imgchest/post") {
        return handleImgchestPost(req);
      }

      if (method === "POST" && path.startsWith("/upload/imgchest/post/") && path.endsWith("/add")) {
        return handleImgchestAdd(req);
      }

      const filePath = path === "/" ? "./index.html" : "." + path;
      if (existsSync(filePath)) {
        const file = Bun.file(filePath);
        const ext = filePath.split(".").pop();
        const contentTypes = {
          html: "text/html",
          css: "text/css",
          js: "application/javascript",
        };
        return new Response(file, {
          headers: { "Content-Type": contentTypes[ext] || "text/plain" },
        });
      }
      return new Response("Not Found", { status: 404 });
    },
  });

  console.log(`Server running at http://localhost:${PORT}`);
}

export {
  getImgchestToken,
  setImgchestTokenFile,
  getRateLimitFile,
  getRateLimit,
  setRateLimit,
  clearRateLimit,
  waitForRateLimitAsync,
  handleCatboxUpload,
  handleSxcuCollections,
  handleSxcuFiles,
  handleImgchestPost,
  handleImgchestAdd,
  MAX_IMGCHEST_IMAGES_PER_REQUEST,
};
