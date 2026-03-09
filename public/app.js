const statusBlock = document.getElementById("statusBlock");
const statusMessage = document.getElementById("statusMessage");
const retryButton = document.getElementById("retryButton");
const generatedFilesPanel = document.getElementById("generatedFilesPanel");
const generatedFilesList = document.getElementById("generatedFilesList");
const chatkitMount = document.getElementById("chatkitMount");
const brandLogo = document.getElementById("brandLogo");
const logoFallback = document.getElementById("logoFallback");

const USER_ID_STORAGE_KEY = "chatkit_demo_user_id";
const ASSISTANT_NAME = "Electric Department AI \u26A1";
const ATTACHMENT_ACCEPT = {
  "application/pdf": [".pdf"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "text/csv": [".csv"],
  "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif"]
};
let chatInitialized = false;
let readyTimerId = null;
let primedClientSecret = null;
let activeThreadId = null;
let generatedFilesRequestId = 0;
let generatedFilesRefreshId = null;
let lastRenderedGeneratedFilesKey = "";

function ensureUserId() {
  let userId = localStorage.getItem(USER_ID_STORAGE_KEY);
  if (!userId) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      userId = `web_${window.crypto.randomUUID()}`;
    } else {
      userId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
    localStorage.setItem(USER_ID_STORAGE_KEY, userId);
  }
  return userId;
}

async function requestClientSecret() {
  const response = await fetch("/api/chatkit/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ userId: ensureUserId() })
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || "Failed to fetch a ChatKit session.");
  }

  if (!data.client_secret) {
    throw new Error("Session endpoint response missing client_secret.");
  }

  return data.client_secret;
}

async function getClientSecret() {
  if (primedClientSecret) {
    const value = primedClientSecret;
    primedClientSecret = null;
    return value;
  }

  return requestClientSecret();
}

function setStatus(message, isError = false, showRetry = false) {
  statusBlock.hidden = false;
  statusBlock.classList.toggle("is-error", Boolean(isError));
  statusMessage.textContent = message;
  retryButton.hidden = !showRetry;
}

function hideStatus() {
  if (readyTimerId) {
    clearTimeout(readyTimerId);
    readyTimerId = null;
  }

  statusBlock.hidden = true;
  retryButton.hidden = true;
  statusBlock.classList.remove("is-error");
}

function hideGeneratedFiles() {
  lastRenderedGeneratedFilesKey = "";
  generatedFilesList.innerHTML = "";
  generatedFilesPanel.hidden = true;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return "";
}

function getThreadItems(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.data)) {
    return payload.data;
  }
  if (Array.isArray(payload?.items)) {
    return payload.items;
  }
  return [];
}

function toGeneratedFile(annotation) {
  if (!annotation || typeof annotation !== "object") {
    return null;
  }

  const type = firstNonEmptyString(annotation.type, annotation.source?.type).toLowerCase();
  if (type && !type.includes("file")) {
    return null;
  }

  const fileId = firstNonEmptyString(
    annotation.file_id,
    annotation.fileId,
    annotation.id,
    annotation.source?.file_id,
    annotation.source?.fileId,
    annotation.container_file_citation?.file_id,
    annotation.container_file?.file_id,
    annotation.file?.id
  );
  const filename = firstNonEmptyString(
    annotation.filename,
    annotation.file_name,
    annotation.source?.filename,
    annotation.container_file_citation?.filename,
    annotation.container_file?.filename,
    annotation.file?.filename
  );
  const containerId = firstNonEmptyString(
    annotation.container_id,
    annotation.containerId,
    annotation.source?.container_id,
    annotation.source?.containerId,
    annotation.container_file_citation?.container_id,
    annotation.container_file?.container_id
  );

  if (!fileId || !filename) {
    return null;
  }

  return {
    fileId,
    filename,
    containerId
  };
}

function collectGeneratedFiles(node, files, visited) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (visited.has(node)) {
    return;
  }
  visited.add(node);

  if (Array.isArray(node)) {
    for (const entry of node) {
      collectGeneratedFiles(entry, files, visited);
    }
    return;
  }

  const generatedFile = toGeneratedFile(node);
  if (generatedFile) {
    files.push(generatedFile);
  }

  for (const value of Object.values(node)) {
    collectGeneratedFiles(value, files, visited);
  }
}

function extractAssistantGeneratedFiles(items) {
  const generatedFiles = [];
  const visited = new WeakSet();

  for (const item of items) {
    const type = firstNonEmptyString(item?.type, item?.item_type).toLowerCase();
    if (type !== "assistant_message") {
      continue;
    }
    collectGeneratedFiles(item, generatedFiles, visited);
  }

  const uniqueFiles = [];
  const seenKeys = new Set();

  for (let index = generatedFiles.length - 1; index >= 0; index -= 1) {
    const file = generatedFiles[index];
    const fileKey = [file.fileId, file.containerId, file.filename].join("::");
    if (seenKeys.has(fileKey)) {
      continue;
    }
    seenKeys.add(fileKey);
    uniqueFiles.push(file);
  }

  return uniqueFiles.reverse();
}

function buildDownloadUrl(file) {
  const params = new URLSearchParams();
  params.set("filename", file.filename);
  if (file.containerId) {
    params.set("container_id", file.containerId);
  }
  return `/api/files/${encodeURIComponent(file.fileId)}/content?${params.toString()}`;
}

