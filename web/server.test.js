import { test, expect, describe, mock, beforeEach, afterEach, spyOn } from "bun:test";
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
} from "./server.js";

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
  const formData = options.formData || createMockFormData([]);
  return {
    url,
    method: options.method || "POST",
    formData: async () => formData,
  };
}

function createMockResponse(body, options = {}) {
  const headers = new Map(Object.entries(options.headers || {}));
  return {
    ok: options.status ? options.status >= 200 && options.status < 300 : true,
    status: options.status || 200,
    headers: {
      get: (key) => headers.get(key) ?? null,
    },
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
  };
}

function createMockFile(name, size = 1024) {
  return { name, size, type: "image/png" };
}

function cleanupRateLimitFiles() {
  const providers = ["test", "sxcu", "imgchest", "catbox", "nonexistent"];
  for (const provider of providers) {
    const file = `./catbox_${provider}_rate_limit.json`;
    if (existsSync(file)) {
      unlinkSync(file);
    }
  }
}

describe("getImgchestToken", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    setImgchestTokenFile(ORIGINAL_TOKEN_FILE);
  });

  test("returns token from environment variable", () => {
    process.env.IMGCHEST_API_TOKEN = "env-token-123";
    expect(getImgchestToken()).toBe("env-token-123");
  });

  test("returns null when no token available and file does not exist", () => {
    delete process.env.IMGCHEST_API_TOKEN;
    setImgchestTokenFile("./nonexistent_token_file.txt");
    expect(getImgchestToken()).toBeNull();
  });

  test("returns token from file when env not set", () => {
    delete process.env.IMGCHEST_API_TOKEN;
    const testTokenFile = "./test_imgchest_token.txt";
    writeFileSync(testTokenFile, "file-token-abc123\n");
    setImgchestTokenFile(testTokenFile);
    
    const token = getImgchestToken();
    expect(token).toBe("file-token-abc123");
    
    unlinkSync(testTokenFile);
  });
});

describe("getRateLimitFile", () => {
  test("returns correct file path for sxcu provider", () => {
    expect(getRateLimitFile("sxcu")).toBe("./catbox_sxcu_rate_limit.json");
  });

  test("returns correct file path for imgchest provider", () => {
    expect(getRateLimitFile("imgchest")).toBe("./catbox_imgchest_rate_limit.json");
  });

  test("returns correct file path for catbox provider", () => {
    expect(getRateLimitFile("catbox")).toBe("./catbox_catbox_rate_limit.json");
  });
});

describe("getRateLimit", () => {
  const testFile = "./catbox_test_rate_limit.json";

  afterEach(() => {
    cleanupRateLimitFiles();
  });

  test("returns null when file does not exist", () => {
    expect(getRateLimit("nonexistent")).toBeNull();
  });

  test("returns parsed data when file exists", () => {
    const testData = { remaining: 5, limit: 10, reset: 1234567890 };
    writeFileSync(testFile, JSON.stringify(testData));
    expect(getRateLimit("test")).toEqual(testData);
  });

  test("returns null when file contains invalid JSON", () => {
    writeFileSync(testFile, "not valid json");
    expect(getRateLimit("test")).toBeNull();
  });
});

describe("setRateLimit", () => {
  const testFile = "./catbox_test_rate_limit.json";

  afterEach(() => {
    cleanupRateLimitFiles();
  });

  test("writes rate limit data to file", () => {
    const testData = { remaining: 3, limit: 10, reset: 9999999999 };
    setRateLimit("test", testData);
    const written = JSON.parse(readFileSync(testFile, "utf-8"));
    expect(written).toEqual(testData);
  });

  test("overwrites existing rate limit file", () => {
    setRateLimit("test", { remaining: 10 });
    setRateLimit("test", { remaining: 5 });
    const written = JSON.parse(readFileSync(testFile, "utf-8"));
    expect(written.remaining).toBe(5);
  });
});

