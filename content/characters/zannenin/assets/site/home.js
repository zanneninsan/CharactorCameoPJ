(() => {
  const page = document.querySelector("[data-zn-page]");
  if (!page) return;
  page.classList.add("is-enhanced");

  const progress = document.querySelector("[data-zn-progress]");
  const value = page.querySelector("[data-zn-value]");
  const oracle = page.querySelector("[data-zn-oracle]");
  const satisfactionButton = page.querySelector("[data-zn-satisfaction]");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const levels = [17, 39, 71, 100];
  const messages = [
    "満足度は自己申告制です。",
    "アイスティーが観測されました。",
    "ラーメンは満足への最短距離です。",
    "ヤンヤンつけボーを捧げてください。",
    "ネオサイタマから応答があります。",
    "満足です。たぶん。"
  ];
  let levelIndex = 0;
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

  const burst = (button) => {
    if (reducedMotion.matches) return;
    const rect = button.getBoundingClientRect();
    const colors = ["#d4a72c", "#f0d683", "#54e6dc", "#ff4c79"];

    for (let index = 0; index < 12; index += 1) {
      const shard = document.createElement("i");
      const angle = (Math.PI * 2 * index) / 12;
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

  satisfactionButton?.addEventListener("click", () => {
    levelIndex = (levelIndex + 1) % levels.length;
    const level = levels[levelIndex];
    const messageIndex = Math.floor(Math.random() * messages.length);
    page.dataset.satisfaction = String(level);
    page.style.setProperty("--zn-satisfaction", String(level / 100));
    if (value) value.textContent = String(level);
    if (oracle) oracle.textContent = messages[messageIndex];
    satisfactionButton.textContent = level === 100 ? "満足を再観測" : "満足を観測";
    satisfactionButton.setAttribute("aria-label", `満足度 ${level}%。もう一度観測する`);
    burst(satisfactionButton);
  });

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
