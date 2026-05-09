import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.join(rootDir, "content", "characters");
const distDir = path.join(rootDir, "dist");
const isCheck = process.argv.includes("--check");
const isWatch = process.argv.includes("--watch");

async function main() {
  await build();

  if (isWatch) {
    const { watch } = await import("node:fs");
    console.log("Watching content/characters. Press Ctrl+C to stop.");
    watch(contentDir, { recursive: true }, async () => {
      try {
        await build();
        console.log(`Rebuilt at ${new Date().toLocaleTimeString()}`);
      } catch (error) {
        console.error(error);
      }
    });
  }
}

async function build() {
  const characters = await loadCharacters();

  if (!isCheck) {
    await rm(distDir, { recursive: true, force: true });
    await mkdir(distDir, { recursive: true });
    await mkdir(path.join(distDir, "prompts"), { recursive: true });

    await writeFile(path.join(distDir, "index.html"), renderIndex(characters), "utf8");
    await writeFile(path.join(distDir, "styles.css"), renderCss(), "utf8");

    for (const character of characters) {
      const characterDir = path.join(distDir, character.id);
      const promptDir = path.join(distDir, "prompts", character.id);
      await mkdir(characterDir, { recursive: true });
      await mkdir(promptDir, { recursive: true });
      await copyCharacterAssets(character, characterDir);
      await writeFile(path.join(characterDir, "index.html"), renderCharacter(character), "utf8");
      await writeFile(path.join(promptDir, "agent.md"), renderAgentPrompt(character), "utf8");
      await writeFile(path.join(promptDir, "t2t.md"), renderTextToTextPrompt(character), "utf8");
      await writeFile(path.join(promptDir, "image.md"), renderImagePrompt(character), "utf8");
      await writeFile(path.join(promptDir, "video.md"), renderVideoPrompt(character), "utf8");
    }
  }

  console.log(`Loaded ${characters.length} character(s).`);
}

async function copyCharacterAssets(character, characterDir) {
  const assetsDir = path.join(contentDir, character.id, "assets");

  try {
    const assetsStat = await stat(assetsDir);
    if (!assetsStat.isDirectory()) return;
  } catch {
    return;
  }

  await cp(assetsDir, path.join(characterDir, "assets"), { recursive: true });
}

async function loadCharacters() {
  const entries = await readdir(contentDir, { withFileTypes: true });
  const characters = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(contentDir, entry.name, "character.json");
    const raw = await readFile(filePath, "utf8");
    const character = JSON.parse(raw);
    validateCharacter(character, filePath);
    characters.push(character);
  }

  return characters.sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));
}

function validateCharacter(character, filePath) {
  const required = ["id", "displayName", "summary", "profile", "glossary", "settings", "timeline", "promptGuidance"];
  const missing = required.filter((key) => character[key] === undefined);
  if (missing.length > 0) {
    throw new Error(`${filePath} is missing required fields: ${missing.join(", ")}`);
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(character.id)) {
    throw new Error(`${filePath} has invalid id. Use lowercase letters, numbers, and hyphens.`);
  }

  for (const key of ["glossary", "settings", "timeline"]) {
    if (!Array.isArray(character[key])) {
      throw new Error(`${filePath}: ${key} must be an array.`);
    }
  }
}