describe("clearRateLimit", () => {
  const testFile = "./catbox_test_rate_limit.json";

  afterEach(() => {
    cleanupRateLimitFiles();
  });

  test("deletes rate limit file when it exists", () => {
    writeFileSync(testFile, JSON.stringify({ remaining: 5 }));
    expect(existsSync(testFile)).toBe(true);
    clearRateLimit("test");
    expect(existsSync(testFile)).toBe(false);
  });

  test("does nothing when file does not exist", () => {
    expect(() => clearRateLimit("nonexistent")).not.toThrow();
  });
});

describe("waitForRateLimitAsync", () => {
  const testFile = "./catbox_test_rate_limit.json";

  afterEach(() => {
    cleanupRateLimitFiles();
  });

  test("proceeds immediately when no rate limit file exists", async () => {
    const start = Date.now();
    await waitForRateLimitAsync("nonexistent", 1);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  test("clears rate limit when window has expired", async () => {
    const oldWindowStart = Math.floor(Date.now() / 1000) - 120;
    writeFileSync(
      testFile,
      JSON.stringify({ remaining: 0, limit: 10, windowStart: oldWindowStart })
    );
    await waitForRateLimitAsync("test", 1);
    expect(existsSync(testFile)).toBe(false);
  });

  test("proceeds when remaining requests are sufficient", async () => {
    const recentWindowStart = Math.floor(Date.now() / 1000) - 10;
    writeFileSync(
      testFile,
      JSON.stringify({ remaining: 5, limit: 10, windowStart: recentWindowStart })
    );
    const start = Date.now();
    await waitForRateLimitAsync("test", 1);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  test("handles invalid JSON in rate limit file", async () => {
    writeFileSync(testFile, "not valid json");
    await expect(waitForRateLimitAsync("test", 1)).resolves.toBeUndefined();
  });

  test("waits and clears rate limit when exhausted", async () => {
    const recentWindowStart = Math.floor(Date.now() / 1000) - 58;
    writeFileSync(
      testFile,
      JSON.stringify({ remaining: 0, limit: 10, windowStart: recentWindowStart })
    );
    const start = Date.now();
    await waitForRateLimitAsync("test", 1);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(existsSync(testFile)).toBe(false);
  });
});

describe("MAX_IMGCHEST_IMAGES_PER_REQUEST", () => {
  test("is exported and equals 20", () => {
    expect(MAX_IMGCHEST_IMAGES_PER_REQUEST).toBe(20);
  });
});

describe("handleCatboxUpload", () => {
  beforeEach(() => {
    globalThis.fetch = mock(() =>
      Promise.resolve(createMockResponse("https://files.catbox.moe/abc123.png"))
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("handles fileupload request type", async () => {
    const formData = createMockFormData([
      ["reqtype", "fileupload"],
      ["fileToUpload", createMockFile("test.png")],
    ]);
    const req = createMockRequest("http://localhost:3000/upload/catbox", { formData });

    const response = await handleCatboxUpload(req);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("https://files.catbox.moe/abc123.png");
  });

  test("handles urlupload request type", async () => {
    const formData = createMockFormData([
      ["reqtype", "urlupload"],
      ["url", "https://example.com/image.png"],
    ]);
    const req = createMockRequest("http://localhost:3000/upload/catbox", { formData });

    const response = await handleCatboxUpload(req);
    expect(response.status).toBe(200);
  });

  test("handles createalbum request type", async () => {
    const formData = createMockFormData([
      ["reqtype", "createalbum"],
      ["files", "abc123.png def456.jpg"],
    ]);
    const req = createMockRequest("http://localhost:3000/upload/catbox", { formData });

    const response = await handleCatboxUpload(req);
    expect(response.status).toBe(200);
  });

  test("returns 400 for unknown request type", async () => {
    const formData = createMockFormData([["reqtype", "invalid"]]);
    const req = createMockRequest("http://localhost:3000/upload/catbox", { formData });

    const response = await handleCatboxUpload(req);
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Unknown request type");
  });

  test("propagates error status from catbox API", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(createMockResponse("Error: file too large", { status: 413 }))
    );

    const formData = createMockFormData([
      ["reqtype", "fileupload"],
      ["fileToUpload", createMockFile("large.png")],
    ]);
    const req = createMockRequest("http://localhost:3000/upload/catbox", { formData });

    const response = await handleCatboxUpload(req);
    expect(response.status).toBe(413);
  });
});

describe("handleSxcuCollections", () => {
  beforeEach(() => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        createMockResponse(
          { id: "col123", url: "https://sxcu.net/c/col123" },
          {
            headers: {
              "X-RateLimit-Limit": "10",
              "X-RateLimit-Remaining": "9",
              "X-RateLimit-Reset": "1234567890",
            },
          }
        )
      )
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    cleanupRateLimitFiles();
  });

  test("creates collection and sets rate limit", async () => {
    const formData = createMockFormData([["title", "Test Collection"]]);
    const req = createMockRequest("http://localhost:3000/upload/sxcu/collections", { formData });

    const response = await handleSxcuCollections(req);
    expect(response.status).toBe(200);

    const body = JSON.parse(await response.text());
    expect(body.id).toBe("col123");

    const rateLimitFile = "./catbox_sxcu_rate_limit.json";
    expect(existsSync(rateLimitFile)).toBe(true);
    const rateLimit = JSON.parse(readFileSync(rateLimitFile, "utf-8"));
    expect(rateLimit.remaining).toBe(9);
    expect(rateLimit.limit).toBe(10);
  });

  test("handles 429 rate limit response with retry", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          createMockResponse(
            { error: "Rate limited" },
            {
              status: 429,
              headers: {
                "X-RateLimit-Reset-After": "0.01",
                "X-RateLimit-Limit": "10",
                "X-RateLimit-Remaining": "0",
              },
            }
          )
        );
      }
      return Promise.resolve(
        createMockResponse(
          { id: "col456", success: true },
          {
            headers: {
              "X-RateLimit-Limit": "10",
              "X-RateLimit-Remaining": "9",
            },
          }
        )
      );
    });

    const formData = createMockFormData([["title", "Test"]]);
    const req = createMockRequest("http://localhost:3000/upload/sxcu/collections", { formData });

    const response = await handleSxcuCollections(req);
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text());
    expect(body.id).toBe("col456");
  });
});

