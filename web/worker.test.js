import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import workerDefault, {
  handleCatboxUpload,
  handleSxcuCollections,
  handleSxcuFiles,
  handleImgchestPost,
  handleImgchestAdd,
  CORS_HEADERS,
} from "./worker.js";

const originalFetch = globalThis.fetch;

function createRequest(url, options = {}) {
  return new Request(`https://worker.test${url}`, options);
}

function createFormData(entries) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.append(key, value);
  }
  return formData;
}

function createMockResponse(body, options = {}) {
  const headers = new Headers(options.headers || {});
  return new Response(body, { status: options.status || 200, headers });
}

describe("fetch handler", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("OPTIONS request returns 204 with CORS headers", async () => {
    const request = createRequest("/any-path", { method: "OPTIONS" });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type, Authorization");
    expect(response.headers.get("Access-Control-Max-Age")).toBe("86400");
  });

  test("POST /upload/catbox routes to handleCatboxUpload", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse("https://files.catbox.moe/test.png")));

    const formData = createFormData({ reqtype: "fileupload", fileToUpload: new Blob(["test"]) });
    const request = createRequest("/upload/catbox", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  test("POST /upload/sxcu/collections routes to handleSxcuCollections", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse(JSON.stringify({ id: "123" }))));

    const formData = createFormData({ title: "test" });
    const request = createRequest("/upload/sxcu/collections", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(200);
  });

  test("POST /upload/sxcu/files routes to handleSxcuFiles", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse(JSON.stringify({ url: "https://sxcu.net/abc" }))));

    const formData = createFormData({ file: new Blob(["test"]) });
    const request = createRequest("/upload/sxcu/files", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(200);
  });

  test("POST /upload/imgchest/post routes to handleImgchestPost", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse(JSON.stringify({ data: { id: "abc" } }))));

    const formData = new FormData();
    formData.append("images[]", new Blob(["test"]));
    const request = createRequest("/upload/imgchest/post", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, { IMGCHEST_API_TOKEN: "test-token" });

    expect(response.status).toBe(200);
  });

  test("POST /upload/imgchest/post/:id/add routes to handleImgchestAdd", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse(JSON.stringify({ success: true }))));

    const formData = new FormData();
    formData.append("images[]", new Blob(["test"]));
    const request = createRequest("/upload/imgchest/post/abc123/add", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, { IMGCHEST_API_TOKEN: "test-token" });

    expect(response.status).toBe(200);
  });

  test("unmatched route returns 404", async () => {
    const request = createRequest("/unknown", { method: "POST" });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
  });

  test("GET request returns 404", async () => {
    const request = createRequest("/upload/catbox", { method: "GET" });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(404);
  });
});

