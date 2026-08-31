export function createEriseVoogaPageOverride({ character, escapeHtml }) {
  return {
    headExtra: `
      <link rel="stylesheet" href="./assets/site/erise-home.css?v=20260830-1">`,
    bodyClass: "erise-home",
    mainClass: "erise-page",
    beforeHero: renderMasthead(character, escapeHtml),
    heroDetails: renderHeroActions(),
    heroAfterDetails: renderSignalCard(character, escapeHtml),
    afterHero: renderTicker(escapeHtml)
  };
}

function renderMasthead(character, escapeHtml) {
  const socialUrl = character.links?.find((link) => link.type === "social")?.url;
  return `
    <header class="erise-masthead">
      <a class="erise-wordmark" href="#top" aria-label="${escapeHtml(character.displayName)} ページトップ">
        <span>ERISE</span><b>VOOGA</b>
      </a>
      <nav aria-label="エリセ・ヴーガ ページナビゲーション">
        <a href="../">Character Canon</a>
        <a href="#visual">Visual Archive</a>
        ${socialUrl ? `<a href="${escapeHtml(socialUrl)}" target="_blank" rel="noopener noreferrer">Official X</a>` : ""}
      </nav>
    </header>
  `;
}

function renderHeroActions() {
  return `
    <div class="erise-hero-actions">
      <a class="is-primary" href="#profile">プロフィールを見る</a>
      <a href="#visual">ビジュアル資料</a>
    </div>
  `;
}

function renderSignalCard(character, escapeHtml) {
  const age = character.profile?.["年齢"] ?? "未定義";
  const height = character.profile?.["身長"] ?? "未定義";
  const fanName = character.profile?.["ファンネーム"] ?? "未定義";
  return `
    <aside class="erise-signal-card" aria-label="エリセ・ヴーガ 基本プロフィール">
      <div class="erise-signal-head">
        <span>LIVE PROFILE</span>
        <i aria-hidden="true"></i>
      </div>
      <strong class="erise-signal-date">08<span>/23</span></strong>
      <p>BIRTHDAY</p>
      <div class="erise-signal-wave" aria-hidden="true"><span></span></div>
      <dl>
        <div><dt>VISUAL AGE</dt><dd>${escapeHtml(age)}</dd></div>
        <div><dt>HEIGHT</dt><dd>${escapeHtml(height)}</dd></div>
        <div><dt>FAN NAME</dt><dd>${escapeHtml(fanName)}</dd></div>
      </dl>
      <a href="#visual">Official visualを見る</a>
    </aside>
  `;
}

function renderTicker(escapeHtml) {
  const items = ["VIRTUAL SINGER", "IMO V", "MINT × PINK", "SING & DANCE", "HEARTBEAT LIVE"];
  const content = items.map((item) => `<span>${escapeHtml(item)}</span>`).join("");
  return `
    <div class="erise-ticker" aria-label="エリセ・ヴーガ ブランドモチーフ">
      <div>${content}${content}</div>
    </div>
  `;
}