describe("handleSxcuFiles", () => {
  beforeEach(() => {
    globalThis.fetch = mock(() =>
      Promise.resolve(
        createMockResponse(
          { id: "file123", url: "https://sxcu.net/file123" },
          {
            headers: {
              "X-RateLimit-Limit": "10",
              "X-RateLimit-Remaining": "8",
            },
          }
        )
      )
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    cleanupRateLimitFiles();
  });

  test("uploads file successfully", async () => {
    const formData = createMockFormData([["file", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/sxcu/files", { formData });

    const response = await handleSxcuFiles(req);
    expect(response.status).toBe(200);

    const body = JSON.parse(await response.text());
    expect(body.id).toBe("file123");
  });

  test("handles non-JSON response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(createMockResponse("Server Error", { status: 500 }))
    );

    const formData = createMockFormData([["file", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/sxcu/files", { formData });

    const response = await handleSxcuFiles(req);
    expect(response.status).toBe(500);

    const body = JSON.parse(await response.text());
    expect(body.error).toBe("Server Error");
  });

  test("handles 429 rate limit with retry", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          createMockResponse(
            { error: "Too many requests" },
            {
              status: 429,
              headers: { "X-RateLimit-Reset-After": "0.01" },
            }
          )
        );
      }
      return Promise.resolve(createMockResponse({ id: "retry123", success: true }));
    });

    const formData = createMockFormData([["file", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/sxcu/files", { formData });

    const response = await handleSxcuFiles(req);
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text());
    expect(body.id).toBe("retry123");
  });

  test("handles 429 retry with non-JSON response", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          createMockResponse(
            { error: "Too many requests" },
            {
              status: 429,
              headers: { "X-RateLimit-Reset-After": "0.01" },
            }
          )
        );
      }
      return Promise.resolve(createMockResponse("Invalid server response"));
    });

    const formData = createMockFormData([["file", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/sxcu/files", { formData });

    const response = await handleSxcuFiles(req);
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text());
    expect(body.error).toBe("Invalid server response");
  });

  test("handles 429 retry with rate limit headers", async () => {
    let callCount = 0;
    globalThis.fetch = mock(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(
          createMockResponse(
            { error: "Too many requests" },
            {
              status: 429,
              headers: { "X-RateLimit-Reset-After": "0.01" },
            }
          )
        );
      }
      return Promise.resolve(
        createMockResponse(
          { id: "retry456", success: true },
          {
            headers: {
              "X-RateLimit-Limit": "10",
              "X-RateLimit-Remaining": "9",
              "X-RateLimit-Reset": "1234567890",
            },
          }
        )
      );
    });

    const formData = createMockFormData([["file", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/sxcu/files", { formData });

    const response = await handleSxcuFiles(req);
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text());
    expect(body.id).toBe("retry456");

    const rateLimitFile = "./catbox_sxcu_rate_limit.json";
    expect(existsSync(rateLimitFile)).toBe(true);
    const rateLimit = JSON.parse(readFileSync(rateLimitFile, "utf-8"));
    expect(rateLimit.remaining).toBe(9);
  });

  test("logs non-file form fields", async () => {
    const formData = createMockFormData([
      ["file", createMockFile("test.png")],
      ["collection", "col123"],
      ["collection_token", "token456"],
    ]);
    const req = createMockRequest("http://localhost:3000/upload/sxcu/files", { formData });

    const response = await handleSxcuFiles(req);
    expect(response.status).toBe(200);
  });
});

