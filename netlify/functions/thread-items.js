exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json"
  };

  if (event.httpMethod !== "GET") {
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

    const threadId =
      typeof event.queryStringParameters?.threadId === "string"
        ? event.queryStringParameters.threadId.trim()
        : "";

    if (!threadId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "Missing thread_id."
        })
      };
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

      return {
        statusCode: upstreamResponse.status,
        headers,
        body: JSON.stringify({
          error: message,
          status: upstreamResponse.status
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(upstreamJson)
    };
  } catch (error) {
    console.error("Thread items function error:", error && error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Unexpected server error while loading thread items."
      })
    };
  }
};