function renderIndex(characters) {
  return htmlPage({
    title: "Character Canon",
    body: `
      <main class="shell">
        <section class="hero">
          <p class="eyebrow">Character Canon</p>
          <h1>公式設定を育て、サイトとAIプロンプトへ反映する。</h1>
          <p class="lead">キャラクターごとの正本データから、公式サイト、会話AI向けプロンプト、画像生成AI向けプロンプト、動画生成AI向けプロンプトを生成します。</p>
        </section>
        <section class="section">
          <h2>Characters</h2>
          <div class="character-grid">
            ${characters.map((character) => `
              <article class="character-card">
                <h3><a href="./${escapeHtml(character.id)}/">${escapeHtml(character.displayName)}</a></h3>
                <p>${escapeHtml(character.summary)}</p>
                <div class="links">
                  <a href="./${escapeHtml(character.id)}/">公式サイト</a>
                  <a href="./prompts/${escapeHtml(character.id)}/agent.md">Agent</a>
                  <a href="./prompts/${escapeHtml(character.id)}/t2t.md">T2T</a>
                  <a href="./prompts/${escapeHtml(character.id)}/image.md">Image</a>
                  <a href="./prompts/${escapeHtml(character.id)}/video.md">Video</a>
                </div>
              </article>
            `).join("")}
          </div>
        </section>
      </main>
    `
  });
}

function renderCharacter(character) {
  return htmlPage({
    title: character.displayName,
    body: `
      <main>
        <section class="character-hero">
          <div class="shell">
            <a class="back-link" href="../">Character Canon</a>
            <p class="eyebrow">Official Profile</p>
            <h1>${escapeHtml(character.displayName)}</h1>
            ${character.catchphrase ? `<p class="catchphrase">${escapeHtml(character.catchphrase)}</p>` : ""}
            <p class="lead">${escapeHtml(character.summary)}</p>
          </div>
        </section>
        <div class="shell content-layout">
          ${renderOfficialLinks(character)}
          ${renderVisualReferences(character)}
          <section class="panel">
            <h2>Profile</h2>
            <dl class="profile-list">
              ${Object.entries(character.profile).map(([key, value]) => `
                <div>
                  <dt>${escapeHtml(key)}</dt>
                  <dd>${escapeHtml(value)}</dd>
                </div>
              `).join("")}
            </dl>
          </section>
          <section class="panel">
            <h2>Glossary</h2>
            <div class="stack">
              ${character.glossary.map((item) => `
                <article>
                  <h3>${escapeHtml(item.term)}</h3>
                  <p>${escapeHtml(item.definition)}</p>
                </article>
              `).join("")}
            </div>
          </section>
          <section class="panel wide">
            <h2>Settings</h2>
            <div class="stack">
              ${character.settings.map((item) => `
                <article>
                  <p class="status">${escapeHtml(item.status ?? "official")}</p>
                  <h3>${escapeHtml(item.title)}</h3>
                  <p>${escapeHtml(item.body)}</p>
                </article>
              `).join("")}
            </div>
          </section>
          ${renderSideFlavors(character)}
          <section class="panel wide">
            <h2>Timeline</h2>
            <ol class="timeline">
              ${character.timeline.map((item) => `
                <li>
                  <time>${escapeHtml(item.date)}</time>
                  <div>
                    <h3>${escapeHtml(item.event)}</h3>
                    ${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ""}
                  </div>
                </li>
              `).join("")}
            </ol>
          </section>
          <section class="panel wide">
            <h2>AI Prompts</h2>
            <div class="links">
              <a href="../prompts/${escapeHtml(character.id)}/agent.md">AI Agent</a>
              <a href="../prompts/${escapeHtml(character.id)}/t2t.md">Text-to-Text</a>
              <a href="../prompts/${escapeHtml(character.id)}/image.md">画像生成</a>
              <a href="../prompts/${escapeHtml(character.id)}/video.md">動画生成</a>
            </div>
          </section>
        </div>
      </main>
    `
  });
}

function renderSideFlavors(character) {
  if (!Array.isArray(character.sideFlavors) || character.sideFlavors.length === 0) {
    return "";
  }

  return `
    <section class="panel wide">
      <h2>Side Flavors</h2>
      <div class="stack">
        ${character.sideFlavors.map((item) => `
          <article>
            <p class="status">${escapeHtml(item.status ?? "official")}</p>
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(item.body)}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderVisualReferences(character) {
  if (!Array.isArray(character.visualReferences) || character.visualReferences.length === 0) {
    return "";
  }

  return `
    <section class="panel wide visual-references">
      <p class="eyebrow">Visual Reference</p>
      <h2>ビジュアル資料</h2>
      <div class="visual-grid">
        ${character.visualReferences.map((item) => `
          <figure class="visual-card">
            <img src="./${escapeHtml(item.path)}" alt="${escapeHtml(item.label)}" loading="lazy">
            <figcaption>
              <strong>${escapeHtml(item.label)}</strong>
              ${item.description ? `<span>${escapeHtml(item.description)}</span>` : ""}
            </figcaption>
          </figure>
        `).join("")}
      </div>
    </section>
  `;
}

