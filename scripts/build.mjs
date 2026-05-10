import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.join(rootDir, "content", "characters");
const distDir = path.join(rootDir, "dist");
const buildLockDir = path.join(rootDir, ".build-lock");
const siteUrl = normalizeSiteUrl(process.env.SITE_URL ?? process.env.GITHUB_PAGES_URL ?? "https://zanneninsan.github.io/CharactorCameoPJ/");
const sourceRepoUrl = normalizeRepoUrl(process.env.SOURCE_REPO_URL ?? "https://github.com/zanneninsan/CharactorCameoPJ");
const sitemapLastmod = process.env.SITEMAP_LASTMOD ?? new Date().toISOString().slice(0, 10);
const isCheck = process.argv.includes("--check");
const isWatch = process.argv.includes("--watch");
const sectionLabels = {
  links: { en: "Links", ja: "リンク" },
  visual: { en: "Visual Reference", ja: "ビジュアル資料" },
  fanworks: { en: "Fanworks", ja: "二次創作ガイドライン" },
  prompts: { en: "AI Prompts", ja: "AI生成用プロンプト" },
  profile: { en: "Profile", ja: "プロフィール" },
  glossary: { en: "Glossary", ja: "用語集" },
  settings: { en: "Settings", ja: "設定" },
  sideFlavors: { en: "Side Flavors", ja: "サイドフレーバー" },
  timeline: { en: "Timeline", ja: "年表" }
};

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
    const releaseBuildLock = await acquireBuildLock();
    try {
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
        await generateBrandAssets(character, characterDir);
        await generateVisualReferenceAssets(character, characterDir);
        await generateOpenGraphImage(character, characterDir);
        await writeFile(path.join(characterDir, "index.html"), renderCharacter(character), "utf8");
        if (character.fanworkGuidelines) {
          await writeFile(path.join(characterDir, "fanworks.html"), renderFanworkGuidelines(character), "utf8");
        }
        for (const page of hiddenPages(character)) {
          await writeFile(path.join(characterDir, `${page.slug}.html`), renderHiddenPage(character, page), "utf8");
        }
        await writeFile(path.join(promptDir, "agent.md"), renderAgentPrompt(character), "utf8");
        await writeFile(path.join(promptDir, "t2t.md"), renderTextToTextPrompt(character), "utf8");
        await writeFile(path.join(promptDir, "image-default.md"), renderImagePrompt(character, { outfitMode: "default" }), "utf8");
        await writeFile(path.join(promptDir, "video-default.md"), renderVideoPrompt(character, { outfitMode: "default" }), "utf8");
        await writeFile(path.join(promptDir, "image-outfit-change.md"), renderImagePrompt(character, { outfitMode: "outfit-change" }), "utf8");
        await writeFile(path.join(promptDir, "video-outfit-change.md"), renderVideoPrompt(character, { outfitMode: "outfit-change" }), "utf8");
      }

      await writeFile(path.join(distDir, "robots.txt"), renderRobotsTxt(), "utf8");
      await writeFile(path.join(distDir, "sitemap.xml"), renderSitemap(characters), "utf8");
      await writeFile(path.join(distDir, ".nojekyll"), "", "utf8");
    } finally {
      await releaseBuildLock();
    }
  }

  console.log(`Loaded ${characters.length} character(s).`);
}

async function acquireBuildLock() {
  const staleAfterMs = 10 * 60 * 1000;

  while (true) {
    try {
      await mkdir(buildLockDir);
      await writeFile(path.join(buildLockDir, "pid"), `${process.pid}\n${Date.now()}\n`, "utf8");
      return async () => {
        await rm(buildLockDir, { recursive: true, force: true });
      };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }

      const lockStat = await stat(buildLockDir).catch(() => null);
      if (lockStat && Date.now() - lockStat.mtimeMs > staleAfterMs) {
        await rm(buildLockDir, { recursive: true, force: true });
        continue;
      }

      await sleep(500);
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSiteUrl(value) {
  return `${String(value).trim().replace(/\/+$/, "")}/`;
}

function normalizeRepoUrl(value) {
  return String(value).trim().replace(/\/+$/, "");
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

async function generateBrandAssets(character, characterDir) {
  const logo = character.brandAssets?.logo;
  const banner = character.brandAssets?.banner;
  if (!logo?.source && !banner?.source) {
    return;
  }

  const outputDir = path.join(characterDir, "assets", "generated", "brand");
  await mkdir(outputDir, { recursive: true });

  let logoBuffer = null;
  let bannerLogoBuffer = null;

  if (logo?.source) {
    const logoSource = path.join(contentDir, character.id, logo.source);
    logoBuffer = await createTransparentLogoBuffer(logoSource);
    bannerLogoBuffer = logoBuffer;

    for (const width of [320, 640, 1024]) {
      await sharp(logoBuffer)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 88, alphaQuality: 95 })
        .toFile(path.join(outputDir, `logo-${width}.webp`));
    }
  }

  if (banner?.source) {
    const bannerSource = path.join(contentDir, character.id, banner.source);
    const sourceMeta = await sharp(bannerSource).metadata();
    const sourceWidth = sourceMeta.width ?? 1800;
    const bannerWidth = Math.min(1800, sourceWidth);
    const bannerImage = sharp(bannerSource).resize({ width: bannerWidth, withoutEnlargement: true });
    const scale = bannerWidth / sourceWidth;
    const placement = banner.logoPlacement ?? {};
    const logoWidth = Math.round((placement.width ?? 650) * scale);
    const logoLeft = Math.round((placement.left ?? 140) * scale);

    const composites = [];
    if (bannerLogoBuffer) {
      const resizedBannerLogo = await sharp(bannerLogoBuffer)
        .resize({ width: logoWidth, withoutEnlargement: true })
        .png()
        .toBuffer();
      const resizedLogoMeta = await sharp(resizedBannerLogo).metadata();
      const bannerHeight = Math.round((sourceMeta.height ?? 724) * scale);
      const logoTop = Math.max(0, Math.round((bannerHeight - (resizedLogoMeta.height ?? 0)) / 2));
      const logoOutline = await createSolidLogoBuffer(resizedBannerLogo, { red: 255, green: 255, blue: 255 }, 0.88);

      composites.push({
        input: await sharp(await createSolidLogoBuffer(resizedBannerLogo, { red: 0, green: 0, blue: 0 }, 0.82)).blur(10).png().toBuffer(),
        left: logoLeft,
        top: logoTop,
        opacity: 0.54
      });
      for (const [offsetX, offsetY] of [
        [-3, 0],
        [3, 0],
        [0, -3],
        [0, 3],
        [-2, -2],
        [2, -2],
        [-2, 2],
        [2, 2]
      ]) {
        composites.push({
          input: logoOutline,
          left: logoLeft + offsetX,
          top: logoTop + offsetY
        });
      }
      composites.push({
        input: resizedBannerLogo,
        left: logoLeft,
        top: logoTop
      });
    }

    await bannerImage
      .composite(composites)
      .webp({ quality: 80 })
      .toFile(path.join(outputDir, "banner-logo.webp"));
  }
}

async function generateOpenGraphImage(character, characterDir) {
  const outputDir = path.join(characterDir, "assets", "generated");
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "ogp.png");
  const generatedBanner = path.join(characterDir, "assets", "generated", "brand", "banner-logo.webp");
  const sourceBanner = character.brandAssets?.banner?.source
    ? path.join(contentDir, character.id, character.brandAssets.banner.source)
    : null;

  let bannerPath = null;
  if (await fileExists(generatedBanner)) {
    bannerPath = generatedBanner;
  } else if (sourceBanner && await fileExists(sourceBanner)) {
    bannerPath = sourceBanner;
  }

  if (bannerPath) {
    const background = await sharp(bannerPath)
      .resize(1200, 630, { fit: "cover", position: "center" })
      .blur(14)
      .modulate({ brightness: 0.52 })
      .png()
      .toBuffer();
    const foreground = await sharp(bannerPath)
      .resize(1200, 630, { fit: "contain", background: { r: 5, g: 5, b: 7, alpha: 0 } })
      .png()
      .toBuffer();

    await sharp(background)
      .composite([
        {
          input: foreground
        },
        {
          input: Buffer.from(`
            <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <linearGradient id="shade" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0" stop-color="#050507" stop-opacity="0.34"/>
                  <stop offset="0.42" stop-color="#050507" stop-opacity="0.04"/>
                  <stop offset="1" stop-color="#050507" stop-opacity="0.2"/>
                </linearGradient>
              </defs>
              <rect width="1200" height="630" fill="url(#shade)"/>
            </svg>
          `)
        }
      ])
      .png({ compressionLevel: 8 })
      .toFile(outputPath);
    return;
  }

  await sharp(Buffer.from(`
    <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
      <rect width="1200" height="630" fill="${escapeXml(character.theme?.primary ?? "#151217")}"/>
      <rect x="32" y="32" width="1136" height="566" fill="none" stroke="${escapeXml(character.theme?.secondary ?? "#d4a72c")}" stroke-width="4"/>
      <text x="80" y="285" font-family="'Yu Gothic', Meiryo, 'Noto Sans CJK JP', sans-serif" font-size="92" font-weight="700" fill="#ffffff">${escapeXml(character.displayName)}</text>
      <text x="84" y="370" font-family="'Yu Gothic', Meiryo, 'Noto Sans CJK JP', sans-serif" font-size="32" font-weight="700" fill="${escapeXml(character.theme?.accent ?? "#fff3c4")}">Official Character Canon</text>
    </svg>
  `))
    .png({ compressionLevel: 8 })
    .toFile(outputPath);
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createTransparentLogoBuffer(sourcePath) {
  const image = sharp(sourcePath)
    .trim({ background: "#ffffff", threshold: 24 })
    .ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

  for (let index = 0; index < data.length; index += 4) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const nearWhite = red > 238 && green > 238 && blue > 238;
    if (nearWhite) {
      data[index + 3] = 0;
    }
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4
    }
  })
    .trim({ background: { r: 255, g: 255, b: 255, alpha: 0 }, threshold: 8 })
    .png()
    .toBuffer();
}

