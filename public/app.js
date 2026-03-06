const statusBlock = document.getElementById("statusBlock");
const statusMessage = document.getElementById("statusMessage");
const retryButton = document.getElementById("retryButton");
const chatkitMount = document.getElementById("chatkitMount");
const brandLogo = document.getElementById("brandLogo");
const logoFallback = document.getElementById("logoFallback");

const USER_ID_STORAGE_KEY = "chatkit_demo_user_id";
const ASSISTANT_NAME = "Electric Department AI \u26A1";
let chatInitialized = false;
let readyTimerId = null;
let primedClientSecret = null;

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

  try {
    primedClientSecret = await requestClientSecret();
    await waitForChatKitElement();

    const chatkit = document.createElement("openai-chatkit");
    chatkit.style.height = "100%";

    chatkit.addEventListener("chatkit.ready", hideStatus);
    chatkit.addEventListener("chatkit.thread.load.end", hideStatus);
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
          accept: {
            "application/pdf": [".pdf"],
            "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif"]
          }
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
