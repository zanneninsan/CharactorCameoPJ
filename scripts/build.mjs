import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

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
      await generateVisualReferenceAssets(character, characterDir);
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

async function generateVisualReferenceAssets(character, characterDir) {
  if (!Array.isArray(character.visualReferences)) {
    return;
  }

  const outputDir = path.join(characterDir, "assets", "generated");
  await mkdir(outputDir, { recursive: true });

  for (const item of character.visualReferences) {
    if (!item.path) continue;

    const sourcePath = path.join(contentDir, character.id, item.path);
    const parsed = path.parse(item.path);
    const baseName = parsed.name;

    try {
      await sharp(sourcePath)
        .resize({ width: 920, withoutEnlargement: true })
        .webp({ quality: 72 })
        .toFile(path.join(outputDir, `${baseName}-thumb.webp`));

      await sharp(sourcePath)
        .resize({ width: 1800, withoutEnlargement: true })
        .webp({ quality: 84 })
        .toFile(path.join(outputDir, `${baseName}-large.webp`));
    } catch (error) {
      throw new Error(`Failed to generate visual reference assets for ${character.id}/${item.path}: ${error.message}`);
    }
  }
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
    theme: character.theme,
    body: `
      <main>
        <section class="character-hero">
          <div class="shell">
            <a class="back-link" href="../">公式設定アーカイブ</a>
            <p class="eyebrow">✨ Official Profile</p>
            <h1>${escapeHtml(character.displayName)}</h1>
            ${character.catchphrase ? `<p class="catchphrase">${escapeHtml(character.catchphrase)}</p>` : ""}
            <p class="lead">${escapeHtml(character.summary)}</p>
            ${renderHeroFacts(character)}
          </div>
        </section>
        ${renderPageMenu(character)}
        <div class="shell content-layout">
          ${renderOfficialLinks(character)}
          ${renderVisualReferences(character)}
          <section class="panel" id="profile">
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
          <section class="panel" id="glossary">
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
          <section class="panel wide" id="settings">
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
          <section class="panel wide" id="timeline">
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
          <section class="panel wide" id="prompts">
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

function renderHeroFacts(character) {
  const keys = ["年齢", "身長", "好きな食べ物", "チャームポイント"];
  const facts = keys
    .map((key) => [key, character.profile?.[key]])
    .filter(([, value]) => value && value !== "未定義");

  if (facts.length === 0) {
    return "";
  }

  return `
    <div class="hero-facts">
      ${facts.map(([key, value]) => `
        <span><strong>${escapeHtml(key)}</strong>${escapeHtml(value)}</span>
      `).join("")}
    </div>
  `;
}

function renderPageMenu(character) {
  const items = [
    ["links", "Links"],
    ["visual", "Visual"],
    ["profile", "Profile"],
    ["glossary", "Glossary"],
    ["settings", "Settings"],
    ["side-flavors", "Flavor"],
    ["timeline", "Timeline"],
    ["prompts", "AI"]
  ];

  const visibleItems = items.filter(([id]) => {
    if (id === "links") {
      return hasItems(character.links) || hasItems(character.contentLinks);
    }
    if (id === "visual") {
      return hasItems(character.visualReferences);
    }
    if (id === "side-flavors") {
      return hasItems(character.sideFlavors);
    }
    return true;
  });

  return `
    <nav class="page-menu" aria-label="ページ内メニュー">
      <div class="shell page-menu-scroll">
        ${visibleItems.map(([id, label]) => `<a href="#${id}">${escapeHtml(label)}</a>`).join("")}
      </div>
    </nav>
  `;
}

function renderSideFlavors(character) {
  if (!Array.isArray(character.sideFlavors) || character.sideFlavors.length === 0) {
    return "";
  }

  return `
    <section class="panel wide" id="side-flavors">
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
    <section class="panel wide visual-references" id="visual">
      <p class="eyebrow">🎀 Visual Reference</p>
      <h2>ビジュアル資料</h2>
      <div class="visual-grid">
        ${character.visualReferences.map((item) => `
          <figure class="visual-card">
            <a class="visual-link" href="./${escapeHtml(visualReferenceLargePath(item.path))}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(item.label)}を拡大表示">
              <img src="./${escapeHtml(visualReferenceThumbPath(item.path))}" alt="${escapeHtml(item.label)}" loading="lazy">
              <span>タップで拡大</span>
            </a>
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

function visualReferenceThumbPath(assetPath) {
  const parsed = path.parse(assetPath);
  return `assets/generated/${parsed.name}-thumb.webp`;
}

function visualReferenceLargePath(assetPath) {
  const parsed = path.parse(assetPath);
  return `assets/generated/${parsed.name}-large.webp`;
}

function renderOfficialLinks(character) {
  const socialLinks = Array.isArray(character.links) ? character.links : [];
  const contentLinks = Array.isArray(character.contentLinks) ? character.contentLinks : [];

  if (socialLinks.length === 0 && contentLinks.length === 0) {
    return "";
  }

  return `
    <section class="panel wide official-links" id="links">
      <p class="eyebrow">🔗 Official Links</p>
      <h2>Links</h2>
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

function hasItems(value) {
  return Array.isArray(value) && value.length > 0;
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

function htmlPage({ title, body, theme }) {
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
  <body${theme ? ` style="${escapeHtml(renderThemeStyle(theme))}"` : ""}>
    ${body}
  </body>
</html>`;
}

function renderThemeStyle(theme) {
  const variables = {
    "--theme-primary": theme.primary,
    "--theme-secondary": theme.secondary,
    "--theme-accent": theme.accent,
    "--theme-paper": theme.paper,
    "--theme-panel": theme.panel,
    "--theme-text": theme.text,
    "--theme-muted": theme.muted
  };

  return Object.entries(variables)
    .filter(([, value]) => isCssColor(value))
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
}

function isCssColor(value) {
  return typeof value === "string" && /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+|rgb\(|rgba\(|hsl\(|hsla\()/.test(value.trim());
}

function renderCss() {
  return `
:root {
  color-scheme: light;
  --theme-primary: #151217;
  --theme-secondary: #d4a72c;
  --theme-accent: #fff3c4;
  --theme-paper: #fffaf0;
  --theme-panel: #ffffff;
  --theme-text: #1f1a12;
  --theme-muted: #756b5e;
  --ink: var(--theme-text);
  --muted: var(--theme-muted);
  --line: #eadfca;
  --paper: var(--theme-paper);
  --panel: var(--theme-panel);
  --accent: var(--theme-secondary);
  --accent-dark: var(--theme-primary);
  --mint: #0f766e;
  --gold: var(--theme-secondary);
  --warm: #c2410c;
  --black: var(--theme-primary);
  --shadow: 0 18px 44px rgba(21, 18, 23, 0.13);
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
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--theme-secondary) 13%, transparent) 1px, transparent 1px),
    linear-gradient(180deg, rgba(21, 18, 23, 0.045) 1px, transparent 1px),
    linear-gradient(180deg, var(--theme-paper) 0%, #fffdf8 48%, var(--theme-accent) 100%);
  background-size: 28px 28px, 28px 28px, auto;
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
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at top right, color-mix(in srgb, var(--theme-secondary) 24%, transparent), transparent 34%),
    linear-gradient(135deg, var(--theme-accent) 0%, #ffffff 64%, color-mix(in srgb, var(--theme-secondary) 18%, #ffffff) 100%);
  border-bottom: 1px solid #dcc58d;
}

.character-hero::before {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 8px;
  background: repeating-linear-gradient(90deg, var(--theme-primary) 0 28px, var(--theme-secondary) 28px 56px);
}

.character-hero .shell {
  position: relative;
  border-left: 8px solid var(--theme-primary);
  border-radius: 8px;
  padding: 22px 24px 24px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 18px 42px rgba(21, 18, 23, 0.12);
}

.eyebrow,
.status {
  margin: 0 0 10px;
  color: var(--accent-dark);
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
  color: var(--theme-primary);
  text-shadow: 0 3px 0 color-mix(in srgb, var(--theme-secondary) 28%, transparent);
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
  color: var(--theme-muted);
  font-size: 1.08rem;
  line-height: 1.75;
}

.catchphrase {
  color: var(--theme-primary);
  font-weight: 800;
}

.hero-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  max-width: 880px;
  margin-top: 22px;
}

.hero-facts span {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  gap: 8px;
  border: 1px solid #e8d29b;
  border-radius: 999px;
  padding: 8px 13px;
  background: rgba(255, 255, 255, 0.76);
  box-shadow: 0 8px 18px rgba(138, 100, 18, 0.12);
  color: var(--ink);
  font-size: 0.92rem;
}

.hero-facts strong {
  color: var(--accent-dark);
  font-size: 0.78rem;
}

.page-menu {
  position: sticky;
  top: 0;
  z-index: 10;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--theme-paper) 88%, #ffffff);
  backdrop-filter: blur(12px);
}

.page-menu-scroll {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-top: 10px;
  padding-bottom: 10px;
  scrollbar-width: none;
}

.page-menu-scroll::-webkit-scrollbar {
  display: none;
}

.page-menu a {
  display: inline-flex;
  min-height: 34px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid #e8d29b;
  border-radius: 999px;
  padding: 7px 12px;
  background: #ffffff;
  color: var(--theme-primary);
  font-size: 0.86rem;
  font-weight: 900;
  text-decoration: none;
  box-shadow: 0 8px 16px rgba(21, 18, 23, 0.06);
}

.page-menu a:hover,
.page-menu a:focus-visible {
  border-color: var(--theme-secondary);
  background: var(--theme-primary);
  color: #ffffff;
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

.panel {
  position: relative;
}

.panel::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 4px;
  border-radius: 8px 8px 0 0;
  background: linear-gradient(90deg, var(--theme-primary), var(--theme-secondary));
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
  border: 1px solid #e8d29b;
  border-radius: 999px;
  padding: 7px 13px;
  background: #fff7df;
  text-decoration: none;
  white-space: nowrap;
}

.official-links {
  background:
    linear-gradient(135deg, var(--theme-primary) 0%, color-mix(in srgb, var(--theme-primary) 76%, var(--theme-secondary)) 58%, color-mix(in srgb, var(--theme-primary) 48%, var(--theme-secondary)) 100%);
  color: #ffffff;
  border-color: #2a1824;
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
  border: 1px solid rgba(255, 255, 255, 0.3);
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
  border-color: #f6d36b;
  background: rgba(255, 255, 255, 0.16);
  transform: translateY(-1px);
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

.visual-link {
  position: relative;
  display: block;
  width: min(100%, 920px);
  margin: 0 auto;
  color: #ffffff;
  text-decoration: none;
}

.visual-link img {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 14px 30px rgba(37, 25, 35, 0.1);
}

.visual-link span {
  position: absolute;
  right: 12px;
  bottom: 12px;
  border-radius: 999px;
  padding: 7px 11px;
  background: rgba(21, 18, 23, 0.72);
  color: #ffffff;
  font-size: 0.82rem;
  font-weight: 800;
  backdrop-filter: blur(8px);
}

.visual-link:hover img,
.visual-link:focus-visible img {
  border-color: #f9a8d4;
  box-shadow: 0 18px 38px rgba(138, 100, 18, 0.18);
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
  min-height: 34px;
  align-items: center;
  border: 1px solid #e8d29b;
  border-radius: 999px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.72);
  margin-bottom: 28px;
  text-decoration: none;
}

.content-layout {
  padding: 32px 0 64px;
  scroll-margin-top: 78px;
}

.panel {
  scroll-margin-top: 76px;
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
  color: var(--accent-dark);
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
  color: var(--mint);
  font-weight: 800;
}

@media (max-width: 760px) {
  .shell {
    width: min(100% - 20px, 520px);
  }

  .hero,
  .character-hero {
    padding: 28px 0 22px;
  }

  .character-hero .shell {
    border-left-width: 5px;
    padding: 16px 14px 18px;
  }

  h1 {
    font-size: clamp(2.2rem, 13vw, 3.6rem);
    line-height: 1.06;
  }

  h2 {
    margin-bottom: 14px;
    font-size: 1.26rem;
  }

  h3 {
    font-size: 1rem;
  }

  .lead,
  .catchphrase {
    font-size: 0.98rem;
    line-height: 1.72;
  }

  .hero-facts {
    gap: 8px;
    margin-top: 18px;
  }

  .hero-facts span {
    width: 100%;
    justify-content: space-between;
    border-radius: 8px;
  }

  .page-menu {
    top: 0;
  }

  .page-menu-scroll {
    width: 100%;
    padding-left: 10px;
    padding-right: 10px;
  }

  .page-menu a {
    min-height: 38px;
    padding: 8px 13px;
    font-size: 0.88rem;
  }

  .back-link {
    margin-bottom: 18px;
  }

  .character-grid,
  .content-layout {
    grid-template-columns: 1fr;
  }

  .content-layout {
    gap: 12px;
    padding: 14px 0 44px;
  }

  .character-card,
  .panel {
    border-radius: 8px;
    padding: 16px;
    box-shadow: 0 10px 24px rgba(31, 41, 55, 0.09);
  }

  .official-links {
    margin-left: -4px;
    margin-right: -4px;
    padding: 18px 14px;
  }

  .official-links h2 {
    margin-bottom: 12px;
  }

  .link-group + .link-group {
    margin-top: 16px;
  }

  .profile-list div,
  .timeline li {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .links a {
    width: 100%;
    min-height: 42px;
  }

  .link-list {
    grid-template-columns: 1fr;
    gap: 9px;
  }

  .link-card {
    min-height: 64px;
    padding: 12px;
  }

  .link-icon {
    width: 34px;
    height: 34px;
  }

  .link-icon svg {
    width: 21px;
    height: 21px;
  }

  .visual-references {
    padding-left: 0;
    padding-right: 0;
  }

  .visual-references .eyebrow,
  .visual-references h2,
  .visual-card figcaption {
    padding-left: 16px;
    padding-right: 16px;
  }

  .visual-card {
    gap: 10px;
  }

  .visual-link {
    width: 100%;
  }

  .visual-link img {
    border-left: 0;
    border-right: 0;
    border-radius: 0;
    max-height: 72vh;
    object-fit: contain;
  }

  .visual-link span {
    right: 10px;
    bottom: 10px;
  }

  .timeline {
    gap: 12px;
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