async function createSolidLogoBuffer(inputBuffer, color, alphaScale = 1) {
  const { data, info } = await sharp(inputBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let index = 0; index < data.length; index += 4) {
    data[index] = color.red;
    data[index + 1] = color.green;
    data[index + 2] = color.blue;
    data[index + 3] = Math.round(data[index + 3] * alphaScale);
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: 4
    }
  })
    .png()
    .toBuffer();
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

  return characters.sort((a, b) => {
    if (a.id === "demo-character" && b.id !== "demo-character") {
      return 1;
    }
    if (b.id === "demo-character" && a.id !== "demo-character") {
      return -1;
    }
    return a.displayName.localeCompare(b.displayName, "ja");
  });
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
  const primaryCharacter = characters.find((character) => character.id === "zannenin") ?? characters[0];
  return htmlPage({
    title: "Character Canon",
    description: "Character Canon is an official character setting archive that publishes profiles, timelines, links, visual references, and AI prompt materials.",
    urlPath: "",
    imagePath: primaryCharacter ? `${primaryCharacter.id}/assets/generated/ogp.png` : null,
    type: "website",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "Character Canon",
      url: absoluteUrl(""),
      inLanguage: "ja",
      about: characters.map((character) => character.displayName)
    },
    body: `
      <main class="shell">
        <section class="hero">
          <p class="eyebrow">Character Canon</p>
          <h1>公式設定を育て、サイトとAIプロンプトへ反映する。</h1>
          <p class="lead">キャラクターごとの正本データから、公式サイト、会話AI向けプロンプト、画像生成AI向けプロンプト、動画生成AI向けプロンプトを生成します。</p>
        </section>
        ${renderSourceCallout({
          eyebrow: "Open Source Canon",
          title: "このサイトのソース",
          description: "キャラクター設定、サイト生成ロジック、AIプロンプト生成ルールは GitHub で管理しています。編集協力や改善提案も歓迎です。",
          links: [
            { label: "GitHubでソースを見る", href: sourceRepoUrl },
            { label: "キャラクター設定を見る", href: sourceFileUrl("content/characters") }
          ]
        })}
        <section class="section">
          <h2>Characters</h2>
          <div class="character-grid">
            ${characters.map((character) => `
              <article class="character-card">
                ${renderCharacterCardMedia(character)}
                <h3><a href="./${escapeHtml(character.id)}/">${escapeHtml(character.displayName)}</a></h3>
                <p>${escapeHtml(character.summary)}</p>
                <div class="links">
                  <a href="./${escapeHtml(character.id)}/">公式サイト</a>
                  <a href="./prompts/${escapeHtml(character.id)}/agent.md">Agent</a>
                  <a href="./prompts/${escapeHtml(character.id)}/t2t.md">T2T</a>
                  <a href="./prompts/${escapeHtml(character.id)}/image-default.md">Image</a>
                  <a href="./prompts/${escapeHtml(character.id)}/video-default.md">Video</a>
                  <a href="./prompts/${escapeHtml(character.id)}/image-outfit-change.md">Image Outfit</a>
                  <a href="./prompts/${escapeHtml(character.id)}/video-outfit-change.md">Video Outfit</a>
                </div>
              </article>
            `).join("")}
          </div>
        </section>
      </main>
    `
  });
}

function renderCharacterCardMedia(character) {
  const banner = character.brandAssets?.banner;
  if (!banner?.source) {
    return "";
  }

  const alt = banner.alt ?? `${character.displayName} バナー`;
  return `
    <a class="character-card-media" href="./${escapeHtml(character.id)}/" aria-label="${escapeHtml(character.displayName)}の公式サイトを見る">
      <img src="./${escapeHtml(character.id)}/assets/generated/brand/banner-logo.webp" alt="${escapeHtml(alt)}" loading="lazy">
    </a>
  `;
}

function renderCharacter(character) {
  return htmlPage({
    title: character.displayName,
    description: character.summary,
    urlPath: `${character.id}/`,
    imagePath: `${character.id}/assets/generated/ogp.png`,
    type: "profile",
    structuredData: characterStructuredData(character, `${character.id}/`),
    headExtra: renderAiPromptHeadMetadata(character),
    theme: character.theme,
    body: `
      <main>
        <section class="character-hero">
          ${renderBrandBanner(character)}
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
          ${renderFanworkGuidelinesCard(character)}
          ${renderAiPrompts(character)}
          <div class="detail-layout wide">
            <div class="detail-main">
              <section class="panel" id="profile">
                ${renderSectionHeading("profile")}
                <dl class="profile-list">
                  ${Object.entries(character.profile).map(([key, value]) => `
                    <div>
                      <dt>${escapeHtml(key)}</dt>
                      <dd>${renderProfileValue(value)}</dd>
                    </div>
                  `).join("")}
                </dl>
              </section>
            </div>
            <div class="detail-stack">
              <section class="panel" id="glossary">
                ${renderSectionHeading("glossary")}
                <div class="stack">
                  ${character.glossary.map((item) => `
                    <article>
                      <h3>${escapeHtml(item.term)}</h3>
                      <p>${escapeHtml(item.definition)}</p>
                    </article>
                  `).join("")}
                </div>
              </section>
              ${renderSideFlavors(character)}
              <section class="panel wide" id="settings">
                ${renderSectionHeading("settings")}
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
            </div>
          </div>
          <section class="panel wide" id="timeline">
            ${renderSectionHeading("timeline")}
            ${renderTimelineGroups(character.timeline)}
          </section>
          ${renderRightsSection(character)}
          ${renderHiddenEntrances(character)}
          ${renderSourceCallout({
            eyebrow: "Source",
            title: "このサイトのソース",
            description: `${character.displayName} の公式設定データは GitHub 上の JSON で管理しています。追記・修正の協力や、設定追加の提案を歓迎します。`,
            links: [
              { label: "このキャラの設定JSON", href: sourceFileUrl(`content/characters/${character.id}/character.json`) },
              { label: "GitHubリポジトリ", href: sourceRepoUrl }
            ],
            panel: true
          })}
        </div>
      </main>
    `
  });
}

function hiddenPages(character) {
  if (!Array.isArray(character.hiddenPages)) {
    return [];
  }

  return character.hiddenPages.filter((page) => page?.slug && page?.entryLabel);
}

function renderHiddenEntrances(character) {
  const pages = hiddenPages(character);
  if (pages.length === 0) {
    return "";
  }

  return `
    <div class="hidden-entrances" aria-label="隠しページ">
      ${pages.map((page) => `
        <a class="hidden-entrance" href="./${escapeHtml(page.slug)}.html">${escapeHtml(page.entryLabel)}</a>
      `).join("")}
    </div>
  `;
}

function renderHiddenPage(character, page) {
  const title = page.title ?? page.entryLabel;
  const description = page.description ?? `${character.displayName} の隠しページです。`;
  const counter = page.counter ?? "0000001";
  const kiriban = page.kiriban ?? "キリ番を踏んだ方は掲示板で教えてください。";
  const body = page.body ?? "作成中";
  const pageTitle = title.includes(character.displayName) ? title : `${character.displayName} ${title}`;
  const randomVideoPlayer = page.randomVideoPlayer ?? character.randomVideoPlayer;
  const hasRandomVideos = randomDriveVideos(randomVideoPlayer).length > 0;

  return htmlPage({
    title: pageTitle,
    description,
    urlPath: `${character.id}/${page.slug}.html`,
    imagePath: `${character.id}/assets/generated/ogp.png`,
    type: "article",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: pageTitle,
      description,
      url: absoluteUrl(`${character.id}/${page.slug}.html`),
      inLanguage: "ja",
      isPartOf: {
        "@type": "WebSite",
        name: "Character Canon",
        url: absoluteUrl("")
      },
      about: {
        "@type": "Thing",
        name: character.displayName,
        url: absoluteUrl(`${character.id}/`)
      }
    },
    theme: character.theme,
    body: `
      <main class="retro-homepage">
        <div class="retro-shell">
          <div class="retro-marquee" aria-hidden="true">
            <span>★ ようこそ ★ ${escapeHtml(character.displayName)} の隠しホームページへ ★ ゆっくりしていってね ★</span>
          </div>
          <header class="retro-header">
            <p class="retro-subtitle">Since 1999 / Last update 2026.05.10</p>
            <h1>${renderRetroTitle(title)}</h1>
            <div class="retro-counter" aria-label="アクセスカウンター">
              <span class="retro-counter-label">あなたは</span>
              <span class="retro-counter-digits">${escapeHtml(counter)}</span>
              <span class="retro-counter-label">人目のお客様です</span>
            </div>
            <p class="retro-kiriban">${escapeHtml(kiriban)}</p>
          </header>
          <nav class="retro-nav" aria-label="隠しページメニュー">
            <a href="./">公式ページへ戻る</a>
            <a href="#about">このページについて</a>
            <a href="#diary">日記</a>
            <a href="#bbs">掲示板</a>
          </nav>
          <section class="retro-box" id="about">
            <h2>★ このページについて ★</h2>
            <p>ここは ${escapeHtml(character.displayName)} の隠しページです。</p>
            <p>白背景に小さい文字、点線、カウンター、工事中。そういう時代の空気を置いています。</p>
          </section>
          <section class="retro-box" id="diary">
            <h2>★ 日記 ★</h2>
            <p>${escapeHtml(body)}</p>
          </section>
          ${renderRandomDriveVideoPlayer(randomVideoPlayer)}
          <section class="retro-box" id="bbs">
            <h2>★ 掲示板 ★</h2>
            <p>キリ番を踏んだ人は心の掲示板に書き込んでください。</p>
          </section>
          <footer class="retro-footer">
            <p>無断転載禁止 / リンクフリー / バナーは作成中</p>
            <p><a href="./">戻る</a></p>
          </footer>
        </div>
        ${hasRandomVideos ? renderRandomDriveVideoScript() : ""}
      </main>
    `
  });
}

function renderRetroTitle(title) {
  const marker = "のホームページ";
  if (title.endsWith(marker) && title.length > marker.length) {
    return `
      <span>${escapeHtml(title.slice(0, -marker.length + 1))}</span>
      <span>${escapeHtml("ホームページ")}</span>
    `;
  }

  return escapeHtml(title);
}

function randomDriveVideos(player) {
  if (!player || !Array.isArray(player.videos)) {
    return [];
  }

  return player.videos
    .filter((item) => item?.driveId)
    .map((item) => ({
      label: item.label ?? item.name ?? item.driveId,
      embedUrl: item.embedUrl ?? `https://drive.google.com/file/d/${item.driveId}/preview`
    }));
}