describe("handleCatboxUpload", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("missing reqtype returns 400", async () => {
    const formData = createFormData({});
    const request = createRequest("/upload/catbox", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Missing reqtype parameter");
  });

  test("invalid reqtype returns 400", async () => {
    const formData = createFormData({ reqtype: "invalidtype" });
    const request = createRequest("/upload/catbox", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Invalid reqtype: invalidtype");
  });

  describe("fileupload", () => {
    test("successful file upload", async () => {
      globalThis.fetch = mock(() => Promise.resolve(createMockResponse("https://files.catbox.moe/abc123.png")));

      const formData = createFormData({ reqtype: "fileupload", fileToUpload: new Blob(["test content"]) });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("https://files.catbox.moe/abc123.png");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    test("missing fileToUpload returns 400", async () => {
      const formData = createFormData({ reqtype: "fileupload" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Missing fileToUpload parameter");
    });

    test("includes userhash when provided", async () => {
      let capturedBody;
      globalThis.fetch = mock((url, options) => {
        capturedBody = options.body;
        return Promise.resolve(createMockResponse("https://files.catbox.moe/abc.png"));
      });

      const formData = createFormData({ reqtype: "fileupload", fileToUpload: new Blob(["test"]), userhash: "myhash123" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      await workerDefault.fetch(request, {});

      expect(capturedBody.get("userhash")).toBe("myhash123");
    });
  });

  describe("urlupload", () => {
    test("successful url upload", async () => {
      globalThis.fetch = mock(() => Promise.resolve(createMockResponse("https://files.catbox.moe/xyz.png")));

      const formData = createFormData({ reqtype: "urlupload", url: "https://example.com/image.png" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(200);
    });

    test("missing url returns 400", async () => {
      const formData = createFormData({ reqtype: "urlupload" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Missing url parameter");
    });

    test("includes userhash when provided", async () => {
      let capturedBody;
      globalThis.fetch = mock((url, options) => {
        capturedBody = options.body;
        return Promise.resolve(createMockResponse("ok"));
      });

      const formData = createFormData({ reqtype: "urlupload", url: "https://example.com/img.png", userhash: "hash" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      await workerDefault.fetch(request, {});

      expect(capturedBody.get("userhash")).toBe("hash");
    });
  });

  describe("deletefiles", () => {
    test("successful delete", async () => {
      globalThis.fetch = mock(() => Promise.resolve(createMockResponse("Files deleted")));

      const formData = createFormData({ reqtype: "deletefiles", files: "abc123.png def456.png", userhash: "myhash" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(200);
    });

    test("missing files returns 400", async () => {
      const formData = createFormData({ reqtype: "deletefiles" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Missing files parameter");
    });
  });

  describe("createalbum", () => {
    test("successful album creation", async () => {
      let capturedBody;
      globalThis.fetch = mock((url, options) => {
        capturedBody = options.body;
        return Promise.resolve(createMockResponse("https://catbox.moe/c/abcdef"));
      });

      const formData = createFormData({
        reqtype: "createalbum",
        files: "abc.png def.png",
        title: "My Album",
        desc: "Album description",
        userhash: "myhash"
      });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(200);
      expect(capturedBody.get("title")).toBe("My Album");
      expect(capturedBody.get("desc")).toBe("Album description");
    });

    test("missing files returns 400", async () => {
      const formData = createFormData({ reqtype: "createalbum", title: "Test" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Missing files parameter for album");
    });

    test("uses empty strings for missing title and desc", async () => {
      let capturedBody;
      globalThis.fetch = mock((url, options) => {
        capturedBody = options.body;
        return Promise.resolve(createMockResponse("ok"));
      });

      const formData = createFormData({ reqtype: "createalbum", files: "abc.png" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      await workerDefault.fetch(request, {});

      expect(capturedBody.get("title")).toBe("");
      expect(capturedBody.get("desc")).toBe("");
    });
  });

  describe("editalbum", () => {
    test("successful album edit", async () => {
      let capturedBody;
      globalThis.fetch = mock((url, options) => {
        capturedBody = options.body;
        return Promise.resolve(createMockResponse("Album edited"));
      });

      const formData = createFormData({
        reqtype: "editalbum",
        short: "abcdef",
        title: "New Title",
        desc: "New desc",
        files: "abc.png",
        userhash: "myhash"
      });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(200);
      expect(capturedBody.get("short")).toBe("abcdef");
    });

    test("missing short returns 400", async () => {
      const formData = createFormData({ reqtype: "editalbum", title: "Test" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Missing short parameter for album edit");
    });
  });

  describe("addtoalbum", () => {
    test("successful add to album", async () => {
      globalThis.fetch = mock(() => Promise.resolve(createMockResponse("Files added")));

      const formData = createFormData({ reqtype: "addtoalbum", short: "abc", files: "new.png", userhash: "hash" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(200);
    });

    test("missing short returns 400", async () => {
      const formData = createFormData({ reqtype: "addtoalbum", files: "abc.png" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Missing short parameter");
    });

    test("missing files returns 400", async () => {
      const formData = createFormData({ reqtype: "addtoalbum", short: "abc" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Missing files parameter");
    });
  });

  describe("removefromalbum", () => {
    test("successful remove from album", async () => {
      globalThis.fetch = mock(() => Promise.resolve(createMockResponse("Files removed")));

      const formData = createFormData({ reqtype: "removefromalbum", short: "abc", files: "old.png", userhash: "hash" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(200);
    });

    test("missing short returns 400", async () => {
      const formData = createFormData({ reqtype: "removefromalbum", files: "abc.png" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Missing short parameter");
    });

    test("missing files returns 400", async () => {
      const formData = createFormData({ reqtype: "removefromalbum", short: "abc" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Missing files parameter");
    });
  });

  describe("deletealbum", () => {
    test("successful album deletion", async () => {
      globalThis.fetch = mock(() => Promise.resolve(createMockResponse("Album deleted")));

      const formData = createFormData({ reqtype: "deletealbum", short: "abc", userhash: "hash" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(200);
    });

    test("missing short returns 400", async () => {
      const formData = createFormData({ reqtype: "deletealbum" });
      const request = createRequest("/upload/catbox", { method: "POST", body: formData });
      const response = await workerDefault.fetch(request, {});

      expect(response.status).toBe(400);
      expect(await response.text()).toBe("Missing short parameter");
    });
  });

  test("forwards error status from catbox API", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse("Error message", { status: 500 })));

    const formData = createFormData({ reqtype: "fileupload", fileToUpload: new Blob(["test"]) });
    const request = createRequest("/upload/catbox", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(500);
  });

  test("handles fetch errors gracefully", async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error("Network error")));

    const formData = createFormData({ reqtype: "fileupload", fileToUpload: new Blob(["test"]) });
    const request = createRequest("/upload/catbox", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Upload failed: Network error");
  });

  test("sends correct User-Agent header", async () => {
    let capturedHeaders;
    globalThis.fetch = mock((url, options) => {
      capturedHeaders = options.headers;
      return Promise.resolve(createMockResponse("ok"));
    });

    const formData = createFormData({ reqtype: "fileupload", fileToUpload: new Blob(["test"]) });
    const request = createRequest("/upload/catbox", { method: "POST", body: formData });
    await workerDefault.fetch(request, {});

    expect(capturedHeaders["User-Agent"]).toBe("CatboxUploader/1.0");
  });
});

describe("handleSxcuCollections", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("successful collection creation", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse(JSON.stringify({ id: "abc123" }))));

    const formData = createFormData({ title: "Test Collection" });
    const request = createRequest("/upload/sxcu/collections", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.id).toBe("abc123");
  });

  test("forwards rate limit headers", async () => {
    const mockResponse = createMockResponse(JSON.stringify({ id: "123" }), {
      headers: {
        "X-RateLimit-Limit": "100",
        "X-RateLimit-Remaining": "99",
        "X-RateLimit-Reset": "1234567890",
        "X-RateLimit-Reset-After": "60",
        "X-RateLimit-Bucket": "bucket1",
        "X-RateLimit-Global": "false"
      }
    });
    globalThis.fetch = mock(() => Promise.resolve(mockResponse));

    const formData = createFormData({ title: "Test" });
    const request = createRequest("/upload/sxcu/collections", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.headers.get("X-RateLimit-Limit")).toBe("100");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("99");
    expect(response.headers.get("X-RateLimit-Reset")).toBe("1234567890");
    expect(response.headers.get("X-RateLimit-Reset-After")).toBe("60");
    expect(response.headers.get("X-RateLimit-Bucket")).toBe("bucket1");
    expect(response.headers.get("X-RateLimit-Global")).toBe("false");
  });

  test("includes CORS headers in response", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse(JSON.stringify({}))));

    const formData = createFormData({ title: "Test" });
    const request = createRequest("/upload/sxcu/collections", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  test("forwards error status from sxcu API", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse(JSON.stringify({ error: "Bad request" }), { status: 400 })));

    const formData = createFormData({ title: "Test" });
    const request = createRequest("/upload/sxcu/collections", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(400);
  });
});

describe("handleSxcuFiles", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("successful file upload", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse(JSON.stringify({ url: "https://sxcu.net/abc" }))));

    const formData = createFormData({ file: new Blob(["test"]) });
    const request = createRequest("/upload/sxcu/files", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.url).toBe("https://sxcu.net/abc");
  });

  test("handles 429 rate limit response", async () => {
    const mockResponse = createMockResponse(JSON.stringify({ error: "Rate limited" }), {
      status: 429,
      headers: {
        "X-RateLimit-Reset": "1234567890",
        "X-RateLimit-Reset-After": "30.5"
      }
    });
    globalThis.fetch = mock(() => Promise.resolve(mockResponse));

    const formData = createFormData({ file: new Blob(["test"]) });
    const request = createRequest("/upload/sxcu/files", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(429);
    const json = await response.json();
    expect(json.rateLimitExceeded).toBe(true);
    expect(json.rateLimitReset).toBe(1234567890);
    expect(json.rateLimitResetAfter).toBe(30.5);
  });

  test("uses fallback values for 429 when headers missing", async () => {
    const mockResponse = createMockResponse(JSON.stringify({ error: "Rate limited" }), { status: 429 });
    globalThis.fetch = mock(() => Promise.resolve(mockResponse));

    const formData = createFormData({ file: new Blob(["test"]) });
    const request = createRequest("/upload/sxcu/files", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    const json = await response.json();
    expect(json.rateLimitExceeded).toBe(true);
    expect(json.rateLimitResetAfter).toBe(60);
    expect(typeof json.rateLimitReset).toBe("number");
  });

  test("handles non-JSON response gracefully", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse("Plain text error")));

    const formData = createFormData({ file: new Blob(["test"]) });
    const request = createRequest("/upload/sxcu/files", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.error).toBe("Plain text error");
  });

  test("forwards rate limit headers", async () => {
    const mockResponse = createMockResponse(JSON.stringify({}), {
      headers: {
        "X-RateLimit-Limit": "50",
        "X-RateLimit-Remaining": "49"
      }
    });
    globalThis.fetch = mock(() => Promise.resolve(mockResponse));

    const formData = createFormData({ file: new Blob(["test"]) });
    const request = createRequest("/upload/sxcu/files", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.headers.get("X-RateLimit-Limit")).toBe("50");
    expect(response.headers.get("X-RateLimit-Remaining")).toBe("49");
  });
});

describe("handleImgchestPost", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns 401 when token not configured", async () => {
    const formData = new FormData();
    formData.append("images[]", new Blob(["test"]));
    const request = createRequest("/upload/imgchest/post", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Imgchest API token not configured");
  });

  test("successful post creation with single image", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse(JSON.stringify({ data: { id: "post123", url: "https://imgchest.com/p/post123" } }))));

    const formData = new FormData();
    formData.append("images[]", new Blob(["test"]));
    formData.append("title", "Test Post");
    const request = createRequest("/upload/imgchest/post", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, { IMGCHEST_API_TOKEN: "token123" });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.data.id).toBe("post123");
  });

  test("sends Authorization header with token", async () => {
    let capturedHeaders;
    globalThis.fetch = mock((url, options) => {
      capturedHeaders = options.headers;
      return Promise.resolve(createMockResponse(JSON.stringify({ data: { id: "123" } })));
    });

    const formData = new FormData();
    formData.append("images[]", new Blob(["test"]));
    const request = createRequest("/upload/imgchest/post", { method: "POST", body: formData });
    await workerDefault.fetch(request, { IMGCHEST_API_TOKEN: "my-secret-token" });

    expect(capturedHeaders["Authorization"]).toBe("Bearer my-secret-token");
  });

  test("chunks images when more than 20", async () => {
    const calls = [];
    globalThis.fetch = mock((url, options) => {
      calls.push({ url, body: options.body });
      return Promise.resolve(createMockResponse(JSON.stringify({ data: { id: "post123" } })));
    });

    const formData = new FormData();
    for (let i = 0; i < 25; i++) {
      formData.append("images[]", new Blob([`image${i}`]));
    }
    const request = createRequest("/upload/imgchest/post", { method: "POST", body: formData });
    await workerDefault.fetch(request, { IMGCHEST_API_TOKEN: "token" });

    expect(calls.length).toBe(2);
    expect(calls[0].url).toBe("https://api.imgchest.com/v1/post");
    expect(calls[1].url).toBe("https://api.imgchest.com/v1/post/post123/add");
    expect(calls[0].body.getAll("images[]").length).toBe(20);
    expect(calls[1].body.getAll("images[]").length).toBe(5);
  });

  test("includes other form entries in all chunks", async () => {
    const calls = [];
    globalThis.fetch = mock((url, options) => {
      calls.push({ url, body: options.body });
      return Promise.resolve(createMockResponse(JSON.stringify({ data: { id: "post123" } })));
    });

    const formData = new FormData();
    formData.append("title", "My Title");
    formData.append("description", "My Description");
    for (let i = 0; i < 25; i++) {
      formData.append("images[]", new Blob([`image${i}`]));
    }
    const request = createRequest("/upload/imgchest/post", { method: "POST", body: formData });
    await workerDefault.fetch(request, { IMGCHEST_API_TOKEN: "token" });

    expect(calls[0].body.get("title")).toBe("My Title");
    expect(calls[0].body.get("description")).toBe("My Description");
    expect(calls[1].body.get("title")).toBe("My Title");
    expect(calls[1].body.get("description")).toBe("My Description");
  });

  test("handles JSON parse error", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse("Invalid JSON {")));

    const formData = new FormData();
    formData.append("images[]", new Blob(["test"]));
    const request = createRequest("/upload/imgchest/post", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, { IMGCHEST_API_TOKEN: "token" });

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toBe("Failed to parse JSON");
    expect(json.raw).toBeDefined();
  });

  test("includes CORS headers in response", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse(JSON.stringify({ data: { id: "123" } }))));

    const formData = new FormData();
    formData.append("images[]", new Blob(["test"]));
    const request = createRequest("/upload/imgchest/post", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, { IMGCHEST_API_TOKEN: "token" });

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });
});

describe("handleImgchestAdd", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("returns 401 when token not configured", async () => {
    const formData = new FormData();
    formData.append("images[]", new Blob(["test"]));
    const request = createRequest("/upload/imgchest/post/abc123/add", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, {});

    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error).toBe("Imgchest API token not configured");
  });

  test("successful add images to existing post", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse(JSON.stringify({ success: true }))));

    const formData = new FormData();
    formData.append("images[]", new Blob(["test"]));
    const request = createRequest("/upload/imgchest/post/existingpost123/add", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, { IMGCHEST_API_TOKEN: "token" });

    expect(response.status).toBe(200);
  });

  test("extracts post ID from URL correctly", async () => {
    let capturedUrl;
    globalThis.fetch = mock((url) => {
      capturedUrl = url;
      return Promise.resolve(createMockResponse(JSON.stringify({ success: true })));
    });

    const formData = new FormData();
    formData.append("images[]", new Blob(["test"]));
    const request = createRequest("/upload/imgchest/post/myPostId999/add", { method: "POST", body: formData });
    await workerDefault.fetch(request, { IMGCHEST_API_TOKEN: "token" });

    expect(capturedUrl).toBe("https://api.imgchest.com/v1/post/myPostId999/add");
  });

  test("chunks images when more than 20", async () => {
    const calls = [];
    globalThis.fetch = mock((url, options) => {
      calls.push({ url, body: options.body });
      return Promise.resolve(createMockResponse(JSON.stringify({ success: true })));
    });

    const formData = new FormData();
    for (let i = 0; i < 45; i++) {
      formData.append("images[]", new Blob([`image${i}`]));
    }
    const request = createRequest("/upload/imgchest/post/post456/add", { method: "POST", body: formData });
    await workerDefault.fetch(request, { IMGCHEST_API_TOKEN: "token" });

    expect(calls.length).toBe(3);
    expect(calls[0].body.getAll("images[]").length).toBe(20);
    expect(calls[1].body.getAll("images[]").length).toBe(20);
    expect(calls[2].body.getAll("images[]").length).toBe(5);
  });

  test("all chunks use same post ID", async () => {
    const capturedUrls = [];
    globalThis.fetch = mock((url) => {
      capturedUrls.push(url);
      return Promise.resolve(createMockResponse(JSON.stringify({ success: true })));
    });

    const formData = new FormData();
    for (let i = 0; i < 25; i++) {
      formData.append("images[]", new Blob([`image${i}`]));
    }
    const request = createRequest("/upload/imgchest/post/fixedPostId/add", { method: "POST", body: formData });
    await workerDefault.fetch(request, { IMGCHEST_API_TOKEN: "token" });

    expect(capturedUrls[0]).toBe("https://api.imgchest.com/v1/post/fixedPostId/add");
    expect(capturedUrls[1]).toBe("https://api.imgchest.com/v1/post/fixedPostId/add");
  });

  test("handles JSON parse error", async () => {
    globalThis.fetch = mock(() => Promise.resolve(createMockResponse("Not valid JSON")));

    const formData = new FormData();
    formData.append("images[]", new Blob(["test"]));
    const request = createRequest("/upload/imgchest/post/abc/add", { method: "POST", body: formData });
    const response = await workerDefault.fetch(request, { IMGCHEST_API_TOKEN: "token" });

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toBe("Failed to parse JSON");
  });

  test("sends Authorization header", async () => {
    let capturedHeaders;
    globalThis.fetch = mock((url, options) => {
      capturedHeaders = options.headers;
      return Promise.resolve(createMockResponse(JSON.stringify({ success: true })));
    });

    const formData = new FormData();
    formData.append("images[]", new Blob(["test"]));
    const request = createRequest("/upload/imgchest/post/abc/add", { method: "POST", body: formData });
    await workerDefault.fetch(request, { IMGCHEST_API_TOKEN: "secret-token" });

    expect(capturedHeaders["Authorization"]).toBe("Bearer secret-token");
  });
});
