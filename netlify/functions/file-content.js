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

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        error: "Method not allowed."
      })
    };
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          error: "Missing OPENAI_API_KEY on server."
        })
      };
    }

    const query = event.queryStringParameters || {};
    const fileId = typeof query.fileId === "string" ? query.fileId.trim() : "";
    const requestedFilename =
      typeof query.filename === "string" ? query.filename.trim() : "";
    const containerId =
      typeof query.container_id === "string" ? query.container_id.trim() : "";

    if (!fileId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          error: "Missing file_id."
        })
      };
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

      return {
        statusCode: upstreamResponse.status,
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          error: message,
          status: upstreamResponse.status
        })
      };
    }

    const attachmentFilename = getAttachmentFilename(
      fileId,
      requestedFilename,
      upstreamResponse.headers.get("content-disposition")
    );
    const contentType =
      upstreamResponse.headers.get("content-type") || "application/octet-stream";
    const fileBuffer = Buffer.from(await upstreamResponse.arrayBuffer());

    const headers = {
      "Content-Type": contentType,
      "Content-Disposition": toAttachmentHeader(attachmentFilename)
    };

    return {
      statusCode: 200,
      headers,
      isBase64Encoded: true,
      body: fileBuffer.toString("base64")
    };
  } catch (error) {
    console.error("File download function error:", error && error.message);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        error: "Unexpected server error while downloading the file."
      })
    };
  }
};