function renderRandomDriveVideoPlayer(player) {
  const videos = randomDriveVideos(player);
  if (videos.length === 0) {
    return "";
  }

  const title = player.title ?? "Random Videos";
  const description = player.description ?? "";
  const firstVideo = videos[0];

  return `
    <section class="retro-box retro-video-box" id="videos" data-random-drive-video-player>
      <h2>★ ${escapeHtml(title)} ★</h2>
      ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      <div class="retro-video-frame">
        <iframe
          title="${escapeHtml(firstVideo.label)}"
          src="${escapeHtml(firstVideo.embedUrl)}"
          allow="autoplay; fullscreen"
          allowfullscreen
          loading="lazy"
          data-random-drive-video-frame
        ></iframe>
      </div>
      <p class="retro-video-title" data-random-drive-video-title>${escapeHtml(firstVideo.label)}</p>
      <div class="retro-video-actions">
        <button type="button" data-random-drive-video-next>ランダム再生</button>
        ${player.folderUrl ? `<a href="${escapeHtml(player.folderUrl)}" target="_blank" rel="noopener noreferrer">動画フォルダ</a>` : ""}
      </div>
      <script type="application/json" data-random-drive-video-data>${escapeScriptJson(videos)}</script>
    </section>
  `;
}

function renderRandomDriveVideoScript() {
  return `
    <script>
      (() => {
        for (const root of document.querySelectorAll("[data-random-drive-video-player]")) {
          const data = root.querySelector("[data-random-drive-video-data]");
          const frame = root.querySelector("[data-random-drive-video-frame]");
          const title = root.querySelector("[data-random-drive-video-title]");
          const next = root.querySelector("[data-random-drive-video-next]");
          if (!data || !frame || !next) continue;

          let videos = [];
          try {
            videos = JSON.parse(data.textContent || "[]");
          } catch {
            videos = [];
          }
          if (videos.length === 0) continue;

          let currentIndex = -1;
          const showVideo = () => {
            let index = Math.floor(Math.random() * videos.length);
            if (videos.length > 1 && index === currentIndex) {
              index = (index + 1) % videos.length;
            }
            currentIndex = index;
            const video = videos[index];
            frame.src = video.embedUrl;
            frame.title = video.label;
            if (title) title.textContent = video.label;
          };

          next.addEventListener("click", showVideo);
          showVideo();
        }
      })();
    </script>
  `;
}

function renderFanworkGuidelinesCard(character) {
  if (!character.fanworkGuidelines) {
    return "";
  }

  const isDraft = character.fanworkGuidelines.status !== "official";
  const linkLabel = isDraft ? "ガイドライン案を見る" : "ガイドラインを見る";

  return `
    <section class="panel wide guideline-card" id="fanworks">
      <p class="eyebrow">Fanworks</p>
      ${renderSectionHeading("fanworks")}
      <p>${escapeHtml(character.fanworkGuidelines.summary)}</p>
      <div class="links">
        <a href="./fanworks.html">${escapeHtml(linkLabel)}</a>
      </div>
    </section>
  `;
}

function renderRightsSection(character, { id = "rights" } = {}) {
  const rights = character.rights ?? {};
  const rows = [
    ["権利者", rights.holderName ?? "未定義", rights.holderUrl],
    ["管理者", rights.managedBy ?? "未定義", rights.managedByUrl],
    ["問い合わせ先", rights.contact ?? "未定義", rights.contactUrl]
  ];
  const notice = rights.notice ?? "権利者情報は確認中です。確定後に更新します。";

  return `
    <section class="panel wide rights-panel" id="${escapeHtml(id)}">
      <p class="eyebrow">Rights</p>
      <h2>権利者情報</h2>
      <dl class="rights-list">
        ${rows.map(([key, value, href]) => `
          <div>
            <dt>${escapeHtml(key)}</dt>
            <dd>${renderRightsValue(value, href)}</dd>
          </div>
        `).join("")}
      </dl>
      <p>${escapeHtml(notice)}</p>
    </section>
  `;
}

