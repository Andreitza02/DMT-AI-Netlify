const crypto = require("crypto");
const path = require("path");

const express = require("express");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const app = express();

const PORT = process.env.PORT || 3000;
const WORKFLOW_ID =
  process.env.WORKFLOW_ID ||
  "wf_68e4cfa8a674819081622f5d73083e5b0874867723c55c75";
const APP_LOGIN_USERNAME = process.env.APP_LOGIN_USERNAME || "admin";
const APP_LOGIN_PASSWORD = process.env.APP_LOGIN_PASSWORD || "DmtAi-Access-2026!";
const APP_SESSION_SECRET =
  process.env.APP_SESSION_SECRET ||
  process.env.OPENAI_API_KEY ||
  "dmt-ai-local-session-secret";
const SESSION_COOKIE_NAME = "dmt_ai_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const STATIC_ROOT = path.join(__dirname, "public");
const LOGIN_PAGE_PATH = path.join(STATIC_ROOT, "login.html");

app.set("trust proxy", 1);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

function createFallbackUserId() {
  if (typeof crypto.randomUUID === "function") {
    return `anon_${crypto.randomUUID()}`;
  }
  return `anon_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseCookies(cookieHeader) {
  if (typeof cookieHeader !== "string" || !cookieHeader.trim()) {
    return {};
  }

  return cookieHeader.split(";").reduce((cookies, entry) => {
    const [rawName, ...rawValue] = entry.trim().split("=");
    if (!rawName) {
      return cookies;
    }

    const value = rawValue.join("=");
    if (!value) {
      cookies[rawName] = "";
      return cookies;
    }

    try {
      cookies[rawName] = decodeURIComponent(value);
    } catch {
      cookies[rawName] = value;
    }

    return cookies;
  }, {});
}

function safeEqualStrings(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSessionSignature(payload) {
  return crypto
    .createHmac("sha256", APP_SESSION_SECRET)
    .update(payload)
    .digest("base64url");
}

function createSessionToken(username) {
  const payload = Buffer.from(
    JSON.stringify({
      username,
      exp: Date.now() + SESSION_TTL_MS
    })
  ).toString("base64url");

  return `${payload}.${createSessionSignature(payload)}`;
}

function readSessionToken(token) {
  if (typeof token !== "string") {
    return null;
  }

  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) {
    return null;
  }

  const expectedSignature = createSessionSignature(payload);
  if (!safeEqualStrings(signature, expectedSignature)) {
    return null;
  }

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );

    if (
      !session ||
      typeof session.username !== "string" ||
      !session.username.trim() ||
      typeof session.exp !== "number" ||
      session.exp <= Date.now()
    ) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

function getAuthSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  return readSessionToken(cookies[SESSION_COOKIE_NAME]);
}

function setAuthCookie(req, res, token) {
  const isSecure =
    req.secure || String(req.get("x-forwarded-proto") || "").includes("https");
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];

  if (isSecure) {
    cookieParts.push("Secure");
  }

  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

function clearAuthCookie(req, res) {
  const isSecure =
    req.secure || String(req.get("x-forwarded-proto") || "").includes("https");
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0"
  ];

  if (isSecure) {
    cookieParts.push("Secure");
  }

  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

function sanitizeNextPath(rawValue) {
  if (typeof rawValue !== "string") {
    return "/";
  }

  const trimmed = rawValue.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }

  if (trimmed.startsWith("/login") || trimmed.startsWith("/logout")) {
    return "/";
  }

  return trimmed || "/";
}

function buildLoginUrl(nextPath, errorCode, loggedOut = false) {
  const params = new URLSearchParams();
  const safeNextPath = sanitizeNextPath(nextPath);

  if (safeNextPath !== "/") {
    params.set("next", safeNextPath);
  }

  if (errorCode) {
    params.set("error", errorCode);
  }

  if (loggedOut) {
    params.set("logout", "1");
  }

  const query = params.toString();
  return query ? `/login?${query}` : "/login";
}

function isPublicRequest(req) {
  if (req.method === "POST" && req.path === "/login") {
    return true;
  }

  if (req.method === "GET") {
    return (
      req.path === "/login" ||
      req.path === "/logout" ||
      req.path === "/login.css" ||
      req.path === "/login.js" ||
      req.path === "/favicon.ico" ||
      req.path.startsWith("/assets/")
    );
  }

  return false;
}

function requireAuth(req, res, next) {
  if (isPublicRequest(req)) {
    return next();
  }

  const session = getAuthSession(req);
  if (session) {
    req.authSession = session;
    return next();
  }

  clearAuthCookie(req, res);

  if (req.path.startsWith("/api/")) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  return res.redirect(buildLoginUrl(req.originalUrl));
}

function getAttachmentFilename(fileId, requestedFilename, upstreamHeader) {
  const fallback = typeof requestedFilename === "string" ? requestedFilename.trim() : "";
  if (fallback) {
    return fallback;
  }

  const match = typeof upstreamHeader === "string"
    ? upstreamHeader.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)
    : null;

  if (match && match[1]) {
    const rawFilename = match[1].replace(/"/g, "").trim();
    try {
      return decodeURIComponent(rawFilename);
    } catch {
      return rawFilename;
    }
  }

  return `${fileId}.bin`;
}

function toAttachmentHeader(filename) {
  const safeName = filename.replace(/[\r\n"]/g, "_");
  const encodedName = encodeURIComponent(filename);
  return `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`;
}

app.get("/login", (req, res) => {
  const session = getAuthSession(req);
  if (session) {
    return res.redirect(sanitizeNextPath(req.query.next));
  }

  return res.sendFile(LOGIN_PAGE_PATH);
});

app.post("/login", (req, res) => {
  const username =
    typeof req.body.username === "string" ? req.body.username.trim() : "";
  const password =
    typeof req.body.password === "string" ? req.body.password : "";
  const nextPath = sanitizeNextPath(req.body.next);
  const isValidLogin =
    safeEqualStrings(username, APP_LOGIN_USERNAME) &&
    safeEqualStrings(password, APP_LOGIN_PASSWORD);

  if (!isValidLogin) {
    clearAuthCookie(req, res);
    return res.redirect(buildLoginUrl(nextPath, "invalid_credentials"));
  }

  setAuthCookie(req, res, createSessionToken(username));
  return res.redirect(nextPath);
});

app.get("/logout", (req, res) => {
  clearAuthCookie(req, res);
  return res.redirect(buildLoginUrl("/", "", true));
});

app.use(requireAuth);
app.use(express.static(STATIC_ROOT));

app.post("/api/chatkit/session", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY on server."
      });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const incomingUserId =
      typeof body.userId === "string" ? body.userId.trim() : "";
    const userId = incomingUserId || createFallbackUserId();

    const upstreamResponse = await fetch(
      "https://api.openai.com/v1/chatkit/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
          "OpenAI-Beta": "chatkit_beta=v1"
        },
        body: JSON.stringify({
          user: userId,
          workflow: {
            id: WORKFLOW_ID
          },
          chatkit_configuration: {
            file_upload: {
              enabled: false
            },
            history: {
              enabled: true
            }
          }
        })
      }
    );

    const rawText = await upstreamResponse.text();
    let upstreamJson = {};
    if (rawText) {
      try {
        upstreamJson = JSON.parse(rawText);
      } catch {
        upstreamJson = { message: rawText };
      }
    }

    if (!upstreamResponse.ok) {
      let message =
        upstreamJson?.error?.message ||
        upstreamJson?.message ||
        "Failed to create ChatKit session.";

      // Do not leak upstream auth error details that may include key fingerprints.
      if (upstreamResponse.status === 401) {
        message = "OpenAI authentication failed. Verify OPENAI_API_KEY on server.";
      }

      return res.status(upstreamResponse.status).json({
        error: message,
        status: upstreamResponse.status
      });
    }

    const clientSecret = upstreamJson?.client_secret;
    if (!clientSecret) {
      return res.status(502).json({
        error: "ChatKit session response missing client_secret."
      });
    }

    return res.json({ client_secret: clientSecret });
  } catch (error) {
    console.error("Session endpoint error:", error && error.message);
    return res.status(500).json({
      error: "Unexpected server error while creating ChatKit session."
    });
  }
});

app.get("/api/chatkit/threads/:threadId/items", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY on server."
      });
    }

    const threadId =
      typeof req.params.threadId === "string" ? req.params.threadId.trim() : "";

    if (!threadId) {
      return res.status(400).json({
        error: "Missing thread_id."
      });
    }

    const upstreamResponse = await fetch(
      `https://api.openai.com/v1/chatkit/threads/${encodeURIComponent(
        threadId
      )}/items`,
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "OpenAI-Beta": "chatkit_beta=v1"
        }
      }
    );

    const rawText = await upstreamResponse.text();
    let upstreamJson = {};

    if (rawText) {
      try {
        upstreamJson = JSON.parse(rawText);
      } catch {
        upstreamJson = { message: rawText };
      }
    }

    if (!upstreamResponse.ok) {
      let message =
        upstreamJson?.error?.message ||
        upstreamJson?.message ||
        "Failed to load ChatKit thread items.";

      if (upstreamResponse.status === 401) {
        message = "OpenAI authentication failed. Verify OPENAI_API_KEY on server.";
      }

      return res.status(upstreamResponse.status).json({
        error: message,
        status: upstreamResponse.status
      });
    }

    return res.json(upstreamJson);
  } catch (error) {
    console.error("Thread items endpoint error:", error && error.message);
    return res.status(500).json({
      error: "Unexpected server error while loading thread items."
    });
  }
});

app.get("/api/files/:fileId/content", async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "Missing OPENAI_API_KEY on server."
      });
    }

    const fileId =
      typeof req.params.fileId === "string" ? req.params.fileId.trim() : "";
    const requestedFilename =
      typeof req.query.filename === "string" ? req.query.filename.trim() : "";
    const containerId =
      typeof req.query.container_id === "string" ? req.query.container_id.trim() : "";

    if (!fileId) {
      return res.status(400).json({
        error: "Missing file_id."
      });
    }

    const upstreamHeaders = {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    };

    let upstreamResponse = await fetch(
      `https://api.openai.com/v1/files/${encodeURIComponent(fileId)}/content`,
      {
        headers: upstreamHeaders
      }
    );

    if (!upstreamResponse.ok && containerId) {
      upstreamResponse = await fetch(
        `https://api.openai.com/v1/containers/${encodeURIComponent(
          containerId
        )}/files/${encodeURIComponent(fileId)}/content`,
        {
          headers: upstreamHeaders
        }
      );
    }

    if (!upstreamResponse.ok) {
      const rawText = await upstreamResponse.text();
      let upstreamJson = {};

      if (rawText) {
        try {
          upstreamJson = JSON.parse(rawText);
        } catch {
          upstreamJson = { message: rawText };
        }
      }

      let message =
        upstreamJson?.error?.message ||
        upstreamJson?.message ||
        "Failed to download file.";

      if (upstreamResponse.status === 401) {
        message = "OpenAI authentication failed. Verify OPENAI_API_KEY on server.";
      }

      return res.status(upstreamResponse.status).json({
        error: message,
        status: upstreamResponse.status
      });
    }

    const attachmentFilename = getAttachmentFilename(
      fileId,
      requestedFilename,
      upstreamResponse.headers.get("content-disposition")
    );
    const contentType =
      upstreamResponse.headers.get("content-type") || "application/octet-stream";
    const fileBuffer = Buffer.from(await upstreamResponse.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", toAttachmentHeader(attachmentFilename));

    const contentLength = upstreamResponse.headers.get("content-length");
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    return res.send(fileBuffer);
  } catch (error) {
    console.error("File download endpoint error:", error && error.message);
    return res.status(500).json({
      error: "Unexpected server error while downloading the file."
    });
  }
});

app.use((err, req, res, next) => {
  console.error("Unhandled express error:", err && err.message);
  return res.status(500).json({
    error: "Unexpected server failure."
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