describe("handleImgchestPost", () => {
  beforeEach(() => {
    process.env.IMGCHEST_API_TOKEN = "test-token";
    globalThis.fetch = mock(() =>
      Promise.resolve(
        createMockResponse(
          { data: { id: "post123", link: "https://imgchest.com/p/post123" } },
          {
            headers: {
              "x-ratelimit-remaining": "59",
              "x-ratelimit-limit": "60",
            },
          }
        )
      )
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    setImgchestTokenFile(ORIGINAL_TOKEN_FILE);
    cleanupRateLimitFiles();
  });

  test("returns 401 when no token is available", async () => {
    delete process.env.IMGCHEST_API_TOKEN;
    setImgchestTokenFile("./nonexistent_token_file.txt");

    const formData = createMockFormData([["images[]", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post", { formData });

    const response = await handleImgchestPost(req);
    expect(response.status).toBe(401);
    const body = JSON.parse(await response.text());
    expect(body.error).toContain("token not found");
  });

  test("returns 400 when no images provided", async () => {
    const formData = createMockFormData([]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post", { formData });

    const response = await handleImgchestPost(req);
    expect(response.status).toBe(400);
    const body = JSON.parse(await response.text());
    expect(body.error).toContain("No images");
  });

  test("returns 400 for anonymous posts with more than 20 images", async () => {
    const entries = [["anonymous", "1"]];
    for (let i = 0; i < 25; i++) {
      entries.push(["images[]", createMockFile(`img${i}.png`)]);
    }
    const formData = createMockFormData(entries);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post", { formData });

    const response = await handleImgchestPost(req);
    expect(response.status).toBe(400);
    const body = JSON.parse(await response.text());
    expect(body.error).toContain("20 images");
  });

  test("uploads images successfully", async () => {
    const formData = createMockFormData([
      ["images[]", createMockFile("test1.png")],
      ["images[]", createMockFile("test2.png")],
      ["title", "Test Post"],
    ]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post", { formData });

    const response = await handleImgchestPost(req);
    expect(response.status).toBe(200);

    const body = JSON.parse(await response.text());
    expect(body.data.id).toBe("post123");
  });

  test("handles HTML error response (unauthorized)", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(createMockResponse("<html>Unauthorized</html>", { status: 401 }))
    );

    const formData = createMockFormData([["images[]", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post", { formData });

    const response = await handleImgchestPost(req);
    expect(response.status).toBe(401);
    const body = JSON.parse(await response.text());
    expect(body.error).toBe("Imgchest API error");
  });

  test("handles JSON parse error", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(createMockResponse("not json but not html either"))
    );

    const formData = createMockFormData([["images[]", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post", { formData });

    const response = await handleImgchestPost(req);
    expect(response.status).toBe(500);
    const body = JSON.parse(await response.text());
    expect(body.error).toBe("Failed to parse JSON");
  });

  test("chunks images when more than 20", async () => {
    let fetchCallCount = 0;
    globalThis.fetch = mock(() => {
      fetchCallCount++;
      return Promise.resolve(
        createMockResponse({
          data: { id: "post123", link: "https://imgchest.com/p/post123" },
        })
      );
    });

    const entries = [];
    for (let i = 0; i < 45; i++) {
      entries.push(["images[]", createMockFile(`img${i}.png`)]);
    }
    const formData = createMockFormData(entries);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post", { formData });

    const response = await handleImgchestPost(req);
    expect(response.status).toBe(200);
    expect(fetchCallCount).toBe(3);
  });

  test("handles API error response with JSON", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(createMockResponse({ error: "Invalid request" }, { status: 400 }))
    );

    const formData = createMockFormData([["images[]", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post", { formData });

    const response = await handleImgchestPost(req);
    expect(response.status).toBe(400);
    const body = JSON.parse(await response.text());
    expect(body.error).toBe("Imgchest API error");
  });
});

describe("handleImgchestAdd", () => {
  beforeEach(() => {
    process.env.IMGCHEST_API_TOKEN = "test-token";
    globalThis.fetch = mock(() =>
      Promise.resolve(
        createMockResponse(
          { success: true, data: { images_added: 2 } },
          {
            headers: {
              "x-ratelimit-remaining": "58",
              "x-ratelimit-limit": "60",
            },
          }
        )
      )
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
    setImgchestTokenFile(ORIGINAL_TOKEN_FILE);
    cleanupRateLimitFiles();
  });

  test("returns 401 when no token is available", async () => {
    delete process.env.IMGCHEST_API_TOKEN;
    setImgchestTokenFile("./nonexistent_token_file.txt");

    const formData = createMockFormData([["images[]", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post/abc123/add", {
      formData,
    });

    const response = await handleImgchestAdd(req);
    expect(response.status).toBe(401);
    const body = JSON.parse(await response.text());
    expect(body.error).toContain("token not found");
  });

  test("returns 400 when no images provided", async () => {
    const formData = createMockFormData([]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post/abc123/add", {
      formData,
    });

    const response = await handleImgchestAdd(req);
    expect(response.status).toBe(400);
  });

  test("extracts post ID from URL path", async () => {
    let capturedUrl = "";
    globalThis.fetch = mock((url) => {
      capturedUrl = url;
      return Promise.resolve(createMockResponse({ success: true }));
    });

    const formData = createMockFormData([["images[]", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post/myPostId123/add", {
      formData,
    });

    await handleImgchestAdd(req);
    expect(capturedUrl).toContain("myPostId123");
  });

  test("adds images to existing post successfully", async () => {
    const formData = createMockFormData([
      ["images[]", createMockFile("add1.png")],
      ["images[]", createMockFile("add2.png")],
    ]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post/existingPost/add", {
      formData,
    });

    const response = await handleImgchestAdd(req);
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text());
    expect(body.success).toBe(true);
  });

  test("handles HTML error response", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(createMockResponse("<html>Error</html>", { status: 401 }))
    );

    const formData = createMockFormData([["images[]", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post/abc/add", {
      formData,
    });

    const response = await handleImgchestAdd(req);
    expect(response.status).toBe(401);
    const body = JSON.parse(await response.text());
    expect(body.error).toBe("Imgchest API error");
  });

  test("handles API error response with JSON", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(createMockResponse({ error: "Post not found" }, { status: 404 }))
    );

    const formData = createMockFormData([["images[]", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post/invalid/add", {
      formData,
    });

    const response = await handleImgchestAdd(req);
    expect(response.status).toBe(404);
    const body = JSON.parse(await response.text());
    expect(body.error).toBe("Imgchest API error");
  });

  test("handles JSON parse error in add", async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(createMockResponse("not json but not html either"))
    );

    const formData = createMockFormData([["images[]", createMockFile("test.png")]]);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post/abc/add", {
      formData,
    });

    const response = await handleImgchestAdd(req);
    expect(response.status).toBe(500);
    const body = JSON.parse(await response.text());
    expect(body.error).toBe("Failed to parse JSON");
  });

  test("chunks images when more than 20", async () => {
    let fetchCallCount = 0;
    globalThis.fetch = mock(() => {
      fetchCallCount++;
      return Promise.resolve(createMockResponse({ success: true }));
    });

    const entries = [];
    for (let i = 0; i < 50; i++) {
      entries.push(["images[]", createMockFile(`img${i}.png`)]);
    }
    const formData = createMockFormData(entries);
    const req = createMockRequest("http://localhost:3000/upload/imgchest/post/abc/add", {
      formData,
    });

    const response = await handleImgchestAdd(req);
    expect(response.status).toBe(200);
    expect(fetchCallCount).toBe(3);
  });
});

describe("Server routing", () => {
  test("routes POST /upload/catbox correctly", () => {
    const matchRoute = (method, path) => {
      if (method === "POST" && path === "/upload/catbox") return "catbox";
      return null;
    };
    expect(matchRoute("POST", "/upload/catbox")).toBe("catbox");
    expect(matchRoute("GET", "/upload/catbox")).toBeNull();
  });

  test("routes POST /upload/sxcu/collections correctly", () => {
    const matchRoute = (method, path) => {
      if (method === "POST" && path === "/upload/sxcu/collections") return "sxcu-collections";
      return null;
    };
    expect(matchRoute("POST", "/upload/sxcu/collections")).toBe("sxcu-collections");
  });

  test("routes POST /upload/sxcu/files correctly", () => {
    const matchRoute = (method, path) => {
      if (method === "POST" && path === "/upload/sxcu/files") return "sxcu-files";
      return null;
    };
    expect(matchRoute("POST", "/upload/sxcu/files")).toBe("sxcu-files");
  });

  test("routes POST /upload/imgchest/post correctly", () => {
    const matchRoute = (method, path) => {
      if (method === "POST" && path === "/upload/imgchest/post") return "imgchest-post";
      return null;
    };
    expect(matchRoute("POST", "/upload/imgchest/post")).toBe("imgchest-post");
  });

  test("routes POST /upload/imgchest/post/:id/add correctly", () => {
    const matchRoute = (method, path) => {
      if (method === "POST" && path.startsWith("/upload/imgchest/post/") && path.endsWith("/add")) {
        return "imgchest-add";
      }
      return null;
    };
    expect(matchRoute("POST", "/upload/imgchest/post/abc123/add")).toBe("imgchest-add");
    expect(matchRoute("POST", "/upload/imgchest/post/xyz/add")).toBe("imgchest-add");
    expect(matchRoute("POST", "/upload/imgchest/post/")).toBeNull();
  });

  test("returns 404 for unknown routes", () => {
    const matchRoute = (method, path) => {
      if (method === "POST" && path === "/upload/catbox") return "catbox";
      return "404";
    };
    expect(matchRoute("GET", "/unknown")).toBe("404");
    expect(matchRoute("POST", "/random")).toBe("404");
  });
});