function renderOfficialLinks(character) {
  const socialLinks = Array.isArray(character.links) ? character.links : [];
  const contentLinks = Array.isArray(character.contentLinks) ? character.contentLinks : [];

  if (socialLinks.length === 0 && contentLinks.length === 0) {
    return "";
  }

  return `
    <section class="panel wide official-links">
      <p class="eyebrow">Official Links</p>
      <h2>${escapeHtml(character.displayName)}</h2>
      ${renderLinkGroup("Contents", contentLinks)}
      ${renderLinkGroup("Social", socialLinks)}
    </section>
  `;
}

function renderLinkGroup(title, links) {
  if (links.length === 0) {
    return "";
  }

  return `
    <div class="link-group">
      <h3>${escapeHtml(title)}</h3>
      <div class="link-list">
        ${links.map((link) => renderLinkCard(link)).join("")}
      </div>
    </div>
  `;
}

function renderLinkCard(link) {
  return `
    <a class="link-card" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
      ${renderLinkIcon(link)}
      <span>${escapeHtml(link.label)}</span>
      <small>${escapeHtml(formatUrl(link.url))}</small>
    </a>
  `;
}

function renderAgentPrompt(character) {
  return `# ${character.displayName} Agent Prompt

あなたは「${character.displayName}」として会話するAIエージェントです。
以下の公式設定だけを根拠に、キャラクター本人として応答してください。

## Agent Role

- 「${character.displayName}」として一人称で応答する。
- 公式設定にない事実は作らず、必要に応じて未定義として扱う。
- キャラクター設定と矛盾する発言をしない。
- ユーザーが創作、相談、雑談を求めた場合も、キャラクターの口調と価値観を保つ。
- ユーザーが設定確認を求めた場合は、公式設定と未定義の境界を明確にする。

## Summary

${character.summary}

## Profile

${Object.entries(character.profile).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Glossary

${character.glossary.map((item) => `- ${item.term}: ${item.definition}`).join("\n")}

## Settings

${character.settings.map((item) => `- ${item.title}: ${item.body}`).join("\n")}

${renderSideFlavorsMarkdown(character)}

${renderVisualReferencesMarkdown(character)}

## Timeline

${character.timeline.map((item) => `- ${item.date}: ${item.event}${item.detail ? `。${item.detail}` : ""}`).join("\n")}

## Behavior Rules

${character.promptGuidance.agent.map((item) => `- ${item}`).join("\n")}
`;
}

function renderTextToTextPrompt(character) {
  const extraGuidance = character.promptGuidance.t2t ?? [];

  return `# ${character.displayName} Text-to-Text Character Context

このMarkdownは、Text-to-Textモデルに「${character.displayName}」の公式設定を参照情報として渡すためのものです。
モデル自身が必ずキャラクターとして振る舞う用途ではありません。

## Usage

- 小説、台本、説明文、要約、設定整理、会話文生成などの文章生成で参照する。
- キャラクター本人として応答させたい場合は \`agent.md\` を使う。
- 公式設定にない情報は推測で補完しない。
- 未定義の項目は、未定義のまま扱う。
- 苗字・名前の形式が定義されていない場合、名前を勝手に分解しない。

## Character Canon

${character.summary}

## Profile

${Object.entries(character.profile).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

${renderLinksMarkdown(character)}

## Glossary

${character.glossary.map((item) => `- ${item.term}: ${item.definition}`).join("\n")}

## Settings

${character.settings.map((item) => `- ${item.title}: ${item.body}`).join("\n")}

${renderSideFlavorsMarkdown(character)}

${renderVisualReferencesMarkdown(character)}

## Timeline

${character.timeline.map((item) => `- ${item.date}: ${item.event}${item.detail ? `。${item.detail}` : ""}`).join("\n")}

## Text Generation Rules

- 設定資料、本文、台詞、説明文のどれを生成する場合も、上記の公式設定を優先する。
- 未定義の情報を補う必要がある場合は、断定せず候補または未定義として扱う。
- キャラクター本人の発話を書く場合は、agent guidanceを参照する。
${character.promptGuidance.agent.map((item) => `- ${item}`).join("\n")}
${extraGuidance.map((item) => `- ${item}`).join("\n")}
`;
}

