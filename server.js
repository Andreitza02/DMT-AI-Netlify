const crypto = require("crypto");
const path = require("path");

const express = require("express");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const app = express();

const PORT = process.env.PORT || 3000;
const WORKFLOW_ID = "wf_68e4cfa8a674819081622f5d73083e5b0874867723c55c75";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function createFallbackUserId() {
  if (typeof crypto.randomUUID === "function") {
    return `anon_${crypto.randomUUID()}`;
  }
  return `anon_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
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
              enabled: true,
              max_files: 3,
              max_file_size: 20
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

app.use((err, req, res, next) => {
  console.error("Unhandled express error:", err && err.message);
  return res.status(500).json({
    error: "Unexpected server failure."
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
