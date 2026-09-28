// Zero-dependency static file server for the workshop starter.
// Serves this directory on 0.0.0.0:3000 so the app shows up at
// https://michiel.sdai.nl once the container is running.
// Also exposes POST /api/chat, which proxies the full conversation to
// https://q38-27b.sdai.nl/v1/chat/completions (model qwen3.8-27b).
// The API key is read from .env on the server only — never sent to the browser.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// Load QWEN_API_KEY from .env (server-side only).
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch (err) {
  console.warn("No .env file found — POST /api/chat will fail without QWEN_API_KEY.");
}

const QWEN_API_KEY = process.env.QWEN_API_KEY || "";
const QWEN_URL = "https://q38-27b.sdai.nl/v1/chat/completions";
const MODEL = "qwen3.8-27b";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function serveStatic(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end("<h1>404 — Not Found</h1>");
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
    });
    res.end(data);
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const rel = decodeURIComponent(url.pathname);

    // Chat proxy: forwards the entire conversation to the Qwen endpoint.
    if (rel === "/api/chat" && req.method === "POST") {
      try {
        if (!QWEN_API_KEY) {
          return sendJSON(res, 500, {
            error: "QWEN_API_KEY is not configured on the server.",
          });
        }

        const raw = await readBody(req);
        let messages;
        try {
          const parsed = JSON.parse(raw);
          messages = Array.isArray(parsed) ? parsed : parsed.messages;
        } catch {
          return sendJSON(res, 400, {
            error: "Invalid JSON body. Expected an array of chat messages.",
          });
        }

        if (!Array.isArray(messages) || messages.length === 0) {
          return sendJSON(res, 400, {
            error: "messages must be a non-empty array.",
          });
        }

        const upstream = await fetch(QWEN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${QWEN_API_KEY}`,
          },
          body: JSON.stringify({ model: MODEL, messages }),
        });

        const text = await upstream.text();
        if (!upstream.ok) {
          return sendJSON(res, upstream.status, {
            error: "Upstream error",
            detail: text,
          });
        }

        res.writeHead(upstream.status, {
          "Content-Type": "application/json; charset=utf-8",
        });
        return res.end(text);
      } catch (err) {
        return sendJSON(res, 500, { error: err.message });
      }
    }

    // Static file serving.
    let fileRel = rel === "/" ? "/index.html" : rel;
    const file = path.join(ROOT, path.normalize(fileRel));
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    serveStatic(res, file);
  })
  .listen(PORT, "0.0.0.0", () =>
    console.log(`michiel-website serving ${ROOT} on http://0.0.0.0:${PORT}`)
  );