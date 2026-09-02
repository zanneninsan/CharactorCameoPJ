const header = document.querySelector("[data-header]");
const menuButton = document.querySelector("[data-menu-button]");
const menu = document.querySelector("[data-menu]");

const updateHeader = () => header?.classList.toggle("is-scrolled", window.scrollY > 24);
updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

menuButton?.addEventListener("click", () => {
  const isOpen = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!isOpen));
  menu?.classList.toggle("is-open", !isOpen);
});

menu?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    menuButton?.setAttribute("aria-expanded", "false");
    menu?.classList.remove("is-open");
  });
});

const revealTargets = document.querySelectorAll("[data-reveal]");
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  revealTargets.forEach((target) => observer.observe(target));
} else {
  revealTargets.forEach((target) => target.classList.add("is-visible"));
}

const characterCarousel = document.querySelector("[data-character-carousel]");
if (characterCarousel) {
  const tabs = [...characterCarousel.querySelectorAll("[data-character-tab]")];
  const panels = [...characterCarousel.querySelectorAll("[data-character-panel]")];
  const selector = characterCarousel.querySelector(".character-selector");
  const viewport = characterCarousel.querySelector(".character-viewport");
  const progress = characterCarousel.querySelector(".character-progress");
  let activeIndex = Math.max(0, tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true"));
  let touchStartX = null;

  progress?.replaceChildren(...panels.map(() => document.createElement("i")));
  const progressItems = [...(progress?.children ?? [])];

  const showCharacter = (requestedIndex, { focus = false, revealTab = true } = {}) => {
    activeIndex = (requestedIndex + panels.length) % panels.length;

    tabs.forEach((tab, index) => {
      const isActive = index === activeIndex;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
    });

    panels.forEach((panel, index) => {
      const isActive = index === activeIndex;
      panel.hidden = !isActive;
      panel.classList.toggle("is-active", isActive);
    });

    progressItems.forEach((item, index) => item.classList.toggle("is-active", index === activeIndex));

    if (revealTab) {
      tabs[activeIndex]?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "nearest",
        inline: "center",
      });
    }
    if (focus) tabs[activeIndex]?.focus();
  };

  tabs.forEach((tab, index) => tab.addEventListener("click", () => showCharacter(index, { revealTab: false })));
  characterCarousel.querySelector("[data-character-prev]")?.addEventListener("click", () => showCharacter(activeIndex - 1));
  characterCarousel.querySelector("[data-character-next]")?.addEventListener("click", () => showCharacter(activeIndex + 1));

  selector?.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") return showCharacter(0, { focus: true });
    if (event.key === "End") return showCharacter(panels.length - 1, { focus: true });
    showCharacter(activeIndex + (event.key === "ArrowRight" ? 1 : -1), { focus: true });
  });

  viewport?.addEventListener("touchstart", (event) => {
    touchStartX = event.touches[0]?.clientX ?? null;
  }, { passive: true });
  viewport?.addEventListener("touchend", (event) => {
    if (touchStartX === null) return;
    const distance = (event.changedTouches[0]?.clientX ?? touchStartX) - touchStartX;
    touchStartX = null;
    if (Math.abs(distance) < 45) return;
    showCharacter(activeIndex + (distance < 0 ? 1 : -1));
  }, { passive: true });

  showCharacter(activeIndex, { revealTab: false });
}