function renderRightsValue(value, href) {
  const label = value ?? "未定義";
  const url = href ?? (isHttpUrl(label) ? label : "");
  if (!url) {
    return escapeHtml(label);
  }

  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function renderAiPrompts(character) {
  const promptDocs = promptDocuments(character);
  const hasFanworkGuidelines = Boolean(character.fanworkGuidelines);
  const hasOfficialFanworkGuidelines = character.fanworkGuidelines?.status === "official";
  const sectionClass = hasFanworkGuidelines ? "panel wide" : "panel wide prompts-solo";
  const note = hasOfficialFanworkGuidelines
    ? `「${character.displayName}」をAI生成で利用する際の推奨プロンプトです。キャラクター二次創作ガイドラインに記載の範囲内で、ご自由にご利用いただけます。`
    : hasFanworkGuidelines
      ? `「${character.displayName}」をAI生成で利用する際の推奨プロンプトです。二次創作ガイドライン案と公式設定に記載された範囲を参照し、未定義の内容は補完せずに扱います。`
      : `「${character.displayName}」をAI生成で利用する際の推奨プロンプトです。公式設定に記載された範囲を参照し、未定義の内容は補完せずに扱います。`;

  return `
    <section class="${sectionClass}" id="prompts">
      ${renderSectionHeading("prompts")}
      <p class="section-note">${escapeHtml(note)}</p>
      <div class="links">
        ${promptDocs.map((prompt) => `<a href="../${escapeHtml(prompt.path)}">${escapeHtml(prompt.label)}</a>`).join("")}
      </div>
    </section>
  `;
}

function promptDocuments(character) {
  const basePath = `prompts/${character.id}`;
  return [
    {
      key: "agent",
      label: "AI Agent",
      title: `${character.displayName} AI Agent Prompt`,
      path: `${basePath}/agent.md`,
      description: "会話AI/カスタムエージェント向けの人格・応答ルール。"
    },
    {
      key: "t2t",
      label: "Text-to-Text",
      title: `${character.displayName} Text-to-Text Character Context`,
      path: `${basePath}/t2t.md`,
      description: "文章生成、設定参照、台本生成向けのキャラクター文脈。"
    },
    {
      key: "image-default",
      label: "画像生成（通常衣装）",
      title: `${character.displayName} Image Generation Prompt - Default Outfit`,
      path: `${basePath}/image-default.md`,
      description: "通常衣装での画像生成向けプロンプト。"
    },
    {
      key: "video-default",
      label: "動画生成（通常衣装）",
      title: `${character.displayName} Video Generation Prompt - Default Outfit`,
      path: `${basePath}/video-default.md`,
      description: "通常衣装での動画生成向けプロンプト。"
    },
    {
      key: "image-outfit-change",
      label: "画像生成（衣装変更用）",
      title: `${character.displayName} Image Generation Prompt - Outfit Change`,
      path: `${basePath}/image-outfit-change.md`,
      description: "衣装変更を許容する画像生成向けプロンプト。"
    },
    {
      key: "video-outfit-change",
      label: "動画生成（衣装変更用）",
      title: `${character.displayName} Video Generation Prompt - Outfit Change`,
      path: `${basePath}/video-outfit-change.md`,
      description: "衣装変更を許容する動画生成向けプロンプト。"
    }
  ];
}

function renderAiPromptHeadMetadata(character) {
  const promptDocs = promptDocuments(character).map((prompt) => ({
    ...prompt,
    url: absoluteUrl(prompt.path),
    encodingFormat: "text/markdown",
    inLanguage: "ja"
  }));
  const manifest = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${character.displayName} AI prompt markdown index`,
    description: `${character.displayName} の生成AI向けMarkdownプロンプト一覧。`,
    characterId: character.id,
    characterName: character.displayName,
    itemListElement: promptDocs.map((prompt, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "CreativeWork",
        name: prompt.title,
        description: prompt.description,
        url: prompt.url,
        encodingFormat: prompt.encodingFormat,
        inLanguage: prompt.inLanguage
      }
    }))
  };

  return `
    <meta name="ai:prompt-index" content="${escapeHtml(absoluteUrl(`prompts/${character.id}/agent.md`))}">
    ${promptDocs.map((prompt) => `
    <meta name="ai:prompt:${escapeHtml(prompt.key)}" content="${escapeHtml(prompt.url)}">
    <link rel="alternate" type="text/markdown" title="${escapeHtml(prompt.title)}" href="${escapeHtml(prompt.url)}">`).join("")}
    <script type="application/json" id="ai-prompt-manifest">${escapeScriptJson(manifest)}</script>
  `;
}

function renderFanworkGuidelines(character) {
  const guidelines = character.fanworkGuidelines;
  const isDraft = guidelines.status !== "official";
  return htmlPage({
    title: guidelines.title,
    description: guidelines.summary,
    urlPath: `${character.id}/fanworks.html`,
    imagePath: `${character.id}/assets/generated/ogp.png`,
    type: "article",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: guidelines.title,
      description: guidelines.summary,
      url: absoluteUrl(`${character.id}/fanworks.html`),
      inLanguage: "ja",
      isPartOf: {
        "@type": "WebSite",
        name: "Character Canon",
        url: absoluteUrl("")
      },
      about: {
        "@type": "Thing",
        name: character.displayName,
        url: absoluteUrl(`${character.id}/`)
      }
    },
    theme: character.theme,
    body: `
      <main>
        <section class="character-hero guideline-hero">
          <div class="shell">
            <a class="back-link" href="./">公式サイトへ戻る</a>
            <p class="eyebrow">Fanwork Guidelines</p>
            <h1>${escapeHtml(guidelines.title)}</h1>
            <p class="lead">${escapeHtml(guidelines.summary)}</p>
            <div class="hero-facts">
              <span><strong>Status</strong>${escapeHtml(guidelines.status)}</span>
              <span><strong>Use</strong>${isDraft ? "ガイドライン案参照" : "ガイドライン参照"}</span>
            </div>
            <div class="guideline-actions">
              <button class="print-button" type="button" data-print-page>PDF出力</button>
            </div>
          </div>
        </section>
        <div class="shell content-layout guideline-layout">
          <section class="panel wide guideline-notice">
            <h2>利用の前提</h2>
            <p>${isDraft ? "このページは二次創作をしやすくするためのドラフトです。内容は今後、公式運用に合わせて更新される可能性があります。" : "このページは二次創作をしやすくするためのガイドラインです。内容は公式運用に合わせて更新される可能性があります。"}</p>
            ${guidelines.contact ? `<p>${escapeHtml(guidelines.contact)}</p>` : ""}
          </section>
          ${guidelines.sections.map((section) => `
            <section class="panel wide guideline-section">
              <h2>${escapeHtml(section.title)}</h2>
              <ul class="guideline-list">
                ${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
              </ul>
            </section>
          `).join("")}
          ${renderRightsSection(character, { id: "guideline-rights" })}
          ${renderRevisionHistory(guidelines)}
        </div>
      </main>
    `
  });
}

function renderRevisionHistory(guidelines) {
  const history = Array.isArray(guidelines.revisionHistory) ? guidelines.revisionHistory : [];
  if (history.length === 0) {
    return "";
  }

  return `
    <section class="panel wide guideline-section revision-history" id="revision-history">
      <p class="eyebrow">Revision History</p>
      <h2>改訂履歴</h2>
      <ol class="revision-list">
        ${history.map((entry) => `
          <li>
            <time datetime="${escapeHtml(entry.date)}">${escapeHtml(entry.date)}</time>
            <span>${escapeHtml(entry.summary)}</span>
          </li>
        `).join("")}
      </ol>
    </section>
  `;
}

function renderBrandBanner(character) {
  if (!character.brandAssets?.banner?.source) {
    return "";
  }

  const alt = character.brandAssets.banner.alt ?? `${character.displayName} バナー`;
  return `
    <div class="brand-banner-shell" id="top">
      <img class="brand-banner" src="./assets/generated/brand/banner-logo.webp" alt="${escapeHtml(alt)}">
    </div>
  `;
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
    ["links", sectionLabels.links.en],
    ["visual", "Visual"],
    ["fanworks", sectionLabels.fanworks.en],
    ["prompts", "AI"],
    ["profile", sectionLabels.profile.en],
    ["glossary", sectionLabels.glossary.en],
    ["settings", sectionLabels.settings.en],
    ["side-flavors", "Flavor"],
    ["timeline", sectionLabels.timeline.en],
    ["rights", "Rights"]
  ];

  const visibleItems = items.filter(([id]) => {
    if (id === "links") {
      return hasItems(character.links) || hasItems(character.contentLinks);
    }
    if (id === "visual") {
      return hasItems(character.visualReferences);
    }
    if (id === "fanworks") {
      return Boolean(character.fanworkGuidelines);
    }
    if (id === "side-flavors") {
      return hasItems(character.sideFlavors);
    }
    return true;
  });

  return `
    <nav class="page-menu" aria-label="ページ内メニュー">
      <div class="shell page-menu-inner">
        <span class="page-menu-label">MENU</span>
        <div class="page-menu-scroll">
          ${visibleItems.map(([id, label]) => `<a href="#${id}">${escapeHtml(label)}</a>`).join("")}
        </div>
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
      ${renderSectionHeading("sideFlavors")}
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

function renderSourceCallout({ eyebrow, title, description, links, panel = false }) {
  return `
    <section class="source-callout${panel ? " panel wide" : ""}">
      <div>
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
      <div class="source-links">
        ${links.map((link) => `
          <a href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">
            ${renderLinkIcon(link)}
            ${escapeHtml(link.label)}
          </a>
        `).join("")}
      </div>
    </section>
  `;
}

function sourceFileUrl(filePath) {
  const normalizedPath = String(filePath).replace(/^\/+/, "");
  const route = path.extname(normalizedPath) ? "blob" : "tree";
  return `${sourceRepoUrl}/${route}/main/${normalizedPath}`;
}

function renderTimelineGroups(timeline) {
  const groups = [
    {
      type: "fictional",
      title: "Fictional Timeline",
      subtitle: "架空年表",
      note: "年齢が固定されるキャラクター内時間、作中前史、自己申告ベースの出来事。"
    },
    {
      type: "real",
      title: "Real Timeline",
      subtitle: "実年表",
      note: "公開日、活動履歴、SNSやサービス上で実際に発生した出来事。"
    }
  ];

  const entriesByType = new Map();
  for (const item of timeline) {
    const type = item.timelineType === "real" ? "real" : "fictional";
    entriesByType.set(type, [...(entriesByType.get(type) ?? []), item]);
  }

  return groups
    .filter((group) => (entriesByType.get(group.type) ?? []).length > 0)
    .map((group) => `
      <section class="timeline-group timeline-group-${escapeHtml(group.type)}">
        <div class="timeline-group-heading">
          <div>
            <h3>${escapeHtml(group.title)}</h3>
            <p>${escapeHtml(group.subtitle)}</p>
          </div>
          <span>${escapeHtml(group.type === "real" ? "Observed" : "In-Canon")}</span>
        </div>
        <p class="timeline-note">${escapeHtml(group.note)}</p>
        <ol class="timeline">
          ${(entriesByType.get(group.type) ?? []).map((item) => `
            <li>
              ${renderTimelineDate(item.date)}
              <div>
                <h3>${escapeHtml(item.event)}</h3>
                ${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ""}
              </div>
            </li>
          `).join("")}
        </ol>
      </section>
    `)
    .join("");
}

function renderVisualReferences(character) {
  if (!Array.isArray(character.visualReferences) || character.visualReferences.length === 0) {
    return "";
  }

  const baseReferences = character.visualReferences.filter((item) => item.source !== "google-drive");
  const driveReferences = character.visualReferences.filter((item) => item.source === "google-drive");

  return `
    <section class="panel wide visual-references" id="visual">
      <p class="eyebrow">🎀 Visual Reference</p>
      ${renderSectionHeading("visual")}
      ${baseReferences.length > 0 ? `
        <div class="visual-base">
          ${baseReferences.map((item) => renderVisualReferenceCard(item)).join("")}
        </div>
      ` : ""}
      ${driveReferences.length > 0 ? `
        <div class="visual-archive" data-progressive-gallery data-initial="8" data-mobile-initial="2" data-step="8" data-mobile-step="4">
          <div class="visual-archive-header">
            <span>Google Drive資料集</span>
            <small>公式資料集から取り込んだ追加資料 ${driveReferences.length}件</small>
          </div>
          <div class="visual-grid">
            ${driveReferences.map((item, index) => renderVisualReferenceCard(item, { hidden: index >= 2 })).join("")}
          </div>
          ${driveReferences.length > 8 ? `
            <button class="visual-more" type="button" data-gallery-more>
              もっと表示
              <span data-gallery-count>2 / ${driveReferences.length}</span>
            </button>
          ` : ""}
        </div>
      ` : ""}
    </section>
  `;
}

function renderVisualReferenceCard(item, { hidden = false } = {}) {
  const thumbPath = `./${escapeHtml(visualReferenceThumbPath(item.path))}`;
  const imageAttributes = hidden
    ? `src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" data-src="${thumbPath}"`
    : `src="${thumbPath}"`;

  return `
    <figure class="visual-card"${hidden ? " hidden" : ""}>
      <a class="visual-link" href="./${escapeHtml(visualReferenceLargePath(item.path))}" target="_blank" rel="noopener noreferrer" data-lightbox-image aria-label="${escapeHtml(item.label)}を拡大表示">
        <img ${imageAttributes} alt="${escapeHtml(item.label)}" loading="lazy">
        <span>タップで拡大</span>
      </a>
      <figcaption>
        <strong>${escapeHtml(item.label)}</strong>
        ${item.description ? `<span>${escapeHtml(item.description)}</span>` : ""}
      </figcaption>
    </figure>
  `;
}

function renderProfileValue(value) {
  const text = String(value);
  const colorPattern = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  const matches = Array.from(text.matchAll(colorPattern));
  if (matches.length === 0) {
    return escapeHtml(text);
  }

  let html = "";
  let lastIndex = 0;
  for (const match of matches) {
    const color = match[0];
    html += escapeHtml(text.slice(lastIndex, match.index));
    html += `<span class="profile-color-token"><span>${escapeHtml(color)}</span><span class="color-swatch" style="--swatch-color: ${escapeHtml(color)}" aria-label="${escapeHtml(color)}"></span></span>`;
    lastIndex = match.index + color.length;
  }
  html += escapeHtml(text.slice(lastIndex));
  return html;
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
      ${renderSectionHeading("links")}
      ${renderLinkGroup("Contents", contentLinks)}
      ${renderLinkGroup("Social", socialLinks)}
    </section>
  `;
}

function renderSectionHeading(key) {
  const label = sectionLabels[key];
  if (!label) {
    return `<h2>${escapeHtml(key)}</h2>`;
  }

  return `
    <h2 class="section-title">
      <span>${escapeHtml(label.en)}</span>
      <small>${escapeHtml(label.ja)}</small>
    </h2>
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
      <small>${escapeHtml(formatUrl(link))}</small>
      ${link.description ? `<em>${escapeHtml(link.description)}</em>` : ""}
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

${renderTimelineMarkdown(character)}

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

${renderTimelineMarkdown(character)}

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

function renderTimelineMarkdown(character) {
  const groups = [
    ["fictional", "Fictional Timeline / 架空年表"],
    ["real", "Real Timeline / 実年表"]
  ];

  const entries = character.timeline ?? [];
  return groups
    .map(([type, title]) => {
      const items = entries.filter((item) => (item.timelineType === "real" ? "real" : "fictional") === type);
      if (items.length === 0) {
        return "";
      }

      return `### ${title}

${items.map((item) => `- ${item.date}: ${item.event}${item.detail ? `。${item.detail}` : ""}`).join("\n")}`;
    })
    .filter(Boolean)
    .join("\n\n");
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

function renderImagePrompt(character, { outfitMode }) {
  const isOutfitChange = outfitMode === "outfit-change";
  const titleSuffix = isOutfitChange ? "Image Generation Prompt - Outfit Change" : "Image Generation Prompt - Default Outfit";
  const visualGuidance = isOutfitChange
    ? withoutOutfitGuidance(character.promptGuidance.image)
    : character.promptGuidance.image;

  return `# ${character.displayName} ${titleSuffix}

## Mode

${isOutfitChange ? outfitChangeModeText("画像") : defaultOutfitModeText("画像")}

## Character Canon

${character.summary}

## Profile

${Object.entries(character.profile).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Visual Guidance

${visualGuidance.map((item) => `- ${item}`).join("\n")}

## Outfit Guidance

${isOutfitChange ? outfitChangeGuidance(character) : defaultOutfitGuidance(character)}

${renderVisualReferencesMarkdown(character)}

## World / Setting

${renderSettingsMarkdown(character, { includeOutfit: !isOutfitChange })}
`;
}

function renderVideoPrompt(character, { outfitMode }) {
  const isOutfitChange = outfitMode === "outfit-change";
  const titleSuffix = isOutfitChange ? "Video Generation Prompt - Outfit Change" : "Video Generation Prompt - Default Outfit";

  return `# ${character.displayName} ${titleSuffix}

## Mode

${isOutfitChange ? outfitChangeModeText("動画") : defaultOutfitModeText("動画")}

## Character Canon

${character.summary}

## Motion / Direction Guidance

${character.promptGuidance.video.map((item) => `- ${item}`).join("\n")}

## Outfit Guidance

${isOutfitChange ? outfitChangeGuidance(character) : defaultOutfitGuidance(character)}

## Profile

${Object.entries(character.profile).map(([key, value]) => `- ${key}: ${value}`).join("\n")}

## Timeline Awareness

${renderTimelineMarkdown(character)}
`;
}

function withoutOutfitGuidance(items = []) {
  const outfitWords = ["衣装", "修道服", "黒襟", "肩掛け", "金縁", "金ボタン", "チェーン", "タッセル", "フレアスカート", "編み上げブーツ"];
  return items.filter((item) => !outfitWords.some((word) => item.includes(word)));
}

function renderSettingsMarkdown(character, { includeOutfit = true } = {}) {
  return character.settings
    .filter((item) => includeOutfit || item.title !== "衣装")
    .map((item) => `- ${item.title}: ${item.body}`)
    .join("\n");
}

function defaultOutfitModeText(mediaLabel) {
  return `- このプロンプトは${mediaLabel}生成で通常衣装を使うためのもの。
- 通常衣装の指定を優先し、衣装を別デザインへ変更しない。
- 未定義の要素は推測で補完せず、必要に応じて未定義として扱う。`;
}

function outfitChangeModeText(mediaLabel) {
  return `- このプロンプトは${mediaLabel}生成で衣装を変更するためのもの。
- キャラクター本人の識別情報、顔、髪、体型、年齢、口調や雰囲気は維持する。
- 通常衣装は参照情報として扱い、衣装デザインを固定しない。
- ユーザーが指定した衣装を優先する。衣装指定がない場合、通常衣装へ自動で戻さず、衣装は未指定として扱う。
- 未定義の要素は推測で補完せず、必要に応じて未定義として扱う。`;
}

function defaultOutfitGuidance(character) {
  const outfit = character.settings.find((item) => item.title === "衣装");
  if (!outfit) {
    return "- 通常衣装は未定義。推測で補完しない。";
  }

  return `- 通常衣装: ${outfit.body}`;
}

function outfitChangeGuidance(character) {
  const outfit = character.settings.find((item) => item.title === "衣装");
  const reference = outfit ? `\n- 通常衣装の参考情報: ${outfit.body}` : "";
  return `- 衣装は変更可能。通常衣装の構造や配色を必ず維持する必要はない。
- ただし、残念院さん本人としての顔立ち、銀色のツーサイドアップ、魅力的なおでこ、八重歯、グレーの目元、華奢でフラットな体型、黒と金のイメージカラーは必要に応じて保持する。
- 年齢は自称17歳（成人済）として扱い、キャラクター性に反する性的な衣装・演出へ寄せない。${reference}`;
}

function htmlPage({ title, body, theme, description, urlPath = "", imagePath, type = "website", structuredData, headExtra = "" }) {
  const canonicalUrl = absoluteUrl(urlPath);
  const seoDescription = normalizeDescription(description ?? title);
  const absoluteImageUrl = imagePath ? absoluteUrl(imagePath) : null;
  const titleSuffix = title === "Character Canon" ? "" : " | Character Canon";
  const themeColor = theme?.primary && isCssColor(theme.primary) ? theme.primary : "#151217";
  const imageAlt = `${title} OGP card`;

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(`${title}${titleSuffix}`)}</title>
    <meta name="description" content="${escapeHtml(seoDescription)}">
    <meta name="robots" content="index,follow,max-image-preview:large">
    <meta name="theme-color" content="${escapeHtml(themeColor)}">
    <meta name="format-detection" content="telephone=no">
    <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
    <meta property="og:site_name" content="Character Canon">
    <meta property="og:locale" content="ja_JP">
    <meta property="og:type" content="${escapeHtml(type)}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(seoDescription)}">
    <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
    ${absoluteImageUrl ? `
    <meta property="og:image" content="${escapeHtml(absoluteImageUrl)}">
    <meta property="og:image:secure_url" content="${escapeHtml(absoluteImageUrl)}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:type" content="image/png">
    <meta property="og:image:alt" content="${escapeHtml(imageAlt)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:image" content="${escapeHtml(absoluteImageUrl)}">` : `
    <meta name="twitter:card" content="summary">`}
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(seoDescription)}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Shippori+Mincho+B1:wght@600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700;900&display=swap">
    <link rel="stylesheet" href="${title === "Character Canon" ? "./styles.css" : "../styles.css"}">
    ${headExtra}
    ${structuredData ? `<script type="application/ld+json">${escapeScriptJson(structuredData)}</script>` : ""}
  </head>
  <body${theme ? ` style="${escapeHtml(renderThemeStyle(theme))}"` : ""}>
    ${body}
    ${renderClientScript()}
  </body>
</html>`;
}

function normalizeDescription(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function absoluteUrl(urlPath) {
  return new URL(String(urlPath ?? "").replace(/^\/+/, ""), siteUrl).toString();
}

function escapeScriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function characterStructuredData(character, urlPath) {
  const sameAs = [...(character.links ?? []), ...(character.contentLinks ?? [])]
    .map((link) => link.url)
    .filter(Boolean);
  const promptWorks = promptDocuments(character).map((prompt) => ({
    "@type": "CreativeWork",
    name: prompt.title,
    description: prompt.description,
    url: absoluteUrl(prompt.path),
    encodingFormat: "text/markdown",
    inLanguage: "ja",
    about: character.displayName
  }));

  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    name: character.displayName,
    description: character.summary,
    url: absoluteUrl(urlPath),
    inLanguage: "ja",
    image: absoluteUrl(`${character.id}/assets/generated/ogp.png`),
    about: {
      "@type": "Thing",
      name: character.displayName,
      description: character.summary,
      image: absoluteUrl(`${character.id}/assets/generated/ogp.png`),
      sameAs
    },
    isPartOf: {
      "@type": "WebSite",
      name: "Character Canon",
      url: absoluteUrl("")
    },
    subjectOf: promptWorks
  };
}

function renderRobotsTxt() {
  return `User-agent: *
Allow: /

Sitemap: ${absoluteUrl("sitemap.xml")}
`;
}

function renderSitemap(characters) {
  const urls = [
    { loc: absoluteUrl(""), priority: "0.8" },
    ...characters.flatMap((character) => [
      { loc: absoluteUrl(`${character.id}/`), priority: "1.0" },
      ...(character.fanworkGuidelines ? [{ loc: absoluteUrl(`${character.id}/fanworks.html`), priority: "0.7" }] : [])
    ])
  ];

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((item) => `  <url>
    <loc>${escapeXml(item.loc)}</loc>
    <lastmod>${sitemapLastmod}</lastmod>
    <priority>${item.priority}</priority>
  </url>`).join("\n")}
</urlset>
`;
}

function renderClientScript() {
  return `
<script>
(() => {
  const pageMenu = document.querySelector(".page-menu");
  const menuLinks = Array.from(document.querySelectorAll(".page-menu a[href^='#']"));
  const sections = menuLinks
    .map((link) => document.getElementById(link.getAttribute("href").slice(1)))
    .filter(Boolean);

  if (pageMenu && menuLinks.length && sections.length) {
    let activeId = "";
    let ticking = false;

    const centerMenuLink = (link) => {
      const scroller = link.closest(".page-menu-scroll");
      if (!scroller) return;
      const linkCenter = link.offsetLeft + link.offsetWidth / 2;
      const targetLeft = Math.max(0, linkCenter - scroller.clientWidth / 2);
      scroller.scrollTo({ left: targetLeft, behavior: "smooth" });
    };

    const setActive = (id, shouldScrollMenu = true) => {
      if (!id || id === activeId) return;
      activeId = id;
      for (const link of menuLinks) {
        const active = link.getAttribute("href") === "#" + id;
        link.classList.toggle("is-active", active);
        if (active) {
          link.setAttribute("aria-current", "true");
          if (shouldScrollMenu) {
            centerMenuLink(link);
          }
        } else {
          link.removeAttribute("aria-current");
        }
      }
    };

    const updateActiveSection = () => {
      ticking = false;
      const offset = pageMenu.offsetHeight + 28;
      let currentId = sections[0].id;
      for (const section of sections) {
        if (section.getBoundingClientRect().top - offset <= 0) {
          currentId = section.id;
        } else {
          break;
        }
      }
      setActive(currentId);
    };

    const requestUpdate = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(updateActiveSection);
    };

    for (const link of menuLinks) {
      link.addEventListener("click", () => {
        setActive(link.getAttribute("href").slice(1), false);
      });
    }

    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    window.addEventListener("hashchange", requestUpdate);
    updateActiveSection();
  }

  const lightboxLinks = Array.from(document.querySelectorAll("[data-lightbox-image]"));
  if (lightboxLinks.length) {
    const modal = document.createElement("dialog");
    modal.className = "image-modal";
    modal.innerHTML = '<div class="image-modal-frame"><div class="image-modal-toolbar"><strong data-modal-title></strong><div class="image-modal-actions"><span data-modal-count></span><a data-modal-open target="_blank" rel="noopener noreferrer">別タブで画像のみ表示</a><button type="button" data-modal-close aria-label="閉じる">閉じる</button></div></div><div class="image-modal-stage"><button class="image-modal-nav image-modal-prev" type="button" data-modal-prev aria-label="前の画像">‹</button><img data-modal-image alt=""><button class="image-modal-nav image-modal-next" type="button" data-modal-next aria-label="次の画像">›</button></div><p data-modal-caption></p></div>';
    document.body.append(modal);

    const modalImage = modal.querySelector("[data-modal-image]");
    const modalTitle = modal.querySelector("[data-modal-title]");
    const modalCaption = modal.querySelector("[data-modal-caption]");
    const modalCount = modal.querySelector("[data-modal-count]");
    const modalOpen = modal.querySelector("[data-modal-open]");
    const modalClose = modal.querySelector("[data-modal-close]");
    const modalPrev = modal.querySelector("[data-modal-prev]");
    const modalNext = modal.querySelector("[data-modal-next]");
    let currentImageIndex = 0;

    const getLightboxItem = (link) => {
      const image = link.querySelector("img");
      const caption = link.closest(".visual-card")?.querySelector("figcaption")?.innerText?.trim() ?? "";
      return {
        href: link.href,
        title: image?.alt || "Visual Reference",
        caption
      };
    };

    const showImageAt = (index) => {
      currentImageIndex = (index + lightboxLinks.length) % lightboxLinks.length;
      const item = getLightboxItem(lightboxLinks[currentImageIndex]);
      modalTitle.textContent = item.title;
      modalCaption.textContent = item.caption;
      modalCount.textContent = (currentImageIndex + 1) + " / " + lightboxLinks.length;
      modalImage.src = item.href;
      modalImage.alt = item.title;
      modalOpen.href = item.href;
    };

    const closeModal = () => {
      if (modal.open) modal.close();
    };
    const showPrevious = () => showImageAt(currentImageIndex - 1);
    const showNext = () => showImageAt(currentImageIndex + 1);

    modalClose.addEventListener("click", closeModal);
    modalPrev.addEventListener("click", showPrevious);
    modalNext.addEventListener("click", showNext);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal();
    });
    modal.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft") showPrevious();
      if (event.key === "ArrowRight") showNext();
    });

    lightboxLinks.forEach((link, index) => {
      link.addEventListener("click", (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        showImageAt(index);
        modal.showModal();
      });
    });
  }

  for (const gallery of document.querySelectorAll("[data-progressive-gallery]")) {
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    const initial = Number(gallery.dataset[mobile ? "mobileInitial" : "initial"] || 8);
    const step = Number(gallery.dataset[mobile ? "mobileStep" : "step"] || 8);
    const cards = Array.from(gallery.querySelectorAll(".visual-card"));
    const button = gallery.querySelector("[data-gallery-more]");
    const count = gallery.querySelector("[data-gallery-count]");
    if (!button) continue;

    const loadCardImages = (targetCards) => {
      for (const card of targetCards) {
        for (const image of card.querySelectorAll("img[data-src]")) {
          image.src = image.dataset.src;
          image.removeAttribute("data-src");
        }
      }
    };

    cards.forEach((card, index) => {
      card.hidden = index >= initial;
    });
    loadCardImages(cards.filter((card) => !card.hidden));

    const update = () => {
      const visible = cards.filter((card) => !card.hidden).length;
      if (count) count.textContent = visible + " / " + cards.length;
      if (visible >= cards.length) button.remove();
    };

    button.addEventListener("click", () => {
      const hiddenCards = cards.filter((card) => card.hidden).slice(0, step);
      for (const card of hiddenCards) {
        card.hidden = false;
      }
      loadCardImages(hiddenCards);
      update();
    });

    update();
  }

  for (const button of document.querySelectorAll("[data-print-page]")) {
    button.addEventListener("click", () => {
      window.print();
    });
  }
})();
</script>`;
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

[hidden] {
  display: none !important;
}

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

.brand-banner-shell {
  position: relative;
  width: min(1800px, calc(100% - 48px));
  margin: 0 auto 22px;
}

.brand-banner {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 1;
  object-fit: cover;
  object-position: center;
  border: 1px solid color-mix(in srgb, var(--theme-secondary) 62%, #000000);
  border-radius: 8px;
  background: var(--theme-primary);
  box-shadow: 0 18px 46px rgba(21, 18, 23, 0.24);
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
  overflow-wrap: break-word;
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

.hero h1 {
  max-width: 1040px;
  font-size: clamp(2.6rem, 5.1vw, 4rem);
  line-height: 1.08;
  overflow-wrap: normal;
  word-break: keep-all;
  line-break: strict;
  text-wrap: balance;
}

.guideline-hero h1 {
  max-width: 1120px;
  font-size: clamp(2.15rem, 4.7vw, 4.2rem);
  line-height: 1.08;
  overflow-wrap: normal;
  word-break: keep-all;
  text-wrap: balance;
}

h2 {
  margin: 0 0 18px;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 1.45rem;
  letter-spacing: 0;
}

.section-title {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  align-items: baseline;
}

.section-title small {
  color: var(--theme-muted);
  font-family: var(--font-sans);
  font-size: 0.8em;
  font-weight: 800;
}

.section-title small::before {
  content: "/ ";
  color: var(--theme-secondary);
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
  white-space: nowrap;
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

.page-menu-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 10px;
  padding-bottom: 10px;
}

.page-menu-label {
  display: inline-flex;
  min-height: 34px;
  flex: 0 0 auto;
  align-items: center;
  border-radius: 999px;
  padding: 7px 11px;
  background: var(--theme-primary);
  color: #ffffff;
  font-size: 0.78rem;
  font-weight: 900;
}

.page-menu-scroll {
  display: flex;
  gap: 8px;
  min-width: 0;
  overflow-x: auto;
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
.page-menu a:focus-visible,
.page-menu a.is-active,
.page-menu a[aria-current="true"] {
  border-color: var(--theme-secondary);
  background: var(--theme-primary);
  color: #ffffff;
}

.page-menu a.is-active,
.page-menu a[aria-current="true"] {
  box-shadow: 0 10px 20px rgba(21, 18, 23, 0.18);
}

.section {
  padding: 24px 0 56px;
}

.character-grid,
.content-layout {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
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

.character-card {
  overflow: hidden;
}

.character-card-media {
  display: block;
  margin: -22px -22px 18px;
  color: inherit;
  text-decoration: none;
}

.character-card-media img {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 1;
  object-fit: cover;
  object-position: center;
  background: var(--theme-primary);
  border-bottom: 1px solid var(--line);
}

.character-card-media:hover img,
.character-card-media:focus-visible img {
  filter: saturate(1.08) brightness(1.02);
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

.source-callout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
  margin: 22px 0 8px;
  border: 1px solid color-mix(in srgb, var(--theme-secondary) 34%, var(--line));
  border-radius: 8px;
  padding: 18px;
  background: color-mix(in srgb, var(--theme-accent) 34%, #ffffff);
  box-shadow: 0 14px 30px rgba(21, 18, 23, 0.08);
}

.source-callout.panel {
  margin: 0;
}

.source-callout .eyebrow,
.source-callout h2,
.source-callout p {
  margin: 0;
}

.source-callout h2 {
  margin-top: 4px;
  margin-bottom: 6px;
  font-size: 1.15rem;
}

.source-callout p:not(.eyebrow) {
  color: var(--muted);
  line-height: 1.7;
}

.source-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 10px;
}

.source-links a {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid var(--theme-primary);
  border-radius: 999px;
  padding: 7px 13px 7px 9px;
  background: var(--theme-primary);
  color: #ffffff;
  font-size: 0.88rem;
  font-weight: 900;
  text-decoration: none;
}

.source-links .link-icon {
  grid-row: auto;
  width: 26px;
  height: 26px;
  border-radius: 999px;
}

.source-links .link-icon svg {
  width: 16px;
  height: 16px;
}

.source-links a:hover,
.source-links a:focus-visible {
  border-color: var(--theme-secondary);
  background: var(--theme-secondary);
  color: var(--theme-primary);
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
  grid-template-columns: repeat(auto-fit, minmax(220px, 280px));
  justify-content: center;
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

.link-icon img {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  object-fit: cover;
}

.link-icon-image {
  background: transparent;
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

.link-icon-googleDrive {
  background: #1a73e8;
}

.link-icon-github {
  background: #24292f;
}

.link-icon-json {
  background: #7c3aed;
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

.link-card em {
  grid-column: 2;
  color: #f8dda0;
  font-size: 0.84rem;
  font-style: normal;
  font-weight: 800;
}

.visual-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  align-items: start;
  gap: 16px;
}

.visual-base {
  display: grid;
  gap: 16px;
  margin-bottom: 18px;
}

.visual-base .visual-link {
  width: min(100%, 920px);
  margin: 0 auto;
}

.visual-base .visual-link img {
  height: auto;
}

.visual-archive {
  border: 1px solid color-mix(in srgb, var(--theme-secondary) 32%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--theme-accent) 38%, #ffffff);
  overflow: hidden;
}

.visual-archive-header {
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  color: var(--theme-primary);
  font-weight: 900;
}

.visual-archive-header small {
  color: var(--theme-muted);
  font-weight: 800;
}

.visual-archive .visual-grid {
  padding: 16px;
  border-top: 1px solid color-mix(in srgb, var(--theme-secondary) 28%, var(--line));
  background: #ffffff;
}

.visual-more {
  display: flex;
  width: 100%;
  min-height: 48px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  gap: 12px;
  border: 0;
  border-top: 1px solid color-mix(in srgb, var(--theme-secondary) 28%, var(--line));
  background: var(--theme-primary);
  color: #ffffff;
  font: inherit;
  font-weight: 900;
}

.visual-more:hover,
.visual-more:focus-visible {
  background: color-mix(in srgb, var(--theme-primary) 84%, var(--theme-secondary));
}

.visual-more span {
  color: #f8dda0;
  font-size: 0.86rem;
}

.visual-card {
  display: grid;
  gap: 10px;
  margin: 0;
}

.visual-link {
  position: relative;
  display: block;
  width: 100%;
  color: #ffffff;
  text-decoration: none;
}

.visual-link img {
  display: block;
  width: 100%;
  height: 260px;
  object-fit: contain;
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
  min-width: 0;
  color: var(--muted);
  font-size: 0.9rem;
  line-height: 1.65;
}

.visual-card strong {
  color: var(--ink);
}

.image-modal {
  width: min(96vw, 1180px);
  max-width: 1180px;
  max-height: 94vh;
  border: 1px solid color-mix(in srgb, var(--theme-secondary) 45%, #ffffff);
  border-radius: 8px;
  padding: 0;
  background: #0b0a0d;
  color: #ffffff;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.46);
}

.image-modal::backdrop {
  background: rgba(8, 7, 10, 0.78);
  backdrop-filter: blur(5px);
}

.image-modal-frame {
  display: grid;
  max-height: 94vh;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.image-modal-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(21, 18, 23, 0.96);
}

.image-modal-toolbar strong {
  min-width: 0;
  overflow: hidden;
  font-size: 0.98rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-modal-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
}

.image-modal-actions [data-modal-count] {
  color: rgba(255, 255, 255, 0.72);
  font-size: 0.86rem;
  font-weight: 900;
  white-space: nowrap;
}

.image-modal-actions a,
.image-modal-actions button {
  display: inline-flex;
  min-height: 34px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 999px;
  padding: 7px 12px;
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
  font: inherit;
  font-size: 0.86rem;
  font-weight: 900;
  text-decoration: none;
}

.image-modal-actions a:hover,
.image-modal-actions a:focus-visible,
.image-modal-actions button:hover,
.image-modal-actions button:focus-visible {
  border-color: var(--theme-secondary);
  background: var(--theme-secondary);
  color: var(--theme-primary);
}

.image-modal-stage {
  position: relative;
  display: grid;
  min-height: 0;
  place-items: center;
  background: #111014;
}

.image-modal img {
  display: block;
  width: 100%;
  max-height: calc(94vh - 132px);
  object-fit: contain;
  background: #111014;
}

.image-modal-nav {
  position: absolute;
  top: 50%;
  z-index: 2;
  display: inline-flex;
  width: 44px;
  height: 64px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  transform: translateY(-50%);
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 999px;
  background: rgba(8, 7, 10, 0.62);
  color: #ffffff;
  font: inherit;
  font-size: 2.6rem;
  line-height: 1;
  backdrop-filter: blur(8px);
}

.image-modal-prev {
  left: 14px;
}

.image-modal-next {
  right: 14px;
}

.image-modal-nav:hover,
.image-modal-nav:focus-visible {
  border-color: var(--theme-secondary);
  background: var(--theme-secondary);
  color: var(--theme-primary);
}

.image-modal [data-modal-caption] {
  margin: 0;
  padding: 10px 14px 14px;
  color: rgba(255, 255, 255, 0.78);
  font-size: 0.9rem;
  line-height: 1.6;
}

.guideline-layout {
  max-width: 980px;
}

.guideline-card p,
.guideline-notice p,
.guideline-section p {
  color: var(--muted);
  line-height: 1.75;
}

.guideline-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding-left: 1.2em;
  color: var(--muted);
  line-height: 1.75;
}

.guideline-list li::marker {
  color: var(--theme-secondary);
}

.guideline-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 22px;
}

.print-button {
  min-height: 38px;
  border: 1px solid color-mix(in srgb, var(--theme-secondary) 54%, var(--line));
  border-radius: 999px;
  padding: 8px 16px;
  background: var(--theme-secondary);
  color: var(--theme-primary);
  font: inherit;
  font-weight: 800;
  cursor: pointer;
}

.print-button:hover,
.print-button:focus-visible {
  filter: brightness(1.04);
}

.rights-panel {
  display: grid;
  gap: 14px;
}

.rights-list {
  display: grid;
  gap: 10px;
  margin: 0;
}

.rights-list div {
  display: grid;
  grid-template-columns: minmax(112px, 0.28fr) 1fr;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--line);
}

.revision-list {
  display: grid;
  gap: 12px;
  margin: 0;
  padding-left: 1.2em;
  color: var(--muted);
  line-height: 1.75;
}

.revision-list li::marker {
  color: var(--theme-secondary);
}

.revision-list time {
  display: inline-block;
  min-width: 104px;
  color: var(--accent-dark);
  font-weight: 800;
}

.section-note {
  max-width: 760px;
  margin: 0 0 16px;
  color: var(--muted);
  line-height: 1.75;
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

.detail-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
}

.detail-main,
.detail-stack {
  display: grid;
  align-content: start;
  gap: 18px;
}

.detail-stack {
  grid-template-columns: minmax(0, 1fr);
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

.profile-color-token {
  display: inline-flex;
  align-items: center;
  gap: 0.38em;
  margin-right: 0.22em;
  white-space: nowrap;
}

.color-swatch {
  display: inline-block;
  width: 1.12em;
  height: 1.12em;
  border: 1px solid rgba(31, 26, 18, 0.22);
  border-radius: 4px;
  background: var(--swatch-color);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.42);
  vertical-align: -0.16em;
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

.timeline-group {
  display: grid;
  gap: 14px;
}

.timeline-group + .timeline-group {
  margin-top: 28px;
  padding-top: 24px;
  border-top: 1px dashed color-mix(in srgb, var(--theme-secondary) 44%, var(--line));
}

.timeline-group-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.timeline-group-heading h3 {
  margin: 0;
}

.timeline-group-heading p,
.timeline-note {
  margin: 0;
  color: var(--muted);
  line-height: 1.7;
}

.timeline-group-heading span {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  border: 1px solid color-mix(in srgb, var(--theme-secondary) 46%, var(--line));
  border-radius: 999px;
  padding: 5px 10px;
  background: color-mix(in srgb, var(--theme-accent) 46%, #ffffff);
  color: var(--theme-primary);
  font-size: 0.78rem;
  font-weight: 900;
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

.date-range {
  display: inline-grid;
  gap: 2px;
  justify-items: start;
  line-height: 1.16;
}

.date-range-separator {
  color: var(--theme-secondary);
  font-size: 0.82rem;
}

.hidden-entrances {
  grid-column: 1 / -1;
  min-height: 1.2rem;
  padding: 2px 0;
  font-size: 0.88rem;
  line-height: 1.4;
  user-select: text;
}

.hidden-entrance {
  color: transparent;
  text-decoration: none;
  text-shadow: none;
  user-select: text;
}

.hidden-entrance::selection {
  color: var(--theme-text);
  background: color-mix(in srgb, var(--theme-accent) 75%, #ffffff);
}

.hidden-entrance:focus-visible {
  color: var(--theme-text);
  outline: 2px solid var(--theme-primary);
  outline-offset: 3px;
}

.retro-homepage {
  min-height: 100vh;
  padding: 18px 10px;
  color: #000080;
  background:
    repeating-linear-gradient(45deg, #fff7c2 0 8px, #fffbdf 8px 16px),
    #fff8c8;
  font-family: "MS PGothic", "Osaka", "Hiragino Kaku Gothic ProN", sans-serif;
}

.retro-homepage a {
  color: #0000ee;
  text-decoration: underline;
}

.retro-homepage a:visited {
  color: #551a8b;
}

.retro-shell {
  width: min(760px, calc(100% - 12px));
  margin: 0 auto;
  padding: 8px;
  border: 4px ridge #ff66cc;
  background: #ffffff;
  box-shadow: 8px 8px 0 #99ccff;
}

.retro-marquee {
  overflow: hidden;
  border: 2px inset #cccccc;
  background: #000000;
  color: #00ff00;
  font: 700 0.92rem/1.8 "MS PGothic", monospace;
  white-space: nowrap;
}

.retro-marquee span {
  display: inline-block;
  padding-left: 100%;
  animation: retro-marquee 18s linear infinite;
}

@keyframes retro-marquee {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-100%);
  }
}

.retro-header {
  margin: 10px 0;
  padding: 12px 8px;
  border: 3px double #000080;
  background:
    linear-gradient(90deg, rgba(255, 153, 204, 0.34), rgba(153, 204, 255, 0.34)),
    #ffffff;
  text-align: center;
}

.retro-subtitle {
  margin: 0 0 6px;
  color: #cc0000;
  font-size: 0.82rem;
  font-weight: 700;
}

.retro-header h1 {
  max-width: none;
  margin: 0 0 10px;
  color: #ff1493;
  font-family: "MS Mincho", "Hiragino Mincho ProN", serif;
  font-size: clamp(2rem, 8vw, 3.7rem);
  line-height: 1.1;
  text-shadow: 2px 2px 0 #ffff00, 4px 4px 0 #00ccff;
  word-break: keep-all;
}

.retro-header h1 span {
  display: block;
}

.retro-counter {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 4px 0;
  color: #000000;
  font-size: 0.95rem;
}

.retro-counter-digits {
  display: inline-block;
  padding: 3px 7px;
  border: 3px inset #c0c0c0;
  background: #000000;
  color: #ffcc00;
  font: 700 1.1rem/1 "Courier New", monospace;
  letter-spacing: 0.12em;
}

.retro-kiriban {
  margin: 6px 0 0;
  color: #cc0000;
  font-size: 0.9rem;
  font-weight: 700;
}

.retro-nav {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin: 10px 0;
  padding: 8px;
  border-top: 2px dashed #ff66cc;
  border-bottom: 2px dashed #66ccff;
  background: #ffffee;
  font-size: 0.92rem;
}

.retro-nav a::before {
  content: "[ ";
  color: #ff1493;
}

.retro-nav a::after {
  content: " ]";
  color: #ff1493;
}

.retro-box {
  margin: 12px 0;
  padding: 10px;
  border: 2px dotted #000080;
  background: #ffffff;
}

.retro-box h2 {
  margin: 0 0 8px;
  color: #ffffff;
  background: #000080;
  font-family: "MS PGothic", sans-serif;
  font-size: 1rem;
  line-height: 1.4;
}

.retro-box p {
  margin: 8px 0;
  color: #222222;
  font-size: 0.96rem;
  line-height: 1.7;
}

.retro-video-frame {
  overflow: hidden;
  aspect-ratio: 16 / 9;
  border: 4px ridge #99ccff;
  background: #000000;
}

.retro-video-frame iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}

.retro-video-title {
  word-break: break-word;
}

.retro-video-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.retro-video-actions button {
  padding: 4px 10px;
  border: 3px outset #c0c0c0;
  border-radius: 0;
  background: #ffffcc;
  color: #000080;
  font: 700 0.92rem/1.3 "MS PGothic", sans-serif;
  cursor: pointer;
}

.retro-video-actions button:active {
  border-style: inset;
}

.retro-footer {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid #999999;
  color: #666666;
  font-size: 0.82rem;
  text-align: center;
}

@media (min-width: 1440px) {
  .shell {
    width: min(1440px, calc(100% - 80px));
  }

  .character-hero .shell {
    width: min(1320px, calc(100% - 96px));
  }

  .content-layout:not(.guideline-layout) {
    width: min(1560px, calc(100% - 96px));
    grid-template-columns: repeat(12, minmax(0, 1fr));
    grid-auto-flow: dense;
    align-items: start;
    gap: 22px;
  }

  .content-layout:not(.guideline-layout) .wide {
    grid-column: auto;
  }

  .content-layout:not(.guideline-layout) > .source-callout {
    grid-column: 1 / -1;
  }

  .content-layout:not(.guideline-layout) #links,
  .content-layout:not(.guideline-layout) #timeline,
  .content-layout:not(.guideline-layout) #rights {
    grid-column: 1 / -1;
  }

  .content-layout:not(.guideline-layout) #visual {
    grid-column: 1 / -1;
    grid-row: auto;
  }

  .content-layout:not(.guideline-layout) #fanworks {
    grid-column: 1 / span 6;
  }

  .content-layout:not(.guideline-layout) #prompts {
    grid-column: 7 / -1;
  }

  .content-layout:not(.guideline-layout) #prompts.prompts-solo {
    grid-column: 1 / -1;
  }

  .content-layout:not(.guideline-layout) .detail-layout {
    grid-column: 1 / -1;
    grid-template-columns: minmax(640px, 0.62fr) minmax(420px, 0.38fr);
    gap: 22px;
  }

  .content-layout:not(.guideline-layout) .detail-stack {
    grid-template-columns: minmax(0, 1fr);
    gap: 22px;
  }

  .content-layout:not(.guideline-layout) .detail-stack #settings {
    grid-column: 1 / -1;
  }
}

@media print {
  :root {
    color: #111;
    background: #fff;
  }

  body {
    background: #fff;
    color: #111;
  }

  .back-link,
  .brand-banner-shell,
  .guideline-actions,
  .page-menu,
  .source-callout {
    display: none !important;
  }

  .character-hero {
    border: 0;
    padding: 0 0 18px;
    background: #fff;
  }

  .shell,
  .guideline-layout {
    width: 100%;
    max-width: none;
  }

  .content-layout,
  .guideline-layout {
    display: block;
    padding: 0;
  }

  .panel {
    break-inside: avoid;
    box-shadow: none;
    border-color: #d8d8d8;
    margin: 0 0 14px;
  }

  .panel::before {
    background: #d8d8d8;
  }

  .hero-facts span,
  .links a {
    background: #fff;
  }
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

  .brand-banner-shell {
    width: min(100% - 18px, 1120px);
    margin-bottom: 12px;
  }

  .brand-banner {
    aspect-ratio: 3 / 1;
    border-radius: 6px;
  }

  h1 {
    font-size: clamp(2.2rem, 13vw, 3.6rem);
    line-height: 1.06;
  }

  .hero h1 {
    font-size: clamp(2rem, 9vw, 2.8rem);
    line-height: 1.12;
  }

  .guideline-hero h1 {
    font-size: clamp(1.8rem, 8vw, 2.2rem);
    line-height: 1.14;
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
    white-space: normal;
  }

  .page-menu {
    top: 0;
  }

  .page-menu-inner {
    width: 100%;
    padding-left: 10px;
    padding-right: 10px;
    gap: 8px;
  }

  .page-menu-label {
    min-height: 38px;
    padding: 8px 12px;
  }

  .page-menu-scroll {
    flex: 1 1 auto;
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

  .character-card-media {
    margin: -16px -16px 14px;
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

  .source-callout {
    grid-template-columns: 1fr;
    margin-top: 16px;
    padding: 16px;
  }

  .source-links {
    justify-content: stretch;
  }

  .source-links a {
    width: 100%;
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

  .visual-base {
    margin-bottom: 12px;
  }

  .visual-base .visual-card figcaption {
    padding-left: 16px;
    padding-right: 16px;
  }

  .visual-archive {
    border-left: 0;
    border-right: 0;
    border-radius: 0;
  }

  .visual-archive-header {
    padding-left: 16px;
    padding-right: 16px;
  }

  .visual-archive .visual-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    padding: 12px;
  }

  .visual-grid {
    grid-template-columns: 1fr;
  }

  .visual-link {
    width: 100%;
  }

  .visual-link img {
    height: min(68vh, 380px);
    border-left: 0;
    border-right: 0;
    border-radius: 0;
    object-fit: contain;
  }

  .visual-link span {
    right: 10px;
    bottom: 10px;
  }

  .visual-archive .visual-link img {
    height: clamp(140px, 34vw, 190px);
    border: 1px solid var(--line);
    border-radius: 8px;
  }

  .visual-archive .visual-card figcaption {
    padding-left: 0;
    padding-right: 0;
    font-size: 0.78rem;
    line-height: 1.5;
  }

  .image-modal {
    width: 96vw;
    max-height: 92vh;
  }

  .image-modal-frame {
    max-height: 92vh;
  }

  .image-modal-toolbar {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }

  .image-modal-actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .image-modal-actions [data-modal-count] {
    width: 100%;
    text-align: center;
  }

  .image-modal-actions a,
  .image-modal-actions button {
    flex: 1 1 0;
    min-width: 0;
    padding-right: 10px;
    padding-left: 10px;
  }

  .image-modal img {
    max-height: calc(92vh - 174px);
  }

  .image-modal-nav {
    width: 38px;
    height: 54px;
    font-size: 2.1rem;
  }

  .image-modal-prev {
    left: 8px;
  }

  .image-modal-next {
    right: 8px;
  }

  .timeline {
    gap: 12px;
  }

  .timeline li {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .date-range {
    display: inline-flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: baseline;
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

function escapeXml(value) {
  return escapeHtml(value);
}

function formatUrl(link) {
  const value = typeof link === "string" ? link : link.url;
  if (typeof link === "object" && link.displayUrl) {
    return link.displayUrl;
  }

  try {
    const url = new URL(value);
    if (url.hostname === "drive.google.com") {
      return "Google Drive";
    }
    return `${url.hostname}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return value;
  }
}

function renderTimelineDate(date) {
  const value = String(date);
  const separator = value.includes("〜") ? "〜" : value.includes("~") ? "~" : null;
  if (!separator) {
    return `<time>${escapeHtml(value)}</time>`;
  }

  const [start, end] = value.split(separator).map((part) => part.trim());
  if (!start || !end) {
    return `<time>${escapeHtml(value)}</time>`;
  }

  return `
    <time class="date-range" datetime="${escapeHtml(start)}">
      <span>${escapeHtml(start)}</span>
      <span class="date-range-separator">〜</span>
      <span>${escapeHtml(end)}</span>
    </time>
  `;
}

function renderLinkIcon(link) {
  if (link.icon) {
    return `
      <span class="link-icon link-icon-image" aria-label="${escapeHtml(link.label ?? "Link")}">
        <img src="./${escapeHtml(link.icon)}" alt="" loading="lazy">
      </span>
    `;
  }

  const brand = detectLinkBrand(link);
  const label = escapeHtml(brand.label);

  const paths = {
    x: '<path d="M6 5l12 14M18 5L6 19" />',
    youtube: '<rect x="3.5" y="6.5" width="17" height="11" rx="3" /><path d="M10.5 9.8l5 2.7-5 2.7z" fill="currentColor" stroke="none" />',
    instagram: '<rect x="5" y="5" width="14" height="14" rx="4" /><circle cx="12" cy="12" r="3.2" /><circle cx="16.4" cy="7.7" r="0.8" fill="currentColor" stroke="none" />',
    tiktok: '<path d="M13.5 5v9.2a3.4 3.4 0 1 1-3-3.4" /><path d="M13.5 5c.8 2.3 2.3 3.7 4.8 4.1" />',
    discord: '<path d="M7.5 8.5c3-1.5 6-1.5 9 0l1.1 7.2c-3.5 2.2-7.7 2.2-11.2 0z" /><circle cx="10" cy="12.3" r="0.8" fill="currentColor" stroke="none" /><circle cx="14" cy="12.3" r="0.8" fill="currentColor" stroke="none" />',
    googleDrive: '<path d="M8.4 4.5h7.2l5.4 9.4h-7.2z" /><path d="M8.4 4.5 3 13.9l3.6 6.2 5.4-9.4z" /><path d="M6.6 20.1h10.8l3.6-6.2H10.2z" />',
    github: '<path d="M9 19c-4 1.2-4-2-5.5-2.5" /><path d="M15 22v-3.6a3.1 3.1 0 0 0-.9-2.4c3-.3 6.1-1.5 6.1-6.6a5.1 5.1 0 0 0-1.4-3.6 4.7 4.7 0 0 0-.1-3.5s-1.1-.4-3.7 1.4a12.8 12.8 0 0 0-6.8 0C5.6 1.9 4.5 2.3 4.5 2.3a4.7 4.7 0 0 0-.1 3.5A5.1 5.1 0 0 0 3 9.4c0 5.1 3.1 6.3 6.1 6.6a3.1 3.1 0 0 0-.9 2.4V22" />',
    json: '<path d="M8 8c-1.4 0-2 .7-2 2v.8c0 .8-.4 1.2-1.2 1.2.8 0 1.2.4 1.2 1.2v.8c0 1.3.6 2 2 2" /><path d="M16 8c1.4 0 2 .7 2 2v.8c0 .8.4 1.2 1.2 1.2-.8 0-1.2.4-1.2 1.2v.8c0 1.3-.6 2-2 2" /><path d="M10 14l4-4" />',
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
  const raw = `${link.label ?? ""} ${link.url ?? ""} ${link.href ?? ""}`.toLowerCase();

  if (raw.includes("x.com") || raw.includes("twitter.com") || raw.includes("x ")) {
    return { key: "x", label: "X" };
  }
  if (raw.includes(".json") || raw.includes("json")) {
    return { key: "json", label: "JSON" };
  }
  if (raw.includes("github.com") || raw.includes("github")) {
    return { key: "github", label: "GitHub" };
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
  if (raw.includes("drive.google.com") || raw.includes("google drive") || raw.includes("googledrive") || raw.includes("資料集")) {
    return { key: "googleDrive", label: "Google Drive" };
  }

  return { key: "link", label: "External link" };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
