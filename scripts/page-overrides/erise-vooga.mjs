export function createEriseVoogaPageOverride({ character, escapeHtml, assetVersionQuery }) {
  return {
    headExtra: `
      <link rel="stylesheet" href="./assets/site/erise-home.css?${escapeHtml(assetVersionQuery)}">`,
    bodyClass: [
      "erise-home",
      character.fanworkGuidelines?.status !== "official"
        ? "erise-guidelines-draft"
        : ""
    ].filter(Boolean).join(" "),
    mainClass: "erise-page",
    beforeHero: renderMasthead(character, escapeHtml),
    heroDetails: renderHeroDetails(character, escapeHtml, assetVersionQuery),
    heroAfterDetails: "",
    afterHero: renderIdentityStrip(escapeHtml)
  };
}

function renderMasthead(character, escapeHtml) {
  const socialUrl = character.links?.find((link) => link.type === "social")?.url;
  return `
    <header class="erise-masthead">
      <div class="shell erise-masthead-inner">
        <a class="erise-wordmark" href="#top" aria-label="${escapeHtml(character.displayName)} ページトップ">
          <span>ERISE</span><b>VOOGA</b>
        </a>
        <nav aria-label="エリセ・ヴーガ ページナビゲーション">
          <a href="../">Character Canon</a>
          ${socialUrl ? `<a href="${escapeHtml(socialUrl)}" target="_blank" rel="noopener noreferrer">X</a>` : ""}
        </nav>
      </div>
    </header>
  `;
}

function renderHeroDetails(character, escapeHtml, assetVersionQuery) {
  const details = ["誕生日", "身長", "ファンネーム"]
    .map((key) => [key, character.profile?.[key]])
    .filter(([, value]) => value && value !== "未定義");

  return `
    <div class="erise-hero-details" aria-label="エリセ・ヴーガ 基本プロフィール">
      ${renderHeroPortrait(escapeHtml, assetVersionQuery)}
      <div class="erise-hero-facts-panel">
        <dl class="erise-hero-facts">
          ${details.map(([key, value]) => `
            <div>
              <dt>${escapeHtml(key)}</dt>
              <dd>${escapeHtml(value)}</dd>
            </div>
          `).join("")}
        </dl>
        <div class="erise-hero-actions">
          <a class="is-primary" href="#visual">ビジュアル資料</a>
          <a href="#profile">プロフィールを見る</a>
        </div>
      </div>
    </div>
  `;
}

function renderHeroPortrait(escapeHtml, assetVersionQuery) {
  const versionSuffix = assetVersionQuery ? `?${escapeHtml(assetVersionQuery)}` : "";
  return `
    <div class="erise-portrait-mat">
      <figure class="visual-card erise-hero-portrait">
        <a class="visual-link erise-hero-portrait-link" href="./assets/generated/bust-up-headphone-large.webp${versionSuffix}" target="_blank" rel="noopener noreferrer" data-lightbox-image aria-label="バストアップ（新ヘッドホン）を拡大表示">
          <img src="./assets/generated/bust-up-headphone-thumb.webp${versionSuffix}" alt="新しいヘッドホンを装着したエリセ・ヴーガのバストアップ" width="1254" height="1254" loading="lazy" decoding="async">
          <span>タップで拡大</span>
        </a>
      </figure>
    </div>
  `;
}

function renderIdentityStrip(escapeHtml) {
  const items = ["VIRTUAL SINGER", "IMO V", "MINT × PINK"];
  return `
    <div class="erise-identity-strip" aria-label="エリセ・ヴーガ アイデンティティ">
      <div class="shell">
        ${items.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
    </div>
  `;
}