function renderGeneratedFiles(files) {
  const nextKey = JSON.stringify(files);
  if (nextKey === lastRenderedGeneratedFilesKey) {
    return;
  }

  lastRenderedGeneratedFilesKey = nextKey;
  generatedFilesList.innerHTML = "";

  if (!files.length) {
    generatedFilesPanel.hidden = true;
    return;
  }

  for (const file of files) {
    const item = document.createElement("div");
    item.className = "generated-file-item";

    const filename = document.createElement("span");
    filename.className = "generated-file-name";
    filename.textContent = file.filename;

    const link = document.createElement("a");
    link.className = "generated-file-link";
    link.href = buildDownloadUrl(file);
    link.download = file.filename;
    link.textContent = `Download ${file.filename}`;

    item.appendChild(filename);
    item.appendChild(link);
    generatedFilesList.appendChild(item);
  }

  generatedFilesPanel.hidden = false;
}

async function refreshGeneratedFiles(threadId) {
  if (!threadId) {
    hideGeneratedFiles();
    return;
  }

  const requestId = generatedFilesRequestId + 1;
  generatedFilesRequestId = requestId;

  try {
    const response = await fetch(
      `/api/chatkit/threads/${encodeURIComponent(threadId)}/items`,
      {
        headers: {
          Accept: "application/json"
        }
      }
    );

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (requestId !== generatedFilesRequestId) {
      return;
    }

    if (!response.ok) {
      throw new Error(data.error || "Failed to load generated files.");
    }

    renderGeneratedFiles(extractAssistantGeneratedFiles(getThreadItems(data)));
  } catch (error) {
    if (requestId !== generatedFilesRequestId) {
      return;
    }
    console.error("Generated files refresh failed:", error);
  }
}

function scheduleGeneratedFilesRefresh(threadId, delayMs = 250) {
  if (!threadId) {
    hideGeneratedFiles();
    return;
  }

  activeThreadId = threadId;

  if (generatedFilesRefreshId) {
    clearTimeout(generatedFilesRefreshId);
  }

  generatedFilesRefreshId = setTimeout(() => {
    generatedFilesRefreshId = null;
    refreshGeneratedFiles(activeThreadId);
  }, delayMs);
}

async function waitForChatKitElement(timeoutMs = 10000) {
  if (customElements.get("openai-chatkit")) {
    return;
  }

  await Promise.race([
    customElements.whenDefined("openai-chatkit"),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("ChatKit script load timeout.")), timeoutMs);
    })
  ]);
}

async function initChatKit() {
  if (chatInitialized) {
    return;
  }

  setStatus("Loading assistant...");
  chatkitMount.hidden = false;
  hideGeneratedFiles();
  activeThreadId = null;

  try {
    primedClientSecret = await requestClientSecret();
    await waitForChatKitElement();

    const chatkit = document.createElement("openai-chatkit");
    chatkit.style.height = "100%";

    chatkit.addEventListener("chatkit.ready", hideStatus);
    chatkit.addEventListener("chatkit.thread.load.end", (event) => {
      hideStatus();
      scheduleGeneratedFilesRefresh(event?.detail?.threadId || activeThreadId);
    });
    chatkit.addEventListener("chatkit.thread.change", (event) => {
      const threadId = firstNonEmptyString(
        event?.detail?.threadId,
        event?.detail?.thread?.id
      );
      scheduleGeneratedFilesRefresh(threadId);
    });
    chatkit.addEventListener("chatkit.response.end", () => {
      scheduleGeneratedFilesRefresh(activeThreadId, 500);
    });
    chatkit.addEventListener("chatkit.error", (event) => {
      const message =
        event?.detail?.error?.message ||
        event?.detail?.message ||
        "Assistant failed to initialize.";

      setStatus(`Assistant error: ${message}`, true, true);
    });

    chatkitMount.innerHTML = "";
    chatkitMount.appendChild(chatkit);

    chatkit.setOptions({
      frameTitle: ASSISTANT_NAME,
      locale: "en-US",
      api: {
        getClientSecret
      },
      theme: "dark",
      history: {
        enabled: true,
        showDelete: true,
        showRename: true,
        search: {
          enabled: true
        }
      },
      startScreen: {
        greeting: "How can I help you today?"
      },
      threadItemActions: {
        feedback: true,
        retry: true
      },
      composer: {
        placeholder: "Send a message...",
        attachments: {
          enabled: true,
          maxSize: 20 * 1024 * 1024,
          maxCount: 3,
          accept: ATTACHMENT_ACCEPT
        }
      }
    });

    chatInitialized = true;
    readyTimerId = setTimeout(() => {
      if (!statusBlock.classList.contains("is-error")) {
        setStatus(
          "Assistant is still loading. Click Retry if this persists.",
          true,
          true
        );
      }
    }, 12000);
  } catch (error) {
    setStatus(
      `Could not load assistant: ${error.message || "Unknown error."}`,
      true,
      true
    );
  }
}

retryButton.addEventListener("click", () => {
  chatInitialized = false;
  initChatKit();
});

if (brandLogo && logoFallback) {
  brandLogo.addEventListener("error", () => {
    brandLogo.hidden = true;
    logoFallback.hidden = false;
  });

  brandLogo.addEventListener("load", () => {
    brandLogo.hidden = false;
    logoFallback.hidden = true;
  });
}

window.addEventListener("load", () => {
  initChatKit();
});
