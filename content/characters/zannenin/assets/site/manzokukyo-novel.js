(() => {
  const game = document.querySelector("[data-vn-game]");
  if (!game) return;

  const assetsBase = game.dataset.assetsBase || "../../assets/generated/manzokukyo/";
  const backgrounds = {
    key: `${assetsBase}key-visual-hero.webp`,
    altar: `${assetsBase}altar.webp`,
    corridor: `${assetsBase}corridor-v2.webp`,
    door: `${assetsBase}door-v2.webp`
  };
  const scenes = [
    {
      kind: "key",
      chapter: "序章 / TEASER TRANSMISSION",
      chapterTitle: "まだ全貌の見えない、小さな祭壇。",
      speaker: "記録者",
      text: "残念院さんは、満足教というコメディ宗教の開祖であり教祖。気品と謎めいた魅力をまとい、丁寧で格式ばった言葉遣いの奥に、いたずら心を覗かせる。"
    },
    {
      kind: "key",
      chapter: "序章 / TEASER TRANSMISSION",
      chapterTitle: "まだ全貌の見えない、小さな祭壇。",
      speaker: "残念院さん",
      text: "「あなたの満足、私たちがお手伝いします。」"
    },
    {
      kind: "altar",
      chapter: "第一章 / THE ALTAR",
      chapterTitle: "満たされよ、しかし満ち足りるな。",
      speaker: "記録者",
      text: "満足教は、過剰な幸福ではなく、見落とされる小さな満足を拾い上げるための仮想宗教だ。教義はまだ霧の中にあり、三つの断片だけが祭壇に残されている。"
    },
    {
      kind: "altar",
      chapter: "第一章 / THE ALTAR",
      chapterTitle: "三つの断片。",
      speaker: "祭壇",
      text: "どの断片を観測する。",
      choices: [
        { label: "一杯の救済を読む", next: 4 },
        { label: "おでこの啓示を読む", next: 5 },
        { label: "黒金の静寂を読む", next: 6 }
      ]
    },
    {
      kind: "altar",
      chapter: "第一章 / FRAGMENT 01",
      chapterTitle: "一杯の救済。",
      speaker: "記録者",
      text: "温かいものを食べること。くだらない話で笑うこと。それらはすべて、満足の儀式として記録される。",
      next: 7
    },
    {
      kind: "altar",
      chapter: "第一章 / FRAGMENT 02",
      chapterTitle: "おでこの啓示。",
      speaker: "記録者",
      text: "隠されていない額は、迷いなき自己提示の象徴。見よ、そこに教祖の余白がある。",
      next: 7
    },
    {
      kind: "altar",
      chapter: "第一章 / FRAGMENT 03",
      chapterTitle: "黒金の静寂。",
      speaker: "記録者",
      text: "黒は沈黙、金は祝福。満足教の色は、冗談と格式が同じ席に座るための合図である。",
      next: 7
    },
    {
      kind: "corridor",
      chapter: "第二章 / THE CORRIDOR",
      chapterTitle: "怪しげな空間を、奥へ。",
      speaker: "記録者",
      text: "祭壇の向こうに回廊が続いている。満たされたと思った瞬間、次の満足がこちらを見つめている。"
    },
    {
      kind: "corridor",
      chapter: "第二章 / THE CORRIDOR",
      chapterTitle: "怪しげな空間を、奥へ。",
      speaker: "残念院さん",
      text: "「小さな満足を、見落としてはいけません。もっとも、満ち足りてしまうのも考えものですが。」"
    },
    {
      kind: "door",
      chapter: "終章 / THE THRESHOLD",
      chapterTitle: "扉は、答えを要求している。",
      speaker: "記録者",
      text: "回廊の終端。真理の扉は沈黙したまま、訪問者が触れるのを待っている。"
    },
    {
      kind: "door",
      chapter: "終章 / THE THRESHOLD",
      chapterTitle: "扉は、答えを要求している。",
      speaker: "残念院さん",
      text: "「満たされよ、しかし満ち足りるな。」"
    },
    {
      kind: "door",
      chapter: "終章 / THE THRESHOLD",
      chapterTitle: "記録を終了しますか。",
      speaker: "SYSTEM",
      text: "観測記録はここで途切れている。",
      choices: [
        { label: "真理の扉に触れる", action: "truth" },
        { label: "最初から読み返す", action: "restart" },
        { label: "満足教ティザーへ戻る", action: "teaser" }
      ]
    }
  ];

  const titleScreen = game.querySelector("[data-vn-title]");
  const startButton = game.querySelector("[data-vn-start]");
  const continueButton = game.querySelector("[data-vn-continue]");
  const chapter = game.querySelector("[data-vn-chapter]");
  const chapterTitle = game.querySelector("[data-vn-chapter-title]");
  const speaker = game.querySelector("[data-vn-speaker]");
  const text = game.querySelector("[data-vn-text]");
  const dialogue = game.querySelector("[data-vn-dialogue]");
  const nextButton = game.querySelector("[data-vn-next]");
  const lineMeta = game.querySelector("[data-vn-line-meta]");
  const choices = game.querySelector("[data-vn-choices]");
  const backdropLayers = Array.from(game.querySelectorAll("[data-vn-backdrop]"));
  const logPanel = game.querySelector("[data-vn-panel='log']");
  const configPanel = game.querySelector("[data-vn-panel='config']");
  const menuPanel = game.querySelector("[data-vn-panel='menu']");
  const logList = game.querySelector("[data-vn-log]");
  const autoButton = game.querySelector("[data-vn-auto]");
  const skipButton = game.querySelector("[data-vn-skip]");
  const soundButton = game.querySelector("[data-vn-sound]");
  const audio = game.querySelector("[data-vn-audio]");
  const volume = game.querySelector("[data-vn-volume]");
  const toast = game.querySelector("[data-vn-toast]");
  const progressKey = "manzokukyo-novel-progress-v1";
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const speedValues = { slow: 56, normal: 34, fast: 16 };
  let sceneIndex = 0;
  let activeBackdrop = 0;
  let typingTimer = 0;
  let flowTimer = 0;
  let toastTimer = 0;
  let characterIndex = 0;
  let currentText = "";
  let textSpeed = "normal";
  let isTyping = false;
  let isAuto = false;
  let isSkipping = false;
  let isSoundOn = false;
  let history = [];

  function savedScene() {
    const value = Number.parseInt(window.localStorage.getItem(progressKey) || "", 10);
    return Number.isInteger(value) && value >= 0 && value < scenes.length ? value : null;
  }

  function showToast(message) {
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
  }

  function setBackdrop(kind, withTransition) {
    const source = backgrounds[kind] || backgrounds.key;
    const currentLayer = backdropLayers[activeBackdrop];
    if (currentLayer?.getAttribute("src") === source) return;
    const nextIndex = activeBackdrop === 0 ? 1 : 0;
    const nextLayer = backdropLayers[nextIndex];
    if (!nextLayer) return;
    if (withTransition && !reducedMotion.matches) {
      game.classList.remove("is-transitioning");
      void game.offsetWidth;
      game.classList.add("is-transitioning");
      window.setTimeout(() => game.classList.remove("is-transitioning"), 740);
    }
    nextLayer.setAttribute("src", source);
    nextLayer.classList.add("is-active");
    currentLayer?.classList.remove("is-active");
    activeBackdrop = nextIndex;
  }

  function closeChoices() {
    choices?.classList.remove("is-visible");
    if (choices) choices.replaceChildren();
  }

  function renderChoices(scene) {
    closeChoices();
    if (!choices || !scene.choices?.length) return;
    scene.choices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "vn-choice";
      button.textContent = choice.label;
      button.addEventListener("click", () => {
        history.push({ speaker: "選択", text: choice.label });
        if (choice.action === "truth") {
          window.location.href = "../truth/";
          return;
        }
        if (choice.action === "teaser") {
          window.location.href = "../";
          return;
        }
        if (choice.action === "restart") {
          restartGame();
          return;
        }
        showScene(choice.next);
      });
      choices.append(button);
    });
    choices.classList.add("is-visible");
  }

  function scheduleFlow(scene) {
    window.clearTimeout(flowTimer);
    if (scene.choices?.length || panelIsOpen()) return;
    if (isSkipping) {
      flowTimer = window.setTimeout(advance, 320);
    } else if (isAuto) {
      flowTimer = window.setTimeout(advance, 2600);
    }
  }

  function finishTyping() {
    window.clearInterval(typingTimer);
    text.textContent = currentText;
    characterIndex = currentText.length;
    isTyping = false;
    dialogue?.classList.add("is-complete");
    const scene = scenes[sceneIndex];
    renderChoices(scene);
    scheduleFlow(scene);
  }

  function typeCurrentText(instant) {
    window.clearInterval(typingTimer);
    window.clearTimeout(flowTimer);
    closeChoices();
    currentText = scenes[sceneIndex].text;
    characterIndex = 0;
    text.textContent = "";
    isTyping = true;
    dialogue?.classList.remove("is-complete");
    if (instant || reducedMotion.matches) {
      finishTyping();
      return;
    }
    const interval = isSkipping ? 3 : speedValues[textSpeed];
    typingTimer = window.setInterval(() => {
      characterIndex += 1;
      text.textContent = currentText.slice(0, characterIndex);
      if (characterIndex >= currentText.length) finishTyping();
    }, interval);
  }

  function showScene(index, options = {}) {
    const target = Math.max(0, Math.min(scenes.length - 1, Number(index) || 0));
    const previousKind = scenes[sceneIndex]?.kind;
    sceneIndex = target;
    const scene = scenes[sceneIndex];
    game.dataset.sceneKind = scene.kind;
    game.dataset.scene = String(sceneIndex);
    if (chapter) chapter.textContent = scene.chapter;
    if (chapterTitle) chapterTitle.textContent = scene.chapterTitle;
    if (speaker) speaker.textContent = scene.speaker;
    if (lineMeta) lineMeta.textContent = `${String(sceneIndex + 1).padStart(2, "0")} / ${String(scenes.length).padStart(2, "0")}`;
    setBackdrop(scene.kind, Boolean(previousKind && previousKind !== scene.kind));
    history.push({ speaker: scene.speaker, text: scene.text });
    window.localStorage.setItem(progressKey, String(sceneIndex));
    typeCurrentText(Boolean(options.instant));
  }

  function advance() {
    if (game.dataset.gameState !== "playing" || panelIsOpen()) return;
    if (isTyping) {
      finishTyping();
      return;
    }
    const scene = scenes[sceneIndex];
    if (scene.choices?.length) return;
    showScene(scene.next ?? sceneIndex + 1);
  }

  function startGame(index) {
    game.dataset.gameState = "playing";
    titleScreen?.classList.add("is-hidden");
    history = [];
    showScene(index, { instant: false });
    if (isSoundOn && audio) audio.play().catch(() => setSound(false));
  }

  function restartGame() {
    window.localStorage.removeItem(progressKey);
    closePanels();
    startGame(0);
  }

  function setAuto(enabled) {
    isAuto = Boolean(enabled);
    if (isAuto) isSkipping = false;
    autoButton?.setAttribute("aria-pressed", String(isAuto));
    skipButton?.setAttribute("aria-pressed", String(isSkipping));
    window.clearTimeout(flowTimer);
    if (!isTyping) scheduleFlow(scenes[sceneIndex]);
  }

  function setSkip(enabled) {
    isSkipping = Boolean(enabled);
    if (isSkipping) isAuto = false;
    skipButton?.setAttribute("aria-pressed", String(isSkipping));
    autoButton?.setAttribute("aria-pressed", String(isAuto));
    window.clearInterval(typingTimer);
    window.clearTimeout(flowTimer);
    if (isTyping) typeCurrentText(false);
    else scheduleFlow(scenes[sceneIndex]);
  }

  function setSound(enabled) {
    isSoundOn = Boolean(enabled);
    soundButton?.setAttribute("aria-pressed", String(isSoundOn));
    soundButton.textContent = isSoundOn ? "SOUND ON" : "SOUND";
    if (!audio) return;
    if (isSoundOn) audio.play().catch(() => {
      isSoundOn = false;
      soundButton?.setAttribute("aria-pressed", "false");
      soundButton.textContent = "SOUND";
    });
    else audio.pause();
  }

  function panelIsOpen() {
    return Boolean(game.querySelector(".vn-panel.is-open"));
  }

  function closePanels(resumeFlow = true) {
    game.querySelectorAll(".vn-panel.is-open").forEach((panel) => panel.classList.remove("is-open"));
    if (resumeFlow && !isTyping) scheduleFlow(scenes[sceneIndex]);
  }

  function openPanel(panel) {
    window.clearTimeout(flowTimer);
    closePanels(false);
    panel?.classList.add("is-open");
  }

  function renderLog() {
    if (!logList) return;
    logList.replaceChildren();
    history.forEach((entry) => {
      const item = document.createElement("article");
      item.className = "vn-log-entry";
      const name = document.createElement("strong");
      const body = document.createElement("p");
      name.textContent = entry.speaker;
      body.textContent = entry.text;
      item.append(name, body);
      logList.append(item);
    });
  }

  startButton?.addEventListener("click", () => startGame(0));
  continueButton?.addEventListener("click", () => startGame(savedScene() ?? 0));
  dialogue?.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    advance();
  });
  nextButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    advance();
  });
  game.querySelector("[data-vn-log-open]")?.addEventListener("click", () => {
    renderLog();
    openPanel(logPanel);
  });
  game.querySelector("[data-vn-config-open]")?.addEventListener("click", () => openPanel(configPanel));
  game.querySelector("[data-vn-menu-open]")?.addEventListener("click", () => openPanel(menuPanel));
  game.querySelector("[data-vn-save]")?.addEventListener("click", () => {
    window.localStorage.setItem(progressKey, String(sceneIndex));
    showToast("進行位置を保存しました");
  });
  game.querySelector("[data-vn-restart]")?.addEventListener("click", restartGame);
  game.querySelectorAll("[data-vn-close]").forEach((button) => button.addEventListener("click", closePanels));
  autoButton?.addEventListener("click", () => setAuto(!isAuto));
  skipButton?.addEventListener("click", () => setSkip(!isSkipping));
  soundButton?.addEventListener("click", () => setSound(!isSoundOn));
  volume?.addEventListener("input", () => {
    if (audio) audio.volume = Number(volume.value);
  });
  game.querySelectorAll("[data-vn-speed]").forEach((button) => {
    button.addEventListener("click", () => {
      textSpeed = button.dataset.vnSpeed;
      game.querySelectorAll("[data-vn-speed]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      if (isTyping) typeCurrentText(false);
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && panelIsOpen()) {
      closePanels();
      return;
    }
    if (event.key.toLowerCase() === "l" && game.dataset.gameState === "playing") {
      renderLog();
      openPanel(logPanel);
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && game.dataset.gameState === "playing" && !panelIsOpen()) {
      event.preventDefault();
      advance();
    }
  });

  if (audio && volume) audio.volume = Number(volume.value);
  const progress = savedScene();
  if (continueButton) continueButton.hidden = progress === null;
  setBackdrop("key", false);
})();