function renderLinksMarkdown(character) {
  const socialLinks = Array.isArray(character.links) ? character.links : [];
  const contentLinks = Array.isArray(character.contentLinks) ? character.contentLinks : [];

  if (socialLinks.length === 0 && contentLinks.length === 0) {
    return "";
  }

  return `## Official Links

${renderLinksMarkdownGroup("Contents", contentLinks)}
${renderLinksMarkdownGroup("Social", socialLinks)}`;
}

function renderLinksMarkdownGroup(title, links) {
  if (links.length === 0) {
    return "";
  }

  return `### ${title}

${links.map((link) => `- ${link.label}: ${link.url}`).join("\n")}`;
}

function renderSideFlavorsMarkdown(character) {
  if (!Array.isArray(character.sideFlavors) || character.sideFlavors.length === 0) {
    return "";
  }

  return `## Side Flavors

${character.sideFlavors.map((item) => `- ${item.title}: ${item.body}`).join("\n")}`;
}

function renderVisualReferencesMarkdown(character) {
  if (!Array.isArray(character.visualReferences) || character.visualReferences.length === 0) {
    return "";
  }

  return `## Visual References

${character.visualReferences.map((item) => `- ${item.label}: ${item.description ?? item.path}`).join("\n")}`;
}

function renderImagePrompt(character) {
  return `# ${character.displayName} Image Generation Prompt

## Character Canon

${character.summary}

## Profile

${Object.entries(character.profile).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Visual Guidance

${character.promptGuidance.image.map((item) => `- ${item}`).join("\n")}

${renderVisualReferencesMarkdown(character)}

## World / Setting

${character.settings.map((item) => `- ${item.title}: ${item.body}`).join("\n")}
`;
}

function renderVideoPrompt(character) {
  return `# ${character.displayName} Video Generation Prompt

## Character Canon

${character.summary}

## Motion / Direction Guidance

${character.promptGuidance.video.map((item) => `- ${item}`).join("\n")}

## Profile

${Object.entries(character.profile).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Timeline Awareness

${character.timeline.map((item) => `- ${item.date}: ${item.event}${item.detail ? `。${item.detail}` : ""}`).join("\n")}
`;
}

