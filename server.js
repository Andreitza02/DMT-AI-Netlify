const crypto = require("crypto");
const path = require("path");

const express = require("express");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const app = express();

const PORT = process.env.PORT || 3000;
const WORKFLOW_ID =
  process.env.WORKFLOW_ID ||
  "wf_68e4cfa8a674819081622f5d73083e5b0874867723c55c75";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function createFallbackUserId() {
  if (typeof crypto.randomUUID === "function") {
    return `anon_${crypto.randomUUID()}`;
  }
  return `anon_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
              enabled: true
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
