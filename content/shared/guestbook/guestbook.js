(() => {
  const DEFAULT_API_URL = "https://script.google.com/macros/s/AKfycbwzBF_HTRBnv4JgcGitGN9zU9ZjfvmmtKr_nJ2RNwuwemWKeexbJiEZQ2DvQVwFc-hP/exec";
  const DEFAULT_MAX_MESSAGE_LENGTH = 80;
  const MAX_VISIBLE_ENTRIES = 10;
  const MIN_SUBMIT_DELAY_MS = 2500;
  const DEFAULT_COOLDOWN_MS = 60 * 1000;
  const MAX_SUBMISSIONS_PER_HOUR = 5;
  const DRAWING_WIDTH = 240;
  const DRAWING_HEIGHT = 135;
  const MAX_DRAWING_DATA_URL_LENGTH = 45000;
  const DEFAULT_NG_WORDS = [
    "死ね",
    "殺す",
    "消えろ",
    "自殺しろ",
    "casino",
    "viagra",
    "porn",
    "loan",
    "http://",
    "https://",
    "www."
  ];

  const widgets = document.querySelectorAll("[data-guestbook-widget]");
  widgets.forEach((root, index) => initGuestbook(root, index));

  function initGuestbook(root, index) {
    if (root.dataset.guestbookReady === "true") return;
    root.dataset.guestbookReady = "true";

    const config = readConfig(root, index);
    let guestbookEntries = [];
    let currentPage = 1;
    const createdAt = Date.now();

    root.classList.add("guestbook-widget");
    root.innerHTML = renderWidget(config);

    const modal = root.querySelector("[data-guestbook-modal]");
    const openButton = root.querySelector("[data-guestbook-open]");
    const closeTargets = root.querySelectorAll("[data-guestbook-close]");
    const form = root.querySelector("[data-guestbook-form]");
    const status = root.querySelector("[data-guestbook-status]");
    const log = root.querySelector("[data-guestbook-log]");
    const messageInput = root.querySelector('textarea[name="message"]');
    const submitButton = root.querySelector('button[type="submit"]');
    const count = root.querySelector("[data-guestbook-count]");
    const formatButtons = root.querySelectorAll("[data-format]");
    const drawingCanvas = root.querySelector("[data-guestbook-drawing-canvas]");
    const drawingClearButton = root.querySelector("[data-guestbook-drawing-clear]");
    const drawingState = drawingCanvas ? setupDrawingPad(drawingCanvas, drawingClearButton) : null;

    if (!modal || !openButton || !form || !status || !log || !messageInput || !submitButton) {
      return;
    }

    const keepModalScrollInside = (event) => {
      event.stopPropagation();
    };

    modal.addEventListener("wheel", keepModalScrollInside, { passive: true });
    modal.addEventListener("touchmove", keepModalScrollInside, { passive: true });

    const openModal = () => {
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("guestbook-is-open");
      loadEntries();
      const firstInput = modal.querySelector("input:not(.guestbook-honeypot), textarea, button");
      if (firstInput) firstInput.focus();
    };

    const closeModal = () => {
      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      if (!document.querySelector(".guestbook-modal.is-open")) {
        document.body.classList.remove("guestbook-is-open");
      }
      openButton.focus();
    };

    const updateCount = () => {
      if (count) {
        count.textContent = `${messageInput.value.length}/${config.maxMessageLength}`;
      }
    };

    const clearEntries = () => {
      while (log.firstChild) log.firstChild.remove();
    };

    const getTotalPages = () => Math.max(1, Math.ceil(guestbookEntries.length / MAX_VISIBLE_ENTRIES));

    const createEmptyEntry = (message) => {
      const entry = document.createElement("article");
      entry.className = "guestbook-entry guestbook-entry-empty";
      const body = document.createElement("p");
      body.textContent = message;
      entry.append(body);
      return entry;
    };

    const createEntry = (entryData) => {
      const entry = document.createElement("article");
      entry.className = "guestbook-entry";

      if (entryData.localOnly) {
        entry.classList.add("is-local");
      }

      const header = document.createElement("div");
      const author = document.createElement("strong");
      const time = document.createElement("time");
      const body = document.createElement("p");

      author.textContent = entryData.name || config.defaultName;
      time.textContent = entryData.date || "";
      body.innerHTML = formatMessage(entryData.message || "");

      header.append(author, time);
      entry.append(header, body);

      const drawingSrc = safeDrawingSrc(entryData.drawing);
      if (drawingSrc) {
        const drawing = document.createElement("img");
        drawing.className = "guestbook-entry-drawing";
        drawing.src = drawingSrc;
        drawing.alt = `${author.textContent}さんのおえかき`;
        loadingLazy(drawing);
        entry.append(drawing);
      }

      return entry;
    };

    const createPager = () => {
      const pager = document.createElement("nav");
      pager.className = "guestbook-pager";
      pager.setAttribute("aria-label", "あしあと帳のページ");

      const summary = document.createElement("span");
      summary.textContent = `${guestbookEntries.length}件中 ${currentPage}/${getTotalPages()}ページ`;
      pager.append(summary);

      if (guestbookEntries.length <= MAX_VISIBLE_ENTRIES) {
        return pager;
      }

      for (let page = 1; page <= getTotalPages(); page += 1) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = page;
        button.setAttribute("aria-label", `${page}ページ目を表示`);
        if (page === currentPage) {
          button.classList.add("is-current");
          button.setAttribute("aria-current", "page");
        }
        button.addEventListener("click", () => {
          currentPage = page;
          renderEntries();
        });
        pager.append(button);
      }

      return pager;
    };

    const renderEntries = (entries = guestbookEntries) => {
      if (entries !== guestbookEntries) {
        guestbookEntries = entries;
        currentPage = 1;
      }

      clearEntries();
      if (!guestbookEntries.length) {
        log.append(createEmptyEntry("まだ公開されたあしあとはありません。"));
        return;
      }

      currentPage = Math.min(Math.max(currentPage, 1), getTotalPages());
      const start = (currentPage - 1) * MAX_VISIBLE_ENTRIES;
      const pageEntries = guestbookEntries.slice(start, start + MAX_VISIBLE_ENTRIES);

      log.append(createPager());
      pageEntries.forEach((entry) => log.append(createEntry(entry)));
      if (guestbookEntries.length > MAX_VISIBLE_ENTRIES) {
        log.append(createPager());
      }
    };

    const loadEntries = () => {
      clearEntries();
      log.append(createEmptyEntry("あしあとを読み込み中です。"));

      const callbackName = `guestbookCallback_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const script = document.createElement("script");
      const cleanup = () => {
        script.remove();
        delete window[callbackName];
      };

      window[callbackName] = (payload) => {
        cleanup();
        if (!payload || !payload.ok) {
          renderEntries([]);
          return;
        }
        const entries = Array.isArray(payload.entries) ? payload.entries : [];
        renderEntries(entries.map(normalizeEntry).filter((entry) => !isBlockedText(`${entry.name} ${entry.message}`, config)));
      };

      const params = new URLSearchParams({
        callback: callbackName,
        scope: config.scope,
        t: String(Date.now())
      });
      script.src = `${config.apiUrl}?${params.toString()}`;
      script.onerror = () => {
        cleanup();
        clearEntries();
        log.append(createEmptyEntry("あしあとを読み込めませんでした。あとでもう一度お試しください。"));
      };
      document.body.append(script);
    };

    const wrapSelection = (tag) => {
      const start = messageInput.selectionStart;
      const end = messageInput.selectionEnd;
      const selected = messageInput.value.slice(start, end) || "ここに文字";
      const before = messageInput.value.slice(0, start);
      const after = messageInput.value.slice(end);
      const wrapped = `[${tag}]${selected}[/${tag}]`;

      messageInput.value = `${before}${wrapped}${after}`.slice(0, config.maxMessageLength);
      messageInput.focus();
      messageInput.setSelectionRange(start + tag.length + 2, start + tag.length + 2 + Math.min(selected.length, config.maxMessageLength));
      updateCount();
    };

    openButton.addEventListener("click", openModal);
    closeTargets.forEach((target) => target.addEventListener("click", closeModal));
    formatButtons.forEach((button) => button.addEventListener("click", () => wrapSelection(button.dataset.format)));
    messageInput.addEventListener("input", updateCount);
    updateCount();

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && modal.classList.contains("is-open")) {
        closeModal();
      }
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const formData = new FormData(form);
      const name = normalizeWhitespace(String(formData.get("name") || "")).slice(0, 24) || config.defaultName;
      const message = normalizeWhitespace(String(formData.get("message") || "")).slice(0, config.maxMessageLength);
      const drawing = config.drawingEnabled && drawingState?.hasDrawing() ? drawingState.toDataUrl() : "";
      const honeypot = String(formData.get("website") || "");
      const validationError = validateSubmission({ name, message, drawing, honeypot, createdAt, config });

      if (validationError) {
        status.textContent = validationError;
        return;
      }

      const guardError = checkRateLimit(config);
      if (guardError) {
        status.textContent = guardError;
        return;
      }

      const payload = new FormData();
      payload.append("name", name);
      payload.append("message", message);
      payload.append("drawing", drawing);
      payload.append("hasDrawing", drawing ? "1" : "0");
      payload.append("drawingMime", drawing ? drawing.slice(5, drawing.indexOf(";")) : "");
      payload.append("drawingLength", drawing ? String(drawing.length) : "0");
      payload.append("scope", config.scope);
      payload.append("pageUrl", location.href);
      payload.append("clientToken", getClientToken());
      payload.append("clientGuard", "guestbook-widget-v2");
      payload.append("directPublish", config.directPublish ? "1" : "0");
      payload.append("submittedAt", new Date().toISOString());

      submitButton.disabled = true;
      status.textContent = "あしあとを送信しています。";

      try {
        await fetch(config.apiUrl, {
          method: "POST",
          mode: "no-cors",
          body: payload
        });

        rememberSubmission(config, `${name}\n${message}\n${drawing}`);
        form.reset();
        form.elements.name.value = config.defaultName;
        drawingState?.clear();
        updateCount();

        if (config.directPublish) {
          renderEntries([
            { name, message, drawing, date: "たった今", localOnly: true },
            ...guestbookEntries
          ]);
          status.textContent = "あしあとを残しました。反映確認のため少しあとに再読み込みします。";
          window.setTimeout(loadEntries, 1800);
        } else {
          status.textContent = "あしあとを預かりました。確認後に掲載される場合があります。";
        }
      } catch {
        status.textContent = "送信できませんでした。時間をおいてもう一度お試しください。";
      } finally {
        submitButton.disabled = false;
      }
    });
  }

  function readConfig(root, index) {
    return {
      apiUrl: root.dataset.guestbookApi || DEFAULT_API_URL,
      scope: root.dataset.guestbookScope || "global",
      title: root.dataset.guestbookTitle || "あしあと帳",
      description: root.dataset.guestbookDescription || "ひとこと残していってください。",
      buttonLabel: root.dataset.guestbookButtonLabel || "あしあと帳",
      defaultName: root.dataset.guestbookDefaultName || "満足教徒",
      image: root.dataset.guestbookImage || "",
      directPublish: root.dataset.guestbookDirect !== "false",
      drawingEnabled: root.dataset.guestbookDrawing !== "false",
      maxMessageLength: toPositiveInt(root.dataset.guestbookMaxLength, DEFAULT_MAX_MESSAGE_LENGTH),
      cooldownMs: toPositiveInt(root.dataset.guestbookCooldownMs, DEFAULT_COOLDOWN_MS),
      ngWords: mergeNgWords(root.dataset.guestbookNgWords),
      widgetId: `guestbook-title-${index}-${Date.now()}`
    };
  }

  function renderWidget(config) {
    return `
      <button class="guestbook-launch" type="button" aria-haspopup="dialog" aria-controls="${escapeHtml(config.widgetId)}-modal" data-guestbook-open>
        ${escapeHtml(config.buttonLabel)}
      </button>

      <div class="guestbook-modal" id="${escapeHtml(config.widgetId)}-modal" aria-hidden="true" data-guestbook-modal>
        <div class="guestbook-backdrop" data-guestbook-close></div>
        <section class="guestbook-window" role="dialog" aria-modal="true" aria-labelledby="${escapeHtml(config.widgetId)}">
          <div class="guestbook-titlebar">
            <span>guestbook.exe</span>
            <button class="guestbook-close" type="button" aria-label="あしあと帳を閉じる" data-guestbook-close>×</button>
          </div>
          <div class="guestbook-body">
            <div class="guestbook-heading">
              <p class="guestbook-kicker"><span></span>Ashiato</p>
              <h2 id="${escapeHtml(config.widgetId)}">${escapeHtml(config.title)}</h2>
              <p>${escapeHtml(config.description)}</p>
            </div>

            <form class="guestbook-form" data-guestbook-form>
              <label>
                お名前
                <input type="text" name="name" maxlength="24" value="${escapeHtml(config.defaultName)}" placeholder="${escapeHtml(config.defaultName)}">
              </label>
              <label>
                メッセージ <span class="guestbook-count" data-guestbook-count></span>
                <div class="guestbook-toolbar" aria-label="メッセージ装飾">
                  <button type="button" data-format="b" aria-label="選択した文字を太字にする">B</button>
                  <button type="button" data-format="i" aria-label="選択した文字を斜体にする"><em>I</em></button>
                  <button type="button" data-format="u" aria-label="選択した文字に下線を引く"><u>U</u></button>
                </div>
                <textarea name="message" rows="4" maxlength="${config.maxMessageLength}" placeholder="ひとことどうぞ"></textarea>
              </label>
              ${config.drawingEnabled ? `
              <div class="guestbook-drawing">
                <div class="guestbook-drawing-head">
                  <span>かんたんおえかき</span>
                  <button type="button" data-guestbook-drawing-clear>消す</button>
                </div>
                <canvas
                  width="${DRAWING_WIDTH}"
                  height="${DRAWING_HEIGHT}"
                  aria-label="あしあと用のおえかきキャンバス"
                  data-guestbook-drawing-canvas
                ></canvas>
              </div>
              ` : ""}
              <label class="guestbook-honeypot" aria-hidden="true">
                Web site
                <input type="text" name="website" tabindex="-1" autocomplete="off">
              </label>
              <button type="submit">あしあとを残す</button>
              <p class="guestbook-status" data-guestbook-status aria-live="polite"></p>
            </form>

            <div class="guestbook-log" aria-label="あしあと一覧" data-guestbook-log></div>
          </div>
          ${config.image ? `<img class="guestbook-chiruko" src="${escapeHtml(config.image)}" alt="" aria-hidden="true">` : ""}
        </section>
      </div>
    `;
  }

  function validateSubmission({ name, message, drawing, honeypot, createdAt, config }) {
    if (honeypot) return "送信できませんでした。";
    if (Date.now() - createdAt < MIN_SUBMIT_DELAY_MS) return "少しだけ待ってから送信してください。";
    if (!message && !drawing) return "メッセージかおえかきを入力してください。";
    if (message.length > config.maxMessageLength) return `${config.maxMessageLength}文字以内でお願いします。`;
    if (drawing.length > MAX_DRAWING_DATA_URL_LENGTH) return "おえかきが少し大きすぎます。線を減らすか、消してもう一度描いてください。";
    if (isBlockedText(`${name} ${message}`, config)) return "その内容は掲載できません。表現を変えてください。";
    if (looksLikeSpam(message)) return "URLや宣伝っぽい内容は投稿できません。";
    if (isDuplicateSubmission(config, `${name}\n${message}\n${drawing}`)) return "同じ内容は続けて投稿できません。";
    return "";
  }

  function checkRateLimit(config) {
    const state = readGuardState(config.scope);
    const now = Date.now();
    const recent = state.timestamps.filter((time) => now - time < 60 * 60 * 1000);

    if (state.lastAt && now - state.lastAt < config.cooldownMs) {
      const seconds = Math.ceil((config.cooldownMs - (now - state.lastAt)) / 1000);
      return `連投防止のため、あと${seconds}秒ほど待ってください。`;
    }

    if (recent.length >= MAX_SUBMISSIONS_PER_HOUR) {
      return "短時間の投稿が多すぎます。時間をおいてからお願いします。";
    }

    return "";
  }

  function rememberSubmission(config, value) {
    const state = readGuardState(config.scope);
    const now = Date.now();
    const recent = state.timestamps.filter((time) => now - time < 60 * 60 * 1000);
    localStorage.setItem(guardKey(config.scope), JSON.stringify({
      lastAt: now,
      lastHash: hashText(value),
      timestamps: [...recent, now]
    }));
  }

  function isDuplicateSubmission(config, value) {
    const state = readGuardState(config.scope);
    return state.lastHash && state.lastHash === hashText(value);
  }

  function readGuardState(scope) {
    try {
      const parsed = JSON.parse(localStorage.getItem(guardKey(scope)) || "{}");
      return {
        lastAt: Number(parsed.lastAt) || 0,
        lastHash: String(parsed.lastHash || ""),
        timestamps: Array.isArray(parsed.timestamps) ? parsed.timestamps.map(Number).filter(Boolean) : []
      };
    } catch {
      return { lastAt: 0, lastHash: "", timestamps: [] };
    }
  }

  function guardKey(scope) {
    return `guestbook.guard.${scope}`;
  }

  function getClientToken() {
    const key = "guestbook.clientToken";
    try {
      const existing = localStorage.getItem(key);
      if (existing) return existing;
      const token = typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `guestbook-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(key, token);
      return token;
    } catch {
      return `guestbook-${Date.now()}`;
    }
  }

  function setupDrawingPad(canvas, clearButton) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let drawing = false;
    let dirty = false;
    let previousPoint = null;

    if (!context) {
      return null;
    }

    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 4;
    context.strokeStyle = "#31516d";

    const pointFromEvent = (event) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (event.clientX - rect.left) * (canvas.width / rect.width),
        y: (event.clientY - rect.top) * (canvas.height / rect.height)
      };
    };

    const drawTo = (point) => {
      if (!previousPoint) {
        previousPoint = point;
      }

      context.beginPath();
      context.moveTo(previousPoint.x, previousPoint.y);
      context.lineTo(point.x, point.y);
      context.stroke();
      previousPoint = point;
      dirty = true;
    };

    const start = (event) => {
      event.preventDefault();
      drawing = true;
      previousPoint = pointFromEvent(event);
      canvas.setPointerCapture?.(event.pointerId);
      drawTo(previousPoint);
    };

    const move = (event) => {
      if (!drawing) return;
      event.preventDefault();
      drawTo(pointFromEvent(event));
    };

    const stop = (event) => {
      if (!drawing) return;
      drawing = false;
      previousPoint = null;
      canvas.releasePointerCapture?.(event.pointerId);
    };

    const clear = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      dirty = false;
      previousPoint = null;
    };

    canvas.addEventListener("pointerdown", start);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("pointerleave", stop);
    clearButton?.addEventListener("click", clear);

    return {
      clear,
      hasDrawing: () => dirty,
      toDataUrl: () => dirty ? compactCanvasDataUrl(canvas) : ""
    };
  }

  function compactCanvasDataUrl(canvas) {
    const flattened = document.createElement("canvas");
    flattened.width = canvas.width;
    flattened.height = canvas.height;

    const context = flattened.getContext("2d");
    if (!context) {
      return canvas.toDataURL("image/png");
    }

    context.fillStyle = "#fffdf7";
    context.fillRect(0, 0, flattened.width, flattened.height);
    context.drawImage(canvas, 0, 0);

    const candidates = [
      flattened.toDataURL("image/webp", 0.72),
      flattened.toDataURL("image/jpeg", 0.72),
      flattened.toDataURL("image/png")
    ];

    return candidates
      .filter((value) => /^data:image\/(?:webp|jpeg|png);base64,/i.test(value))
      .sort((a, b) => a.length - b.length)[0] || flattened.toDataURL("image/png");
  }

  function normalizeEntry(entry) {
    return {
      name: normalizeWhitespace(String(entry?.name || "")),
      message: normalizeWhitespace(String(entry?.message || "")),
      date: normalizeWhitespace(String(entry?.date || "")),
      drawing: safeDrawingSrc(entry?.drawing || entry?.drawingDataUrl || entry?.image || "")
    };
  }

  function safeDrawingSrc(value) {
    const src = String(value || "").trim();
    if (/^data:image\/(?:png|webp|jpeg);base64,[a-z0-9+/=]+$/i.test(src)) {
      return src;
    }
    return "";
  }

  function loadingLazy(image) {
    try {
      image.loading = "lazy";
    } catch {
      // Older browsers can safely ignore lazy loading.
    }
  }

  function isBlockedText(value, config) {
    const normalized = normalizeForFilter(value);
    return config.ngWords.some((word) => normalized.includes(normalizeForFilter(word)));
  }

  function looksLikeSpam(value) {
    const normalized = normalizeForFilter(value);
    const urlLike = /(https?:\/\/|www\.|discord\.gg|bit\.ly|t\.co|\.ru\b|\.cn\b)/i.test(value);
    const repeated = /(.)\1{8,}/.test(normalized);
    const tooManySymbols = (value.match(/[!！?？￥$€£#%*]/g) || []).length >= 8;
    return urlLike || repeated || tooManySymbols;
  }

  function mergeNgWords(extraWords) {
    const extras = String(extraWords || "")
      .split(",")
      .map((word) => word.trim())
      .filter(Boolean);
    return [...new Set([...DEFAULT_NG_WORDS, ...extras])];
  }

  function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function normalizeForFilter(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\s　._\-ー〜~・!！?？"'“”‘’、。,.]/g, "");
  }

  function formatMessage(message) {
    let html = escapeHtml(message);
    html = html.replace(/\[b\]([\s\S]*?)\[\/b\]/gi, "<strong>$1</strong>");
    html = html.replace(/\[i\]([\s\S]*?)\[\/i\]/gi, "<em>$1</em>");
    html = html.replace(/\[u\]([\s\S]*?)\[\/u\]/gi, "<u>$1</u>");
    return html;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return String(hash >>> 0);
  }

  function toPositiveInt(value, fallback) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }
})();