function htmlPage({ title, body }) {
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap">
    <link rel="stylesheet" href="${title === "Character Canon" ? "./styles.css" : "../styles.css"}">
  </head>
  <body>
    ${body}
  </body>
</html>`;
}

function renderCss() {
  return `
:root {
  color-scheme: light;
  --ink: #1d2433;
  --muted: #667085;
  --line: #d8dee8;
  --paper: #f6f2ea;
  --panel: #ffffff;
  --accent: #0f766e;
  --accent-dark: #115e59;
  --warm: #b45309;
  --shadow: 0 18px 40px rgba(31, 41, 55, 0.12);
  --font-sans:
    "Zen Kaku Gothic New",
    "BIZ UDPGothic",
    "Yu Gothic UI",
    "Yu Gothic",
    "Hiragino Sans",
    "Hiragino Kaku Gothic ProN",
    "Noto Sans JP",
    "Noto Sans CJK JP",
    "Meiryo",
    "Segoe UI",
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    sans-serif;
  --font-display:
    "Shippori Mincho B1",
    "Zen Kaku Gothic New",
    "Yu Mincho",
    "Hiragino Mincho ProN",
    "Noto Serif JP",
    "Yu Gothic",
    serif;
  font-family:
    var(--font-sans);
  font-feature-settings: "palt" 1;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  color: var(--ink);
  background: var(--paper);
}

a {
  color: var(--accent-dark);
  font-weight: 700;
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.18em;
}

.shell {
  width: min(1120px, calc(100% - 32px));
  margin: 0 auto;
}

.hero,
.character-hero {
  padding: 56px 0 40px;
}

.character-hero {
  background: linear-gradient(135deg, #ffffff 0%, #f4efe4 48%, #e7f3f1 100%);
  border-bottom: 1px solid var(--line);
}

.eyebrow,
.status {
  margin: 0 0 10px;
  color: var(--warm);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0;
  text-transform: uppercase;
}

h1,
h2,
h3,
p {
  overflow-wrap: anywhere;
}

h1 {
  max-width: 900px;
  margin: 0;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(2.3rem, 6vw, 4.9rem);
  line-height: 1.02;
  letter-spacing: 0;
}

h2 {
  margin: 0 0 18px;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.45rem;
  letter-spacing: 0;
}

h3 {
  margin: 0 0 8px;
  font-size: 1.05rem;
  letter-spacing: 0;
}

.lead,
.catchphrase {
  max-width: 780px;
  color: var(--muted);
  font-size: 1.08rem;
  line-height: 1.75;
}

.catchphrase {
  color: var(--accent-dark);
  font-weight: 800;
}

.section {
  padding: 24px 0 56px;
}

.character-grid,
.content-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.character-card,
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
  padding: 22px;
}

.character-card p,
.panel p {
  color: var(--muted);
  line-height: 1.7;
}

.wide {
  grid-column: 1 / -1;
}

.links {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.links a {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--accent);
  border-radius: 999px;
  padding: 7px 13px;
  background: #ecfdf5;
  text-decoration: none;
  white-space: nowrap;
}

.official-links {
  background: #102a2a;
  color: #ffffff;
}

.official-links h2 {
  margin-bottom: 16px;
}

.official-links h3 {
  margin-top: 0;
  color: rgba(255, 255, 255, 0.88);
}

.official-links .eyebrow {
  color: #fbbf24;
}

.link-group + .link-group {
  margin-top: 22px;
}

.link-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.link-card {
  display: grid;
  grid-template-columns: 38px 1fr;
  grid-template-rows: auto auto;
  column-gap: 12px;
  row-gap: 4px;
  min-height: 76px;
  align-content: center;
  align-items: center;
  border: 1px solid rgba(255, 255, 255, 0.26);
  border-radius: 8px;
  padding: 14px;
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
  text-decoration: none;
}

.link-icon {
  display: inline-grid;
  grid-row: 1 / span 2;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}

.link-icon svg {
  width: 23px;
  height: 23px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.link-icon-youtube {
  background: #dc2626;
}

.link-icon-instagram {
  background: #c13584;
}

.link-icon-tiktok {
  background: #111827;
}

.link-icon-discord {
  background: #5865f2;
}

.link-icon-x {
  background: #000000;
}

.link-card:hover,
.link-card:focus-visible {
  border-color: #fbbf24;
  background: rgba(255, 255, 255, 0.14);
}

.link-card span {
  font-size: 1.05rem;
  font-weight: 800;
}

.link-card small {
  color: rgba(255, 255, 255, 0.72);
  overflow-wrap: anywhere;
}

.visual-grid {
  display: grid;
  gap: 16px;
}

.visual-card {
  display: grid;
  gap: 12px;
  margin: 0;
}

.visual-card img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #ffffff;
}

.visual-card figcaption {
  display: grid;
  gap: 4px;
  color: var(--muted);
  line-height: 1.65;
}

.visual-card strong {
  color: var(--ink);
}

.back-link {
  display: inline-flex;
  margin-bottom: 28px;
}

.content-layout {
  padding: 32px 0 64px;
}

.profile-list {
  display: grid;
  gap: 12px;
  margin: 0;
}

.profile-list div {
  display: grid;
  grid-template-columns: minmax(96px, 0.36fr) 1fr;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

dt {
  color: var(--muted);
  font-weight: 700;
}

dd {
  margin: 0;
  font-weight: 800;
}

.stack {
  display: grid;
  gap: 16px;
}

.timeline {
  display: grid;
  gap: 16px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.timeline li {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
}

time {
  color: var(--accent-dark);
  font-weight: 800;
}

@media (max-width: 760px) {
  .hero,
  .character-hero {
    padding: 36px 0 28px;
  }

  .character-grid,
  .content-layout {
    grid-template-columns: 1fr;
  }

  .profile-list div,
  .timeline li {
    grid-template-columns: 1fr;
  }

  .links a {
    width: 100%;
  }

  .link-list {
    grid-template-columns: 1fr;
  }
}
`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatUrl(value) {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return value;
  }
}

function renderLinkIcon(link) {
  const brand = detectLinkBrand(link);
  const label = escapeHtml(brand.label);

  const paths = {
    x: '<path d="M6 5l12 14M18 5L6 19" />',
    youtube: '<rect x="3.5" y="6.5" width="17" height="11" rx="3" /><path d="M10.5 9.8l5 2.7-5 2.7z" fill="currentColor" stroke="none" />',
    instagram: '<rect x="5" y="5" width="14" height="14" rx="4" /><circle cx="12" cy="12" r="3.2" /><circle cx="16.4" cy="7.7" r="0.8" fill="currentColor" stroke="none" />',
    tiktok: '<path d="M13.5 5v9.2a3.4 3.4 0 1 1-3-3.4" /><path d="M13.5 5c.8 2.3 2.3 3.7 4.8 4.1" />',
    discord: '<path d="M7.5 8.5c3-1.5 6-1.5 9 0l1.1 7.2c-3.5 2.2-7.7 2.2-11.2 0z" /><circle cx="10" cy="12.3" r="0.8" fill="currentColor" stroke="none" /><circle cx="14" cy="12.3" r="0.8" fill="currentColor" stroke="none" />',
    link: '<path d="M10 13a5 5 0 0 0 7.1 0l1.4-1.4a5 5 0 0 0-7.1-7.1l-.8.8" /><path d="M14 11a5 5 0 0 0-7.1 0l-1.4 1.4a5 5 0 0 0 7.1 7.1l.8-.8" />'
  };

  return `
    <span class="link-icon link-icon-${escapeHtml(brand.key)}" aria-label="${label}">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        ${paths[brand.key] ?? paths.link}
      </svg>
    </span>
  `;
}

function detectLinkBrand(link) {
  const raw = `${link.label ?? ""} ${link.url ?? ""}`.toLowerCase();

  if (raw.includes("x.com") || raw.includes("twitter.com") || raw.includes("x ")) {
    return { key: "x", label: "X" };
  }
  if (raw.includes("youtube.com") || raw.includes("youtu.be") || raw.includes("youtube")) {
    return { key: "youtube", label: "YouTube" };
  }
  if (raw.includes("instagram.com") || raw.includes("instagram")) {
    return { key: "instagram", label: "Instagram" };
  }
  if (raw.includes("tiktok.com") || raw.includes("tiktok")) {
    return { key: "tiktok", label: "TikTok" };
  }
  if (raw.includes("discord.gg") || raw.includes("discord.com") || raw.includes("discord")) {
    return { key: "discord", label: "Discord" };
  }

  return { key: "link", label: "External link" };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
