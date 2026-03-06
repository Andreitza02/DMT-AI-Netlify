const crypto = require("crypto");

const DEFAULT_WORKFLOW_ID =
  "wf_68e4cfa8a674819081622f5d73083e5b0874867723c55c75";

function createFallbackUserId() {
  if (typeof crypto.randomUUID === "function") {
    return `anon_${crypto.randomUUID()}`;
  }

  return `anon_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json"
  };

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        error: "Method not allowed."
      })
    };
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: "Missing OPENAI_API_KEY on server."
        })
      };
    }

    const workflowId = process.env.WORKFLOW_ID || DEFAULT_WORKFLOW_ID;
    const body =
      event.body && typeof event.body === "string" ? JSON.parse(event.body) : {};
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
            id: workflowId
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

      if (upstreamResponse.status === 401) {
        message = "OpenAI authentication failed. Verify OPENAI_API_KEY on server.";
      }

      return {
        statusCode: upstreamResponse.status,
        headers,
        body: JSON.stringify({
          error: message,
          status: upstreamResponse.status
        })
      };
    }

    const clientSecret = upstreamJson?.client_secret;
    if (!clientSecret) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: "ChatKit session response missing client_secret."
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        client_secret: clientSecret
      })
    };
  } catch (error) {
    console.error("ChatKit function error:", error && error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Unexpected server error while creating ChatKit session."
      })
    };
  }
};
