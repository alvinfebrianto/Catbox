import { test, expect, describe, mock, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import {
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
} from "../server.js";

const ORIGINAL_TOKEN_FILE = "C:\\Users\\lenovo\\AppData\\Roaming\\catbox_web_imgchest_token.txt";
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

function createMockFormData(entries) {
  const data = new Map();
  const arrayData = new Map();

  for (const [key, value] of entries) {
    if (key.endsWith("[]")) {
      if (!arrayData.has(key)) arrayData.set(key, []);
      arrayData.get(key).push(value);
    } else {
      data.set(key, value);
    }
  }

  return {
    get: (key) => data.get(key) ?? null,
    getAll: (key) => arrayData.get(key) ?? [],
    entries: () => entries[Symbol.iterator](),
    [Symbol.iterator]: () => entries[Symbol.iterator](),
  };
}

function createMockRequest(url, options = {}) {
  return {
    url,
    method: options.method || "POST",
    formData: async () => options.formData || createMockFormData([]),
  };
}

function createMockResponse(body, options = {}) {
  const headers = new Map(Object.entries(options.headers || {}));
  return {
    ok: options.status ? options.status >= 200 && options.status < 300 : true,
    status: options.status || 200,
    headers: { get: (key) => headers.get(key) ?? null },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
  };
}

function createMockFile(name, size = 1024) {
  return { name, size, type: "image/png" };
}

function cleanupRateLimitFiles() {
  const providers = ["test", "sxcu", "imgchest", "catbox"];
  for (const provider of providers) {
    const file = `./catbox_${provider}_rate_limit.json`;
    if (existsSync(file)) unlinkSync(file);
  }
}

describe("Token management", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    setImgchestTokenFile(ORIGINAL_TOKEN_FILE);
  });

  test("prioritizes environment variable over file", () => {
    process.env.IMGCHEST_API_TOKEN = "env-token-123";
    expect(getImgchestToken()).toBe("env-token-123");
  });

  test("falls back to file when env not set", () => {
    delete process.env.IMGCHEST_API_TOKEN;
    const testTokenFile = "./test_imgchest_token.txt";
    writeFileSync(testTokenFile, "file-token-abc123\n");
    setImgchestTokenFile(testTokenFile);
    
    expect(getImgchestToken()).toBe("file-token-abc123");
    
    unlinkSync(testTokenFile);
  });

  test("returns null when no token available", () => {
    delete process.env.IMGCHEST_API_TOKEN;
    setImgchestTokenFile("./nonexistent_token_file.txt");
    expect(getImgchestToken()).toBeNull();
  });
});

describe("Rate limiting", () => {
  afterEach(() => {
    cleanupRateLimitFiles();
  });

  test("persists and retrieves rate limit data", () => {
    const data = { remaining: 5, limit: 10, windowStart: 1234567890 };
    
    setRateLimit("test", data);
    const retrieved = getRateLimit("test");
    
    expect(retrieved).toEqual(data);
  });

  test("clears rate limit file", () => {
    setRateLimit("test", { remaining: 5 });
    expect(existsSync(getRateLimitFile("test"))).toBe(true);
    
    clearRateLimit("test");
    
    expect(existsSync(getRateLimitFile("test"))).toBe(false);
  });

  test("proceeds immediately when no rate limit exists", async () => {
    const start = Date.now();
    await waitForRateLimitAsync("nonexistent", 1);
    expect(Date.now() - start).toBeLessThan(100);
  });

  test("proceeds when requests remaining", async () => {
    const recentWindowStart = Math.floor(Date.now() / 1000) - 10;
    setRateLimit("test", { remaining: 5, limit: 10, windowStart: recentWindowStart });
    
    const start = Date.now();
    await waitForRateLimitAsync("test", 1);
    expect(Date.now() - start).toBeLessThan(100);
  });

  test("waits when rate limit exhausted", async () => {
    const recentWindowStart = Math.floor(Date.now() / 1000) - 58;
    setRateLimit("test", { remaining: 0, limit: 10, windowStart: recentWindowStart });
    
    const start = Date.now();
    await waitForRateLimitAsync("test", 1);
    
    expect(Date.now() - start).toBeGreaterThanOrEqual(1000);
    expect(existsSync(getRateLimitFile("test"))).toBe(false);
  });

  test("clears expired rate limit windows", async () => {
    const oldWindowStart = Math.floor(Date.now() / 1000) - 120;
    setRateLimit("test", { remaining: 0, limit: 10, windowStart: oldWindowStart });
    
    await waitForRateLimitAsync("test", 1);
    
    expect(existsSync(getRateLimitFile("test"))).toBe(false);
  });
});

