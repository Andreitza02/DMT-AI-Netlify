(function () {
  if (window.DMTChatKitEmbed) {
    return;
  }

  var scriptElement = document.currentScript;

  function toBoolean(value) {
    return value === true || value === "true" || value === "1" || value === "";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }

  function whenBodyReady(callback) {
    if (document.body) {
      callback();
      return;
    }

    document.addEventListener(
      "DOMContentLoaded",
      function onReady() {
        document.removeEventListener("DOMContentLoaded", onReady);
        callback();
      },
      { once: true }
    );
  }

  function createEmbed() {
    var currentScript = scriptElement;
    if (!currentScript || !currentScript.src) {
      return;
    }

    var scriptUrl = new URL(currentScript.src, window.location.href);
    var dataset = currentScript.dataset || {};
    var position = dataset.position === "left" ? "left" : "right";
    var title = (dataset.title || "AI Assistant").trim();
    var buttonLabel = (dataset.buttonLabel || title || "Chat").trim();
    var initialOpen =
      Object.prototype.hasOwnProperty.call(dataset, "open") &&
      toBoolean(dataset.open);
    var zIndex = Number.parseInt(dataset.zIndex || "", 10) || 2147483000;
    var siteKey = (dataset.siteKey || window.location.hostname || "default").trim();
    var baseUrl = dataset.baseUrl
      ? new URL(dataset.baseUrl, scriptUrl)
      : scriptUrl;
    var frameUrl = new URL(dataset.src || "embed-frame.html", baseUrl);

    frameUrl.searchParams.set("embed", "1");
    frameUrl.searchParams.set("site_key", siteKey);
    if (title) {
      frameUrl.searchParams.set("assistant_name", title);
    }
    if (dataset.greeting) {
      frameUrl.searchParams.set("greeting", dataset.greeting);
    }

    var host = document.createElement("div");
    host.setAttribute("data-dmt-chatkit-embed", "true");
    document.body.appendChild(host);

    var shadowRoot = host.attachShadow({ mode: "open" });
    shadowRoot.innerHTML = [
      "<style>",
      ":host { all: initial; }",
      ".ck-root { position: fixed; inset: auto 0 0 auto; z-index: " + zIndex + "; font-family: 'Segoe UI', sans-serif; }",
      ".ck-launcher { position: fixed; bottom: 20px; " + position + ": 20px; display: inline-flex; align-items: center; gap: 10px; padding: 14px 18px; border: 0; border-radius: 999px; background: linear-gradient(180deg, #a3db1a, #8fcb14); color: #111827; font-size: 14px; font-weight: 800; letter-spacing: 0.01em; box-shadow: 0 18px 40px rgba(0, 0, 0, 0.28); cursor: pointer; }",
      ".ck-launcher:hover { transform: translateY(-1px); }",
      ".ck-launcher:focus-visible { outline: 3px solid rgba(17, 24, 39, 0.24); outline-offset: 2px; }",
      ".ck-launcher-badge { display: inline-grid; place-items: center; width: 28px; height: 28px; border-radius: 999px; background: rgba(17, 24, 39, 0.12); font-size: 16px; line-height: 1; }",
      ".ck-backdrop { position: fixed; inset: 0; background: rgba(15, 23, 42, 0.28); opacity: 0; pointer-events: none; transition: opacity 180ms ease; }",
      ".ck-panel { position: fixed; top: 16px; bottom: 16px; " + position + ": 16px; width: min(420px, calc(100vw - 32px)); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 24px; overflow: hidden; background: #0c0d0f; box-shadow: 0 28px 90px rgba(0, 0, 0, 0.35); transform: translateX(" + (position === "left" ? "-16px" : "16px") + ") scale(0.98); opacity: 0; pointer-events: none; transition: opacity 180ms ease, transform 180ms ease; }",
      ".ck-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 62px; padding: 14px 16px; background: linear-gradient(180deg, #a3db1a, #8fcb14); color: #111827; }",
      ".ck-title { min-width: 0; font-size: 15px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
      ".ck-close { width: 36px; height: 36px; border: 0; border-radius: 999px; background: rgba(17, 24, 39, 0.12); color: #111827; font-size: 22px; line-height: 1; cursor: pointer; }",
      ".ck-close:focus-visible { outline: 3px solid rgba(17, 24, 39, 0.24); outline-offset: 2px; }",
      ".ck-iframe { display: block; width: 100%; height: calc(100% - 62px); border: 0; background: #0c0d0f; }",
      ".ck-open .ck-backdrop { opacity: 1; pointer-events: auto; }",
      ".ck-open .ck-panel { opacity: 1; pointer-events: auto; transform: translateX(0) scale(1); }",
      ".ck-open .ck-launcher { opacity: 0; pointer-events: none; }",
      "@media (max-width: 640px) {",
      "  .ck-launcher { bottom: 14px; " + position + ": 14px; padding: 13px 16px; }",
      "  .ck-panel { inset: 0; width: 100vw; max-width: 100vw; border-radius: 0; border: 0; }",
      "  .ck-header { padding-top: calc(14px + env(safe-area-inset-top, 0px)); }",
      "  .ck-iframe { height: calc(100% - 62px - env(safe-area-inset-top, 0px)); }",
      "}",
      "</style>",
      '<div class="ck-root">',
      '  <button class="ck-launcher" type="button" aria-label="' + escapeAttribute(title) + '">',
      '    <span class="ck-launcher-badge">AI</span>',
      '    <span>' + escapeHtml(buttonLabel) + "</span>",
      "  </button>",
      '  <div class="ck-backdrop" hidden></div>',
      '  <section class="ck-panel" aria-label="' + escapeAttribute(title) + '" hidden>',
      '    <div class="ck-header">',
      '      <div class="ck-title">' + escapeHtml(title) + "</div>",
      '      <button class="ck-close" type="button" aria-label="Close chat">&times;</button>',
      "    </div>",
      '    <iframe class="ck-iframe" title="' + escapeAttribute(title) + '" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="clipboard-read; clipboard-write; microphone"></iframe>',
      "  </section>",
      "</div>"
    ].join("");

    var root = shadowRoot.querySelector(".ck-root");
    var launcher = shadowRoot.querySelector(".ck-launcher");
    var backdrop = shadowRoot.querySelector(".ck-backdrop");
    var panel = shadowRoot.querySelector(".ck-panel");
    var closeButton = shadowRoot.querySelector(".ck-close");
    var iframe = shadowRoot.querySelector(".ck-iframe");
    var iframeLoaded = false;

    function open() {
      if (!iframeLoaded) {
        iframe.src = frameUrl.toString();
        iframeLoaded = true;
      }

      backdrop.hidden = false;
      panel.hidden = false;
      root.classList.add("ck-open");
    }

    function close() {
      root.classList.remove("ck-open");
      window.setTimeout(function () {
        if (!root.classList.contains("ck-open")) {
          backdrop.hidden = true;
          panel.hidden = true;
        }
      }, 180);
    }

    function toggle() {
      if (root.classList.contains("ck-open")) {
        close();
        return;
      }

      open();
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        close();
      }
    }

    launcher.addEventListener("click", open);
    backdrop.addEventListener("click", close);
    closeButton.addEventListener("click", close);
    document.addEventListener("keydown", onKeyDown);

    if (initialOpen) {
      open();
    }

    window.DMTChatKitEmbed = {
      open: open,
      close: close,
      toggle: toggle,
      destroy: function () {
        document.removeEventListener("keydown", onKeyDown);
        host.remove();
        delete window.DMTChatKitEmbed;
      }
    };
  }

  whenBodyReady(createEmbed);
})();
