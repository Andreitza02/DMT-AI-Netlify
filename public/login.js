const loginMessage = document.getElementById("loginMessage");
const nextField = document.getElementById("nextField");
const usernameField = document.getElementById("username");
const passwordField = document.getElementById("password");

function sanitizeNextPath(value) {
  if (typeof value !== "string") {
    return "/";
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }

  if (trimmed.startsWith("/login") || trimmed.startsWith("/logout")) {
    return "/";
  }

  return trimmed || "/";
}

function showMessage(message, type) {
  if (!loginMessage) {
    return;
  }

  loginMessage.hidden = false;
  loginMessage.classList.remove("is-error", "is-info");
  loginMessage.classList.add(type);
  loginMessage.textContent = message;
}

const searchParams = new URLSearchParams(window.location.search);
const nextPath = sanitizeNextPath(searchParams.get("next"));

if (nextField) {
  nextField.value = nextPath;
}

if (searchParams.get("error") === "invalid_credentials") {
  showMessage("Invalid username or password.", "is-error");
  passwordField?.focus();
} else if (searchParams.get("logout") === "1") {
  showMessage("You have been signed out.", "is-info");
  usernameField?.focus();
} else {
  usernameField?.focus();
}