describe("Catbox upload handler", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("proxies file upload to catbox API", async () => {
    let capturedUrl, capturedBody;
    globalThis.fetch = mock((url, opts) => {
      capturedUrl = url;
      capturedBody = opts.body;
      return Promise.resolve(createMockResponse("https://files.catbox.moe/abc.png"));
    });

    const formData = createMockFormData([
      ["reqtype", "fileupload"],
      ["fileToUpload", createMockFile("test.png")],
    ]);
    const req = createMockRequest("http://localhost:3000/upload/catbox", { formData });

    const response = await handleCatboxUpload(req);

    expect(response.status).toBe(200);
    expect(capturedUrl).toBe("https://catbox.moe/user/api.php");
    expect(capturedBody.get("reqtype")).toBe("fileupload");
  });

  test("rejects invalid request types", async () => {
    const formData = createMockFormData([["reqtype", "hackertype"]]);
    const req = createMockRequest("http://localhost:3000/upload/catbox", { formData });

    const response = await handleCatboxUpload(req);

    expect(response.status).toBe(400);
  });

  test("handles URL upload requests", async () => {
    globalThis.fetch = mock(() => 
      Promise.resolve(createMockResponse("https://files.catbox.moe/abc.png"))
    );

    const formData = createMockFormData([
      ["reqtype", "urlupload"],
      ["url", "https://example.com/image.png"],
    ]);
    const req = createMockRequest("http://localhost:3000/upload/catbox", { formData });

    const response = await handleCatboxUpload(req);
    expect(response.status).toBe(200);
  });
});

describe("SXCU upload handlers", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    cleanupRateLimitFiles();
  });

  test("creates collection and returns URL", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(createMockResponse({ id: "coll123", url: "https://sxcu.net/c/coll123" }))
    );

    const formData = createMockFormData([["title", "My Collection"]]);
    const req = createMockRequest("http://localhost:3000/upload/sxcu/collections", { formData });

    const response = await handleSxcuCollections(req);
    const body = JSON.parse(await response.text());

    expect(response.status).toBe(200);
    expect(body.id).toBe("coll123");
  });

  test("uploads file and tracks rate limits", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(createMockResponse(
        { url: "https://sxcu.net/abc" },
        { headers: { "X-RateLimit-Remaining": "58", "X-RateLimit-Limit": "60" } }
      ))
    );

    const formData = createMockFormData([["file", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/sxcu/files", { formData });

    const response = await handleSxcuFiles(req);

    expect(response.status).toBe(200);
    const rateLimit = getRateLimit("sxcu");
    expect(rateLimit.remaining).toBe(58);
  });
});

describe("Imgchest upload handlers", () => {
  beforeEach(() => {
    process.env.IMGCHEST_API_TOKEN = "test-token";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    setImgchestTokenFile(ORIGINAL_TOKEN_FILE);
    cleanupRateLimitFiles();
  });

  test("rejects requests without API token", async () => {
    delete process.env.IMGCHEST_API_TOKEN;
    setImgchestTokenFile("./nonexistent.txt");

    const formData = createMockFormData([["images[]", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post", { formData });

    const response = await handleImgchestPost(req);

    expect(response.status).toBe(401);
  });

  test("creates post with images", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(createMockResponse({
        data: { id: "post123", link: "https://imgchest.com/p/post123" }
      }))
    );

    const formData = createMockFormData([
      ["images[]", createMockFile("a.png")],
      ["images[]", createMockFile("b.png")],
      ["title", "Test Post"],
    ]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post", { formData });

    const response = await handleImgchestPost(req);
    const body = JSON.parse(await response.text());

    expect(response.status).toBe(200);
    expect(body.data.id).toBe("post123");
  });

  test("chunks large uploads into batches of 20", async () => {
    let fetchCallCount = 0;
    globalThis.fetch = mock(() => {
      fetchCallCount++;
      return Promise.resolve(createMockResponse({
        data: { id: "post123", link: "https://imgchest.com/p/post123" }
      }));
    });

    const entries = [];
    for (let i = 0; i < 45; i++) {
      entries.push(["images[]", createMockFile(`img${i}.png`)]);
    }
    const formData = createMockFormData(entries);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post", { formData });

    await handleImgchestPost(req);

    expect(fetchCallCount).toBe(3);
  });

  test("adds images to existing post", async () => {
    let capturedUrl;
    globalThis.fetch = mock((url) => {
      capturedUrl = url;
      return Promise.resolve(createMockResponse({ success: true }));
    });

    const formData = createMockFormData([["images[]", createMockFile("new.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post/existingPost123/add", { formData });

    const response = await handleImgchestAdd(req);

    expect(response.status).toBe(200);
    expect(capturedUrl).toContain("existingPost123");
  });

  test("handles API errors gracefully", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(createMockResponse({ error: "Invalid request" }, { status: 400 }))
    );

    const formData = createMockFormData([["images[]", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post", { formData });

    const response = await handleImgchestPost(req);

    expect(response.status).toBe(400);
  });
});

describe("Constants", () => {
  test("MAX_IMGCHEST_IMAGES_PER_REQUEST is 20", () => {
    expect(MAX_IMGCHEST_IMAGES_PER_REQUEST).toBe(20);
  });
});
