(() => {
  const page = document.querySelector("[data-zn-page]");
  if (!page) return;
  page.classList.add("is-enhanced");

  const progress = document.querySelector("[data-zn-progress]");
  const value = page.querySelector("[data-zn-value]");
  const oracle = page.querySelector("[data-zn-oracle]");
  const satisfactionButton = page.querySelector("[data-zn-satisfaction]");
  const reward = page.querySelector("[data-zn-reward]");
  const rewardTier = page.querySelector("[data-zn-reward-tier]");
  const rewardTitle = page.querySelector("[data-zn-reward-title]");
  const rewardCopy = page.querySelector("[data-zn-reward-copy]");
  const milestone = page.querySelector("[data-zn-milestone]");
  const milestoneTier = page.querySelector("[data-zn-milestone-tier]");
  const milestoneValue = page.querySelector("[data-zn-milestone-value]");
  const milestoneTitle = page.querySelector("[data-zn-milestone-title]");
  const milestoneCopy = page.querySelector("[data-zn-milestone-copy]");
  const milestoneEcho = page.querySelector("[data-zn-milestone-echo]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const messages = [
    "満足度は自己申告制です。",
    "アイスティーが観測されました。",
    "ラーメンは満足への最短距離です。",
    "ヤンヤンつけボーを捧げてください。",
    "ネオサイタマから応答があります。",
    "満足です。たぶん。"
  ];
  const overflowMessages = [
    "警告：満足度が観測規格を超えています。",
    "ゲージは折り返しました。満足は折り返しません。",
    "上限値の撤廃に成功しました。責任者は不在です。",
    "余剰満足を別次元へ退避しています。"
  ];
  const forbiddenMessages = [
    "数値はもう意味を持っていません。",
    "観測者と満足の境界が崩壊しています。",
    "これ以上は記録ではなく儀式です。",
    "押すたびに、どこかの上限がひとつ消えます。"
  ];
  const rewards = {
    100: {
      tier: "REWARD 01 / LIMIT BREAK",
      title: "観測上限解除",
      copy: "これ以降の満足は規格外として記録されます。",
      accent: "#d4a72c"
    },
    500: {
      tier: "REWARD 02 / REDLINE",
      title: "満足永久機関",
      copy: "観測装置が因果関係を諦めました。",
      accent: "#ff4c79"
    },
    1000: {
      tier: "REWARD 03 / FORBIDDEN",
      title: "満足神話級",
      copy: "数値は意味を失いました。押す行為だけが残っています。",
      accent: "#54e6dc"
    },
    10000: {
      tier: "REWARD 04 / SINGULARITY",
      title: "満足特異点",
      copy: "観測値が五桁へ突入。満足は独自の重力を獲得しました。",
      accent: "#ff8a3d"
    },
    100000: {
      tier: "REWARD 05 / SYSTEM COLLAPSE",
      title: "観測単位崩壊",
      copy: "六桁を確認。観測局はパーセントという単位を放棄しました。",
      accent: "#f7f2df"
    },
    114514: {
      tier: "REWARD 06 / SACRED NUMBER",
      title: "聖数観測完了",
      copy: "満足教観測局は、この数値について一切の説明を拒否しました。",
      accent: "#ff2b5f"
    }
  };
  let level = Number(page.dataset.satisfaction) || 17;
  let pressCount = 0;
  let milestoneTimer = 0;
  let raf = 0;

  const updateScroll = () => {
    raf = 0;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const ratio = Math.min(1, Math.max(0, window.scrollY / max));
    progress?.style.setProperty("--zn-scroll-progress", ratio.toFixed(4));
  };

  const requestScrollUpdate = () => {
    if (raf) return;
    raf = window.requestAnimationFrame(updateScroll);
  };

  const burst = (button, count = 12) => {
    if (reducedMotion.matches) return;
    const rect = button.getBoundingClientRect();
    const colors = ["#d4a72c", "#f0d683", "#54e6dc", "#ff4c79"];

    for (let index = 0; index < count; index += 1) {
      const shard = document.createElement("i");
      const angle = (Math.PI * 2 * index) / count;
      const distance = 34 + Math.random() * 42;
      shard.className = "zn-shard";
      shard.style.left = `${rect.left + rect.width / 2}px`;
      shard.style.top = `${rect.top + rect.height / 2}px`;
      shard.style.setProperty("--zn-shard-x", `${Math.cos(angle) * distance}px`);
      shard.style.setProperty("--zn-shard-y", `${Math.sin(angle) * distance}px`);
      shard.style.setProperty("--zn-shard-color", colors[index % colors.length]);
      document.body.append(shard);
      shard.addEventListener("animationend", () => shard.remove(), { once: true });
    }
  };

  const showMilestone = (rewardData) => {
    if (!milestone || !rewardData) return;
    window.clearTimeout(milestoneTimer);
    const formattedLevel = level.toLocaleString("ja-JP");
    milestone.style.setProperty("--zn-milestone-accent", rewardData.accent);
    milestone.hidden = false;
    if (milestoneTier) milestoneTier.textContent = rewardData.tier;
    if (milestoneValue) milestoneValue.textContent = formattedLevel;
    if (milestoneTitle) milestoneTitle.textContent = rewardData.title;
    if (milestoneCopy) milestoneCopy.textContent = rewardData.copy;
    if (milestoneEcho) milestoneEcho.textContent = `${formattedLevel}%`;
    milestone.classList.remove("is-active");
    page.classList.remove("is-milestone-hit");
    void milestone.offsetWidth;
    milestone.classList.add("is-active");
    page.classList.add("is-milestone-hit");
    milestoneTimer = window.setTimeout(() => {
      milestone.classList.remove("is-active");
      page.classList.remove("is-milestone-hit");
      milestone.hidden = true;
    }, reducedMotion.matches ? 2200 : 4000);
  };

  const showReward = (rewardData) => {
    if (!reward || !rewardData) return;
    reward.hidden = false;
    if (rewardTier) rewardTier.textContent = rewardData.tier;
    if (rewardTitle) rewardTitle.textContent = rewardData.title;
    if (rewardCopy) rewardCopy.textContent = rewardData.copy;
    reward.classList.remove("is-revealed");
    void reward.offsetWidth;
    reward.classList.add("is-revealed");
    showMilestone(rewardData);
  };

  const getNextLevel = () => {
    if (level < 39) return 39;
    if (level < 71) return 71;
    if (level < 100) return 100;
    if (level < 500) return Math.min(500, level + 73);
    if (level < 1000) return Math.min(1000, level + 137);
    if (level < 10000) return Math.min(10000, level + 1500);
    if (level < 100000) return Math.min(100000, level + 15000);
    if (level < 114514) return Math.min(114514, level + 7257);
    return level + 11451 + (pressCount % 4) * 1145;
  };

  const updateLevel = (nextLevel, animate = true) => {
    const previousCycle = Math.floor(level / 100);
    level = nextLevel;
    const cycle = Math.floor(level / 100);
    const remainder = level % 100;
    const meterProgress = remainder === 0 && level > 0 ? 1 : remainder / 100;
    const tier = level >= 1000 ? "forbidden" : level >= 500 ? "redline" : level >= 100 ? "overflow" : "normal";
    const messagePool = level >= 1000 ? forbiddenMessages : level >= 100 ? overflowMessages : messages;
    const messageIndex = Math.floor(Math.random() * messagePool.length);

    page.dataset.satisfaction = String(level);
    page.dataset.satisfactionTier = tier;
    page.dataset.meterDirection = cycle % 2 === 0 ? "forward" : "reverse";
    page.style.setProperty("--zn-satisfaction-visual", String(Math.min(1, level / 1000)));
    page.style.setProperty("--zn-meter-progress", meterProgress.toFixed(4));
    page.style.setProperty("--zn-glitch", String(Math.min(1, Math.max(0, (level - 100) / 900))));
    page.style.setProperty("--zn-meter-cycle", String(cycle));
    page.style.setProperty("--zn-cycle-shift", `${(cycle % 5) * 2}px`);
    if (value) value.textContent = level.toLocaleString("ja-JP");
    if (oracle && animate) oracle.textContent = messagePool[messageIndex];
    if (satisfactionButton) {
      satisfactionButton.textContent = level >= 100 ? "さらに観測" : "満足を観測";
      satisfactionButton.setAttribute("aria-label", `満足度 ${level}%。さらに観測する`);
    }

    if (animate && cycle !== previousCycle) {
      page.classList.remove("is-meter-wrapping");
      void page.offsetWidth;
      page.classList.add("is-meter-wrapping");
      window.setTimeout(() => page.classList.remove("is-meter-wrapping"), 760);
    }

    if (animate && rewards[level]) showReward(rewards[level]);
  };

  satisfactionButton?.addEventListener("click", () => {
    pressCount += 1;
    updateLevel(getNextLevel());
    burst(satisfactionButton, level >= 10000 ? 36 : level >= 1000 ? 28 : level >= 500 ? 20 : 12);
  });

  updateLevel(level, false);

  if (!reducedMotion.matches) {
    page.addEventListener("pointermove", (event) => {
      const x = event.clientX / window.innerWidth;
      const y = event.clientY / window.innerHeight;
      page.style.setProperty("--zn-pointer-x", (x - 0.5).toFixed(3));
      page.style.setProperty("--zn-pointer-y", (y - 0.5).toFixed(3));
      page.style.setProperty("--zn-light-x", `${(x * 100).toFixed(1)}%`);
      page.style.setProperty("--zn-light-y", `${(y * 100).toFixed(1)}%`);
    }, { passive: true });
  }

  const reveals = Array.from(document.querySelectorAll(".zn-reveal"));
  if (reducedMotion.matches || !("IntersectionObserver" in window)) {
    reveals.forEach((element) => element.classList.add("is-visible"));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -10%", threshold: 0.08 });
    reveals.forEach((element) => observer.observe(element));
  }

  window.addEventListener("scroll", requestScrollUpdate, { passive: true });
  window.addEventListener("resize", requestScrollUpdate, { passive: true });
  updateScroll();
})();
