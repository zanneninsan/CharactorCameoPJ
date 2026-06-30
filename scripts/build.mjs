import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.join(rootDir, "content", "characters");
const docsDir = path.join(rootDir, "docs");
const sharedContentDir = path.join(rootDir, "content", "shared");
const staticSitesDir = path.join(rootDir, "content", "static-sites");
const distDir = path.join(rootDir, "dist");
const buildLockDir = path.join(rootDir, ".build-lock");
const siteUrl = normalizeSiteUrl(process.env.SITE_URL ?? process.env.GITHUB_PAGES_URL ?? "https://zanneninsan.github.io/CharactorCameoPJ/");
const sourceRepoUrl = normalizeRepoUrl(process.env.SOURCE_REPO_URL ?? "https://github.com/zanneninsan/CharactorCameoPJ");
const sitemapLastmod = process.env.SITEMAP_LASTMOD ?? new Date().toISOString().slice(0, 10);
const isCheck = process.argv.includes("--check");
const isWatch = process.argv.includes("--watch");
const shouldDownloadDriveVideos =
  !isCheck &&
  (process.argv.includes("--download-drive-videos") ||
    truthyEnv(process.env.DOWNLOAD_DRIVE_VIDEOS) ||
    process.env.GITHUB_ACTIONS === "true");
const sectionLabels = {
  links: { en: "Links", ja: "リンク" },
  visual: { en: "Visual Reference", ja: "ビジュアル資料" },
  videos: { en: "Videos", ja: "動画" },
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
        await generateTimelinePlaceholderAsset(characterDir);
        if (character.id === "zannenin") {
          await generateManzokukyoAssets(characterDir);
        }
        await generateVisualReferenceAssets(character, characterDir);
        if (shouldDownloadDriveVideos) {
          await downloadRandomVideoAssets(character, characterDir);
        }
        await generateOpenGraphImage(character, characterDir);
        await writeFile(path.join(characterDir, "index.html"), renderCharacter(character), "utf8");
        if (character.fanworkGuidelines) {
          await writeFile(path.join(characterDir, "fanworks.html"), renderFanworkGuidelines(character), "utf8");
        }
        if (character.id === "zannenin") {
          const manzokukyoDir = path.join(characterDir, "manzokukyo");
          await mkdir(manzokukyoDir, { recursive: true });
          await writeFile(path.join(manzokukyoDir, "index.html"), renderManzokukyoTeaser(character), "utf8");
          await copyStaticSite(character, characterDir, "desktopchillko");
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

      await copyPublishedDocs();
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

function truthyEnv(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
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

async function copyStaticSite(character, characterDir, slug) {
  const sourceDir = path.join(staticSitesDir, character.id, slug);

  try {
    const sourceStat = await stat(sourceDir);
    if (!sourceStat.isDirectory()) return;
  } catch {
    return;
  }

  await cp(sourceDir, path.join(characterDir, slug), { recursive: true });
}

async function copyPublishedDocs() {
  const publishedDocs = [
    "codex-beginner-manual.html",
    "codex-beginner-manual.pdf",
    "codex-beginner-mode-prompt.txt"
  ];
  const outputDir = path.join(distDir, "docs");
  await mkdir(outputDir, { recursive: true });

  for (const filename of publishedDocs) {
    await cp(path.join(docsDir, filename), path.join(outputDir, filename));
  }
}

async function generateTimelinePlaceholderAsset(characterDir) {
  const sourcePath = path.join(sharedContentDir, "timeline-noimage-zannenin.png");
  const outputDir = path.join(characterDir, "assets", "generated");

  try {
    await stat(sourcePath);
  } catch {
    return;
  }

  await mkdir(outputDir, { recursive: true });
  await sharp(sourcePath)
    .resize({ width: 720, height: 720, fit: "cover" })
    .webp({ quality: 86 })
    .toFile(path.join(outputDir, "timeline-noimage.webp"));
}

async function generateManzokukyoAssets(characterDir) {
  const sourcePath = path.join(contentDir, "zannenin", "assets", "manzokukyo", "key-visual.png");
  const altarPath = path.join(contentDir, "zannenin", "assets", "manzokukyo", "altar-cutout.png");
  const propAssets = [
    ["prop-coffin.png", "prop-coffin.webp", 760],
    ["prop-mirror.png", "prop-mirror.webp", 760],
    ["prop-door.png", "prop-door.webp", 980],
    ["prop-painting.png", "prop-painting.webp", 780],
  ];
  const textureAssets = [
    ["corridor-wall.png", "corridor-wall.webp"],
    ["corridor-floor.png", "corridor-floor.webp"],
  ];
  const outputDir = path.join(characterDir, "assets", "generated", "manzokukyo");

  try {
    await stat(sourcePath);
  } catch {
    return;
  }

  await mkdir(outputDir, { recursive: true });
  await sharp(sourcePath)
    .resize({ width: 1480, withoutEnlargement: true })
    .avif({ quality: 50, effort: 6 })
    .toFile(path.join(outputDir, "key-visual-hero.avif"));
  await sharp(sourcePath)
    .resize({ width: 1480, withoutEnlargement: true })
    .webp({ quality: 74 })
    .toFile(path.join(outputDir, "key-visual-hero.webp"));
  await sharp(sourcePath)
    .resize({ width: 960, withoutEnlargement: true })
    .blur(10)
    .modulate({ brightness: 0.42, saturation: 0.85 })
    .webp({ quality: 46 })
    .toFile(path.join(outputDir, "key-visual-bg.webp"));

  if (await fileExists(altarPath)) {
    await sharp(altarPath)
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 78, alphaQuality: 90 })
      .toFile(path.join(outputDir, "altar.webp"));
  }

  for (const [inputName, outputName, width] of propAssets) {
    const propPath = path.join(contentDir, "zannenin", "assets", "manzokukyo", inputName);
    if (await fileExists(propPath)) {
      await sharp(propPath)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 78, alphaQuality: 92 })
        .toFile(path.join(outputDir, outputName));
    }
  }

  for (const [inputName, outputName] of textureAssets) {
    const texturePath = path.join(contentDir, "zannenin", "assets", "manzokukyo", inputName);
    if (await fileExists(texturePath)) {
      await sharp(texturePath)
        .resize({ width: 1024, height: 1024, fit: "cover", withoutEnlargement: true })
        .modulate({ brightness: 0.9, saturation: 0.88 })
        .webp({ quality: 58 })
        .toFile(path.join(outputDir, outputName));
    }
  }
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
    const includeLogoOverlay = banner.includeLogoOverlay !== false;

    const composites = [];
    if (bannerLogoBuffer && includeLogoOverlay) {
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

async function downloadRandomVideoAssets(character, characterDir) {
  const videos = randomDriveVideoSourceItems(character.randomVideoPlayer);
  if (videos.length === 0) {
    return;
  }

  const outputDir = path.join(characterDir, "assets", "generated", "videos");
  await mkdir(outputDir, { recursive: true });

  for (const [index, video] of videos.entries()) {
    if (!video.driveId) {
      continue;
    }

    const baseName = slugifyVideoFileName(video.displayLabel ?? video.label ?? `video-${index + 1}`);
    const fileName = `${baseName}-${hashText(video.driveId)}.mp4`;
    const relativePath = path.posix.join("assets", "generated", "videos", fileName);
    const outputPath = path.join(outputDir, fileName);
    const buffer = await downloadDriveVideoFile(video.driveId);

    await writeFile(outputPath, buffer);
    video.playbackPath = relativePath;
  }
}

async function downloadDriveVideoFile(fileId) {
  const response = await fetch(`https://drive.usercontent.google.com/download?id=${fileId}&export=download`);
  if (!response.ok) {
    throw new Error(`Failed to download Google Drive video ${fileId}: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("video/")) {
    throw new Error(`Google Drive video ${fileId} returned ${contentType || "unknown content type"}.`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function slugifyVideoFileName(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "video";
}

function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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
            { label: "キャラクター設定を見る", href: sourceFileUrl("content/characters") },
            { label: "Codex初心者向けマニュアル", href: "./docs/codex-beginner-manual.html" }
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
  const hasRandomVideos = randomDriveVideoSets(character.randomVideoPlayer).length > 0;
  const hasMusicVideos = Boolean(character.musicVideoPlayer);

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
        ${renderDesignSwitcher()}
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
          ${renderMusicVideoPlayer(character.musicVideoPlayer)}
          ${renderOfficialRandomDriveVideoPlayer(character.randomVideoPlayer)}
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
            </div>
          </div>
          <section class="panel wide detail-settings" id="settings">
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
          <section class="panel wide" id="timeline">
            ${renderSectionHeading("timeline")}
            ${renderTimelineGroups(character)}
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
        ${hasRandomVideos || hasMusicVideos ? renderRandomDriveVideoScript() : ""}
      </main>
    `
  });
}

function renderManzokukyoTeaser(character) {
  const title = "満足教";
  const description = "残念院さんが開く、まだ全貌の見えない満足教のティザーサイトです。";

  return htmlPage({
    title: `${title} Teaser`,
    description,
    urlPath: `${character.id}/manzokukyo/`,
    imagePath: `${character.id}/assets/generated/ogp.png`,
    type: "website",
    theme: character.theme,
    stylesheetHref: "../../styles.css",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${title} Teaser`,
      description,
      url: absoluteUrl(`${character.id}/manzokukyo/`),
      inLanguage: "ja",
      isPartOf: {
        "@type": "WebSite",
        name: "Character Canon",
        url: absoluteUrl("")
      },
      about: {
        "@type": "Thing",
        name: title,
        description
      }
    },
    body: `
      <style>
        :root {
          --cult-black: #08070b;
          --cult-ink: #f5ead2;
          --cult-gold: #d7b451;
          --cult-red: #ff335c;
          --cult-cyan: #58f6ff;
          --cult-violet: #7e3cff;
          --cult-sick: #9fff6e;
        }

        html,
        body {
          height: 100%;
          overflow: hidden;
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        html::-webkit-scrollbar,
        body::-webkit-scrollbar {
          width: 0;
          height: 0;
          display: none;
        }

        body {
          margin: 0;
          overflow-x: hidden;
          color: var(--cult-ink);
          background: var(--cult-black);
        }

        .mk-page {
          --mk-depth: 0;
          --mk-copy-opacity: 1;
          --mk-copy-y: 0px;
          --mk-copy-z: 180px;
          --mk-altar-y: 0px;
          --mk-altar-z: 80px;
          --mk-altar-scale: 1;
          --mk-portrait-y: 0px;
          --mk-portrait-z: -220px;
          --mk-portrait-scale: 0.82;
          --mk-portrait-opacity: 0.64;
          --mk-corridor-opacity: 0;
          --mk-hero-exit: 0;
          --mk-banner-opacity: 1;
          --mk-tunnel-opacity: 0;
          --mk-tunnel-scale: 1.16;
          --mk-road-shift: 0px;
          --mk-wall-shift: 0px;
          --mk-horizon-shift: 0px;
          --mk-footer-opacity: 0;
          height: 100svh;
          min-height: 100svh;
          max-width: 100vw;
          overflow: hidden;
          background:
            radial-gradient(circle at 18% 18%, rgba(255, 51, 92, 0.18), transparent 26%),
            radial-gradient(circle at 84% 12%, rgba(215, 180, 81, 0.16), transparent 28%),
            radial-gradient(circle at 52% 74%, rgba(126, 60, 255, 0.16), transparent 34%),
            linear-gradient(180deg, #08070b 0%, #151019 46%, #08070b 100%);
          font-family: var(--font-sans);
          isolation: isolate;
          perspective: 1200px;
          perspective-origin: 50% 38%;
          touch-action: none;
          user-select: none;
        }

        .mk-page,
        .mk-page * {
          box-sizing: border-box;
        }

        .mk-page::before {
          content: "";
          position: fixed;
          inset: 0;
          z-index: -2;
          opacity: 0.2;
          background:
            repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.06) 0 1px, transparent 1px 64px),
            repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.04) 0 1px, transparent 1px 64px);
          mask-image: radial-gradient(circle at center, #000 0%, transparent 74%);
        }

        .mk-page::after {
          content: "";
          position: fixed;
          inset: 0;
          z-index: -1;
          pointer-events: none;
          background:
            linear-gradient(rgba(255, 255, 255, 0.035) 50%, transparent 50%),
            radial-gradient(circle at center, transparent 0 52%, rgba(0, 0, 0, 0.5) 100%);
          background-size: 100% 4px, auto;
          mix-blend-mode: screen;
        }

        .mk-abyss-canvas {
          position: fixed;
          inset: 0;
          z-index: -1;
          width: 100%;
          height: 100%;
          opacity: 0.46;
          pointer-events: none;
          mix-blend-mode: screen;
        }

        .mk-hero {
          position: fixed;
          inset: 0;
          top: 0;
          display: grid;
          min-height: 100svh;
          height: 100svh;
          align-items: center;
          padding: clamp(22px, 3vw, 46px);
          overflow: hidden;
          transform-style: preserve-3d;
        }

        .mk-hero::before {
          content: "";
          position: absolute;
          inset: -8%;
          z-index: 1;
          pointer-events: none;
          background:
            conic-gradient(from 90deg at 50% 50%, transparent 0 9deg, rgba(215, 180, 81, 0.12) 10deg 11deg, transparent 12deg 36deg),
            radial-gradient(circle at 50% 48%, transparent 0 44%, rgba(0, 0, 0, 0.24) 70%, rgba(0, 0, 0, 0.54) 100%);
          opacity: 0.38;
          animation: mk-pulse 5.8s ease-in-out infinite;
        }

        .mk-perspective-corridor {
          --corridor-back-left: 37%;
          --corridor-back-right: 63%;
          --corridor-back-top: 34%;
          --corridor-back-bottom: 66%;
          position: absolute;
          inset: 0;
          z-index: 3;
          pointer-events: none;
          overflow: hidden;
          opacity: var(--mk-corridor-opacity);
          transition: opacity 0.16s linear;
        }

        .mk-loop-tunnel {
          position: absolute;
          inset: 0;
          z-index: 0;
          overflow: hidden;
          background:
            radial-gradient(ellipse at 50% 50%, rgba(126, 60, 255, 0.18), transparent 35%),
            linear-gradient(180deg, #161323 0%, #111018 45%, #17111b 100%);
        }

        .mk-loop-tunnel::before,
        .mk-loop-tunnel::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 5;
          pointer-events: none;
        }

        .mk-loop-tunnel::before {
          background:
            radial-gradient(ellipse at 50% 50%, transparent 0 44%, rgba(0, 0, 0, 0.18) 72%, rgba(0, 0, 0, 0.42) 100%),
            linear-gradient(90deg, rgba(0, 0, 0, 0.18), transparent 20% 80%, rgba(0, 0, 0, 0.18));
          mix-blend-mode: multiply;
        }

        .mk-loop-tunnel::after {
          background:
            repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.035) 0 1px, transparent 1px 5px),
            radial-gradient(ellipse at 50% 50%, transparent 0 18%, rgba(245, 234, 210, 0.08) 18.2% 18.45%, transparent 18.7% 24%);
          opacity: 0.38;
          mix-blend-mode: screen;
        }

        .mk-loop-surface {
          position: absolute;
          inset: 0;
          background-repeat: repeat;
          background-blend-mode: screen, normal;
          pointer-events: none;
          will-change: background-position, transform, opacity;
        }

        .mk-loop-floor {
          z-index: 2;
          clip-path: polygon(0 100%, 100% 100%, var(--corridor-back-right) var(--corridor-back-bottom), var(--corridor-back-left) var(--corridor-back-bottom));
          background-image:
            linear-gradient(0deg, rgba(245, 234, 210, 0.1), rgba(0, 0, 0, 0.06) 34%, rgba(0, 0, 0, 0.34) 100%),
            url("../assets/generated/manzokukyo/corridor-floor.webp");
          background-size: auto, 44vw 44vw;
          background-position:
            center,
            center var(--mk-road-shift);
          opacity: 1;
          filter: brightness(1.46) contrast(1.02) saturate(0.95);
        }

        .mk-loop-road-core {
          position: absolute;
          inset: 0;
          z-index: 5;
          clip-path: polygon(29% 100%, 71% 100%, 55% var(--corridor-back-bottom), 45% var(--corridor-back-bottom));
          background:
            linear-gradient(0deg, rgba(215, 180, 81, 0.2), rgba(126, 60, 255, 0.08) 36%, rgba(0, 0, 0, 0.22) 100%),
            repeating-linear-gradient(0deg, rgba(245, 234, 210, 0.22) 0 1px, transparent 1px 9.5vh),
            repeating-linear-gradient(90deg, transparent 0 18%, rgba(215, 180, 81, 0.28) 18.2% 18.45%, transparent 18.7% 81.3%, rgba(215, 180, 81, 0.28) 81.55% 81.8%, transparent 82%);
          opacity: 0.72;
          filter:
            drop-shadow(0 0 30px rgba(126, 60, 255, 0.24))
            drop-shadow(0 0 18px rgba(215, 180, 81, 0.12));
          box-shadow:
            inset 0 0 38px rgba(0, 0, 0, 0.3);
          will-change: background-position, transform;
        }

        .mk-loop-road-core::before,
        .mk-loop-road-core::after {
          content: "";
          position: absolute;
          top: var(--corridor-back-bottom);
          bottom: 0;
          width: 1px;
          background: linear-gradient(180deg, rgba(215, 180, 81, 0.38), rgba(245, 234, 210, 0.14));
          box-shadow: 0 0 18px rgba(215, 180, 81, 0.28);
        }

        .mk-loop-road-core::before {
          left: 38.5%;
          transform: skewX(-18deg);
        }

        .mk-loop-road-core::after {
          right: 38.5%;
          transform: skewX(18deg);
        }

        .mk-loop-ceiling {
          z-index: 1;
          clip-path: polygon(0 0, 100% 0, var(--corridor-back-right) var(--corridor-back-top), var(--corridor-back-left) var(--corridor-back-top));
          background-image:
            linear-gradient(180deg, rgba(0, 0, 0, 0.1), rgba(126, 60, 255, 0.06) 48%, rgba(0, 0, 0, 0.22) 100%),
            url("../assets/generated/manzokukyo/corridor-wall.webp");
          background-size: auto, 42vw 42vw;
          background-position:
            center,
            center calc(var(--mk-wall-shift) * -0.52);
          opacity: 0.92;
          filter: brightness(1.22) contrast(1.04) saturate(0.92);
        }

        .mk-loop-wall-left,
        .mk-loop-wall-right {
          z-index: 3;
          background-image:
            linear-gradient(90deg, rgba(0, 0, 0, 0.28), rgba(245, 234, 210, 0.08) 50%, rgba(0, 0, 0, 0.2)),
            url("../assets/generated/manzokukyo/corridor-wall.webp");
          background-size: auto, 42vw 42vw;
          background-position:
            center,
            calc(var(--mk-wall-shift) * 0.7) center;
          opacity: 0.96;
          filter: brightness(1.2) contrast(1.06) saturate(0.92);
        }

        .mk-loop-wall-left {
          clip-path: polygon(0 0, var(--corridor-back-left) var(--corridor-back-top), var(--corridor-back-left) var(--corridor-back-bottom), 0 100%);
        }

        .mk-loop-wall-right {
          clip-path: polygon(100% 0, var(--corridor-back-right) var(--corridor-back-top), var(--corridor-back-right) var(--corridor-back-bottom), 100% 100%);
          transform: scaleX(-1);
        }

        .mk-loop-horizon {
          position: absolute;
          top: var(--corridor-back-top);
          right: calc(100% - var(--corridor-back-right));
          bottom: calc(100% - var(--corridor-back-bottom));
          left: var(--corridor-back-left);
          z-index: 4;
          border: 1px solid rgba(215, 180, 81, 0.5);
          background:
            radial-gradient(ellipse at center, rgba(245, 234, 210, 0.18), rgba(126, 60, 255, 0.08) 38%, rgba(8, 7, 11, 0.82) 100%),
            url("../assets/generated/manzokukyo/corridor-wall.webp") center calc(var(--mk-horizon-shift) * -0.48) / 115% repeat;
          box-shadow:
            0 0 72px rgba(126, 60, 255, 0.26),
            inset 0 0 42px rgba(0, 0, 0, 0.78);
          opacity: 0.94;
        }

        .mk-tunnel-edges {
          position: absolute;
          inset: 0;
          z-index: 12;
          width: 100%;
          height: 100%;
          opacity: 0.72;
          overflow: visible;
          filter:
            drop-shadow(0 0 10px rgba(215, 180, 81, 0.22))
            drop-shadow(0 0 18px rgba(126, 60, 255, 0.14));
        }

        .mk-tunnel-edges path,
        .mk-tunnel-edges rect {
          fill: none;
          stroke: rgba(215, 180, 81, 0.5);
          stroke-width: 0.12;
          vector-effect: non-scaling-stroke;
        }

        .mk-tunnel-edges .mk-edge-secondary {
          stroke: rgba(245, 234, 210, 0.2);
          stroke-width: 0.08;
        }

        .mk-perspective-corridor::before,
        .mk-perspective-corridor::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .mk-perspective-corridor::before {
          background:
            linear-gradient(90deg, rgba(215, 180, 81, 0.36) 0 1px, transparent 1px),
            linear-gradient(0deg, rgba(215, 180, 81, 0.26) 0 1px, transparent 1px),
            repeating-radial-gradient(ellipse at 50% 50%, transparent 0 4.6%, rgba(215, 180, 81, 0.2) 4.8% 5%, transparent 5.25% 6.6%),
            radial-gradient(ellipse at 50% 50%, transparent 0 15%, rgba(8, 7, 11, 0.2) 24%, rgba(8, 7, 11, 0.82) 76%, rgba(0, 0, 0, 0.92) 100%);
          background-size: 15.6vw 100%, 100% 13.8vh, auto, auto;
          mask-image: radial-gradient(ellipse at 50% 50%, #000 0 72%, transparent 86%);
          opacity: 0.06;
          transform: translateZ(-260px) scale(calc(1.02 + var(--mk-depth) * 0.32));
        }

        .mk-perspective-corridor::after {
          background:
            radial-gradient(ellipse at 50% 50%, transparent 0 13%, rgba(255, 255, 255, 0.08) 13.15% 13.35%, transparent 13.5%),
            radial-gradient(ellipse at 50% 50%, rgba(245, 234, 210, 0.08), transparent 18%),
            radial-gradient(ellipse at 50% 50%, transparent 0 42%, rgba(0, 0, 0, 0.58) 75%, rgba(0, 0, 0, 0.96) 100%);
          opacity: 0.12;
          transform: translateZ(90px) scale(calc(1.01 + var(--mk-depth) * 0.12));
          mix-blend-mode: screen;
        }

        .mk-corridor-plane {
          position: absolute;
          inset: 0;
          display: none;
          background:
            repeating-linear-gradient(var(--plane-angle), rgba(215, 180, 81, 0.26) 0 1px, transparent 1px 7.5%),
            repeating-linear-gradient(calc(var(--plane-angle) + 90deg), rgba(88, 246, 255, 0.1) 0 1px, transparent 1px 12%),
            linear-gradient(var(--plane-shade), rgba(215, 180, 81, 0.18), rgba(126, 60, 255, 0.04) 42%, rgba(0, 0, 0, 0.64));
          clip-path: var(--plane-clip);
          opacity: 0.36;
          transform: translateZ(var(--plane-z)) rotateX(var(--plane-rx)) rotateY(var(--plane-ry)) scale(var(--plane-scale));
          transform-origin: 50% 50%;
          mix-blend-mode: screen;
        }

        .mk-corridor-plane-top {
          --plane-angle: 0deg;
          --plane-shade: 180deg;
          --plane-clip: polygon(0 0, 100% 0, 62% 36%, 38% 36%);
          --plane-z: -120px;
          --plane-rx: 18deg;
          --plane-ry: 0deg;
          --plane-scale: 1.04;
        }

        .mk-corridor-plane-bottom {
          --plane-angle: 0deg;
          --plane-shade: 0deg;
          --plane-clip: polygon(0 100%, 100% 100%, 62% 64%, 38% 64%);
          --plane-z: -80px;
          --plane-rx: -18deg;
          --plane-ry: 0deg;
          --plane-scale: 1.06;
        }

        .mk-corridor-plane-left {
          --plane-angle: 90deg;
          --plane-shade: 90deg;
          --plane-clip: polygon(0 0, 38% 36%, 38% 64%, 0 100%);
          --plane-z: 10px;
          --plane-rx: 0deg;
          --plane-ry: -16deg;
          --plane-scale: 1.08;
        }

        .mk-corridor-plane-right {
          --plane-angle: 90deg;
          --plane-shade: 270deg;
          --plane-clip: polygon(100% 0, 62% 36%, 62% 64%, 100% 100%);
          --plane-z: 10px;
          --plane-rx: 0deg;
          --plane-ry: 16deg;
          --plane-scale: 1.08;
        }

        .mk-corridor-vortex {
          position: absolute;
          display: none;
          top: 50%;
          left: 50%;
          width: min(28vw, 460px);
          aspect-ratio: 1.8 / 1;
          border: 1px solid rgba(215, 180, 81, 0.36);
          transform:
            translate(-50%, -50%)
            translateZ(calc(-360px + var(--mk-depth) * -180px))
            scale(calc(0.76 + var(--mk-depth) * 0.2));
          background:
            radial-gradient(ellipse at center, rgba(245, 234, 210, 0.12), transparent 48%),
            linear-gradient(90deg, rgba(8, 7, 11, 0.86), rgba(8, 7, 11, 0.42), rgba(8, 7, 11, 0.86));
          box-shadow:
            0 0 50px rgba(215, 180, 81, 0.14),
            inset 0 0 60px rgba(0, 0, 0, 0.86);
          opacity: 0.88;
        }

        .mk-corridor-frame {
          --frame-z: -1400px;
          --frame-scale: 0.1;
          --frame-opacity: 0;
          position: absolute;
          top: 50%;
          left: 50%;
          width: min(76vw, 1360px);
          aspect-ratio: 1.95 / 1;
          border: 1px solid rgba(215, 180, 81, 0.46);
          opacity: var(--frame-opacity);
          transform:
            translate(-50%, -50%)
            translateZ(var(--frame-z))
            scale(var(--frame-scale));
          transform-origin: 50% 50%;
          box-shadow:
            0 0 22px rgba(215, 180, 81, 0.12),
            inset 0 0 38px rgba(126, 60, 255, 0.1);
          will-change: transform, opacity;
        }

        .mk-corridor-frame::before,
        .mk-corridor-frame::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: 0.72;
        }

        .mk-corridor-frame::before {
          background:
            linear-gradient(90deg, transparent 0 19%, rgba(215, 180, 81, 0.52) 19.1% 19.25%, transparent 19.35% 80.65%, rgba(215, 180, 81, 0.52) 80.75% 80.9%, transparent 81%),
            linear-gradient(0deg, transparent 0 21%, rgba(215, 180, 81, 0.38) 21.1% 21.25%, transparent 21.35% 78.65%, rgba(215, 180, 81, 0.38) 78.75% 78.9%, transparent 79%);
        }

        .mk-corridor-frame::after {
          background:
            repeating-linear-gradient(90deg, transparent 0 9.6%, rgba(88, 246, 255, 0.16) 9.7% 9.82%, transparent 9.92% 19.2%),
            repeating-linear-gradient(0deg, transparent 0 11.8%, rgba(215, 180, 81, 0.18) 11.9% 12.02%, transparent 12.12% 23.6%);
          mask-image: radial-gradient(ellipse at center, #000 0 70%, transparent 88%);
        }

        .mk-banner {
          position: absolute;
          inset: 0;
          z-index: -1;
          background:
            linear-gradient(90deg, rgba(8, 7, 11, 0.94) 0%, rgba(8, 7, 11, 0.74) 38%, rgba(8, 7, 11, 0.9) 100%),
            url("../assets/generated/manzokukyo/key-visual-bg.webp") center / cover no-repeat;
          transform: translateZ(-520px) scale(1.44);
          transform-origin: 50% 42%;
          opacity: var(--mk-banner-opacity);
        }

        .mk-banner::after {
          content: "";
          position: absolute;
          inset: 0;
          background:
            linear-gradient(90deg, rgba(8, 7, 11, 0.36) 0%, rgba(8, 7, 11, 0.18) 48%, rgba(8, 7, 11, 0.82) 100%),
            linear-gradient(180deg, rgba(8, 7, 11, 0.08) 0%, rgba(8, 7, 11, 0.54) 68%, #08070b 100%);
        }

        .mk-corridor-props {
          position: absolute;
          inset: 0;
          z-index: 4;
          overflow: hidden;
          pointer-events: none;
          perspective: 1200px;
          transform-style: preserve-3d;
        }

        .mk-depth-prop {
          --prop-x: 0px;
          --prop-z: -900px;
          --prop-scale: 0.12;
          --prop-opacity: 0;
          --prop-blur: 8px;
          --prop-ry: 0deg;
          --prop-rz: 0deg;
          position: absolute;
          top: 50%;
          left: 50%;
          display: block;
          width: var(--prop-width);
          max-width: none;
          height: auto;
          opacity: var(--prop-opacity);
          transform:
            translate(-50%, -50%)
            translate3d(var(--prop-x), 0, var(--prop-z))
            rotateY(var(--prop-ry))
            rotateZ(var(--prop-rz))
            scale(var(--prop-scale));
          transform-origin: 50% 50%;
          filter:
            blur(var(--prop-blur))
            brightness(0.86)
            contrast(1.16)
            saturate(0.92)
            drop-shadow(0 0 42px rgba(126, 60, 255, 0.28))
            drop-shadow(0 42px 88px rgba(0, 0, 0, 0.72));
          will-change: transform, opacity, filter;
        }

        .mk-depth-prop[data-mk-prop^="door"] {
          z-index: 1;
        }

        .mk-depth-prop[data-mk-prop^="mirror"],
        .mk-depth-prop[data-mk-prop^="painting"] {
          z-index: 2;
        }

        .mk-depth-prop[data-mk-prop^="coffin"] {
          z-index: 3;
        }

        .mk-key-visual {
          position: absolute;
          top: auto;
          right: clamp(210px, 17vw, 340px);
          bottom: clamp(270px, 38vh, 360px);
          z-index: 3;
          width: min(24vw, 390px);
          min-width: 280px;
          height: min(36vh, 360px);
          transform: translate3d(0, var(--mk-portrait-y), var(--mk-portrait-z)) scale(var(--mk-portrait-scale));
          translate: 0 0;
          transform-origin: 50% 72%;
          border: 1px solid rgba(215, 180, 81, 0.4);
          border-radius: 18px;
          overflow: hidden;
          background: #08070b;
          opacity: var(--mk-portrait-opacity);
          box-shadow:
            0 0 0 1px rgba(255, 255, 255, 0.08),
            0 26px 86px rgba(0, 0, 0, 0.72),
            0 0 54px rgba(215, 180, 81, 0.14);
          isolation: isolate;
          animation: mk-portrait-breathe 9s ease-in-out infinite;
        }

        .mk-key-visual::before,
        .mk-key-visual::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 1;
          pointer-events: none;
        }

        .mk-key-visual::before {
          background:
            linear-gradient(90deg, transparent 0 47%, rgba(255, 51, 92, 0.16) 48%, transparent 50%),
            radial-gradient(circle at 52% 42%, transparent 0 31%, rgba(0, 0, 0, 0.18) 46%, rgba(0, 0, 0, 0.68) 100%),
            linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 42%);
          opacity: 0.92;
          mix-blend-mode: multiply;
          animation: mk-portrait-vignette 7s ease-in-out infinite;
        }

        .mk-key-visual::after {
          border: 1px solid rgba(215, 180, 81, 0.28);
          background:
            repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.08) 0 1px, transparent 1px 5px),
            repeating-linear-gradient(90deg, transparent 0 21px, rgba(215, 180, 81, 0.08) 22px 23px, transparent 24px 64px);
          opacity: 0.3;
          box-shadow: inset 0 0 70px rgba(0, 0, 0, 0.72);
          mix-blend-mode: overlay;
          animation: mk-portrait-scan 2.8s steps(6, end) infinite;
        }

        .mk-key-visual img {
          position: relative;
          z-index: 0;
          display: block;
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center top;
          filter: saturate(0.82) contrast(1.12) brightness(0.64) hue-rotate(-4deg);
          transform: scale(1.01);
          animation: mk-portrait-decay 12s ease-in-out infinite;
        }

        .mk-key-visual-glitch,
        .mk-key-visual-noise {
          position: absolute;
          inset: 0;
          z-index: 2;
          pointer-events: none;
        }

        .mk-key-visual-glitch {
          background: url("../assets/generated/manzokukyo/key-visual-hero.webp") center top / cover no-repeat;
          opacity: 0;
          mix-blend-mode: screen;
          filter: contrast(1.4) saturate(1.5) hue-rotate(150deg);
          clip-path: inset(42% 0 38% 0);
          animation: mk-portrait-glitch 6.4s steps(1, end) infinite;
        }

        .mk-key-visual-noise {
          z-index: 3;
          width: 100%;
          height: 100%;
          opacity: 0.28;
          mix-blend-mode: overlay;
        }

        .mk-black-mass {
          position: absolute;
          right: clamp(42px, 5.8vw, 108px);
          bottom: 0;
          z-index: 4;
          width: min(48vw, 820px);
          min-width: 560px;
          aspect-ratio: 1672 / 941;
          opacity: calc(0.74 - var(--mk-hero-exit) * 0.62);
          pointer-events: none;
          perspective: 900px;
          transform: translate3d(0, var(--mk-altar-y), var(--mk-altar-z)) scale(var(--mk-altar-scale));
          transform-origin: 50% 100%;
        }

        .mk-altar-prop {
          position: absolute;
          inset: 0;
          z-index: 1;
          display: block;
          width: 100%;
          height: 100%;
          object-fit: contain;
          filter:
            drop-shadow(0 34px 54px rgba(0, 0, 0, 0.72))
            drop-shadow(0 0 22px rgba(127, 51, 255, 0.18))
            saturate(0.92)
            contrast(1.08);
        }

        .mk-altar-table {
          position: absolute;
          right: 6%;
          bottom: 0;
          left: 6%;
          z-index: 0;
          height: 26%;
          transform: rotateX(64deg);
          transform-origin: center bottom;
          border: 1px solid rgba(215, 180, 81, 0.46);
          border-radius: 10px 10px 28px 28px;
          background:
            linear-gradient(90deg, rgba(215, 180, 81, 0.42), transparent 8% 92%, rgba(215, 180, 81, 0.42)),
            repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.06) 0 1px, transparent 1px 46px),
            linear-gradient(180deg, rgba(25, 18, 32, 0.92), rgba(5, 4, 8, 0.96));
          box-shadow:
            0 -20px 90px rgba(124, 43, 255, 0.16),
            0 28px 80px rgba(0, 0, 0, 0.82),
            inset 0 0 44px rgba(0, 0, 0, 0.72);
        }

        .mk-altar-table::before {
          content: "";
          position: absolute;
          top: 12px;
          left: 50%;
          width: 32%;
          height: 42%;
          transform: translateX(-50%);
          border: 1px solid rgba(215, 180, 81, 0.4);
          background:
            linear-gradient(45deg, transparent 48%, rgba(215, 180, 81, 0.46) 49% 51%, transparent 52%),
            linear-gradient(-45deg, transparent 48%, rgba(215, 180, 81, 0.34) 49% 51%, transparent 52%);
          opacity: 0.68;
        }

        .mk-candles {
          position: absolute;
          inset: 0;
          z-index: 2;
        }

        .mk-flame-canvas {
          position: absolute;
          top: -24%;
          right: 0;
          bottom: 0;
          left: 0;
          width: 100%;
          opacity: 1;
          mix-blend-mode: normal;
          filter: saturate(0.86) contrast(1.18);
          transition: opacity 0.36s ease;
        }

        .mk-ritual-dim {
          position: fixed;
          inset: 0;
          z-index: 45;
          pointer-events: none;
          background:
            radial-gradient(ellipse at 52% 42%, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0.72) 68%, #000 100%),
            rgba(0, 0, 0, 0.72);
          opacity: var(--mk-ritual-dim, 0);
          transition: opacity 0.12s linear;
        }

        .mk-wake-overlay {
          position: fixed;
          inset: 0;
          z-index: 60;
          pointer-events: none;
          background:
            radial-gradient(ellipse at center, transparent 0 18%, rgba(0, 0, 0, 0.92) 48%, #000 72%),
            linear-gradient(180deg, #000, #000);
          opacity: 0;
          mix-blend-mode: normal;
          animation: mk-blackout-cycle 18s linear 2;
          animation-play-state: var(--ritual-play-state, running);
        }

        .mk-wake-overlay::before,
        .mk-wake-overlay::after {
          content: "";
          position: absolute;
          inset: 0;
          opacity: 0;
          pointer-events: none;
        }

        .mk-wake-overlay::before {
          background:
            radial-gradient(ellipse at 50% 48%, rgba(255, 255, 255, 0.92) 0 4%, transparent 5.5%),
            radial-gradient(ellipse at 50% 50%, transparent 0 16%, rgba(255, 255, 255, 0.18) 20%, transparent 36%),
            repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.16) 0 1px, transparent 1px 4px);
          filter: blur(1px) contrast(1.65);
          mix-blend-mode: screen;
          animation: mk-eye-open-cycle 18s linear 2;
          animation-play-state: var(--ritual-play-state, running);
        }

        .mk-wake-overlay::after {
          background:
            linear-gradient(90deg, rgba(255, 51, 92, 0.28), transparent 16% 84%, rgba(88, 246, 255, 0.24)),
            radial-gradient(ellipse at center, transparent 0 36%, rgba(0, 0, 0, 0.82) 76%);
          transform: scaleX(1.08);
          animation: mk-wake-chroma 18s linear 2;
          animation-play-state: var(--ritual-play-state, running);
          mix-blend-mode: screen;
        }

        .mk-page[data-ritual-state="ended"],
        .mk-page[data-ritual-state="resetting"] {
          --ritual-play-state: paused;
        }

        .mk-page[data-ritual-state="resetting"] .mk-flame-canvas,
        .mk-page[data-ritual-state="resetting"] .mk-ritual-dim,
        .mk-page[data-ritual-state="resetting"] .mk-wake-overlay,
        .mk-page[data-ritual-state="resetting"] .mk-wake-overlay::before,
        .mk-page[data-ritual-state="resetting"] .mk-wake-overlay::after,
        .mk-page[data-ritual-state="ended"] .mk-flame-canvas,
        .mk-page[data-ritual-state="ended"] .mk-ritual-dim,
        .mk-page[data-ritual-state="ended"] .mk-wake-overlay,
        .mk-page[data-ritual-state="ended"] .mk-wake-overlay::before,
        .mk-page[data-ritual-state="ended"] .mk-wake-overlay::after {
          animation: none;
          opacity: 0;
        }

        .mk-ritual-replay {
          position: fixed;
          right: clamp(22px, 4vw, 72px);
          bottom: clamp(22px, 4vw, 58px);
          z-index: 80;
          display: inline-flex;
          min-height: 52px;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(215, 180, 81, 0.72);
          border-radius: 999px;
          padding: 12px 20px;
          background:
            radial-gradient(circle at 30% 20%, rgba(154, 75, 255, 0.32), transparent 42%),
            rgba(8, 7, 11, 0.78);
          color: #fff7dc;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          box-shadow:
            0 0 34px rgba(154, 75, 255, 0.34),
            0 20px 60px rgba(0, 0, 0, 0.54);
          cursor: pointer;
          opacity: 0;
          pointer-events: none;
          transform: translateY(14px);
          transition: opacity 0.38s ease, transform 0.38s ease, border-color 0.38s ease;
        }

        .mk-ritual-replay:hover,
        .mk-ritual-replay:focus-visible {
          border-color: rgba(255, 255, 255, 0.86);
          box-shadow:
            0 0 44px rgba(154, 75, 255, 0.48),
            0 24px 72px rgba(0, 0, 0, 0.64);
        }

        .mk-page[data-ritual-state="ended"] .mk-ritual-replay {
          opacity: 1;
          pointer-events: auto;
          transform: translateY(0);
        }

        .mk-sigil {
          position: absolute;
          top: 50%;
          left: 50%;
          width: min(72vw, 780px);
          aspect-ratio: 1;
          transform: translate(-50%, -50%);
          border: 1px solid rgba(215, 180, 81, 0.5);
          border-radius: 50%;
          opacity: 0.52;
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.08),
            0 0 80px rgba(215, 180, 81, 0.18);
          animation: mk-spin 38s linear infinite;
        }

        .mk-sigil::before,
        .mk-sigil::after {
          content: "";
          position: absolute;
          inset: 12%;
          border: 1px solid rgba(88, 246, 255, 0.28);
          transform: rotate(45deg);
        }

        .mk-sigil::after {
          inset: 26%;
          border-color: rgba(255, 51, 92, 0.32);
          transform: rotate(0deg);
        }

        .mk-orbit-scene {
          position: absolute;
          top: 50%;
          right: clamp(120px, 22vw, 420px);
          z-index: 2;
          width: min(38vw, 560px);
          aspect-ratio: 1;
          transform: translateY(-50%);
          perspective: 900px;
          pointer-events: none;
        }

        .mk-altar {
          position: absolute;
          inset: 12%;
          transform-style: preserve-3d;
          transform: rotateX(64deg) rotateZ(-18deg);
          animation: mk-altar-drift 11s ease-in-out infinite;
        }

        .mk-altar-ring,
        .mk-altar-ring::before,
        .mk-altar-ring::after {
          position: absolute;
          inset: 0;
          border: 1px solid rgba(215, 180, 81, 0.5);
          border-radius: 50%;
          box-shadow: 0 0 42px rgba(215, 180, 81, 0.14), inset 0 0 32px rgba(255, 51, 92, 0.12);
          transform-style: preserve-3d;
        }

        .mk-altar-ring::before,
        .mk-altar-ring::after {
          content: "";
          inset: 11%;
          border-color: rgba(88, 246, 255, 0.34);
          transform: translateZ(72px) rotateZ(45deg);
        }

        .mk-altar-ring::after {
          inset: 24%;
          border-color: rgba(159, 255, 110, 0.26);
          transform: translateZ(-96px) rotateZ(0deg);
        }

        .mk-monolith {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 24%;
          height: 42%;
          transform: translate(-50%, -50%) translateZ(108px) rotateX(-18deg);
          border: 1px solid rgba(255, 255, 255, 0.2);
          background:
            linear-gradient(120deg, rgba(255, 255, 255, 0.11), transparent 36%),
            linear-gradient(180deg, rgba(8, 7, 11, 0.82), rgba(255, 51, 92, 0.16));
          box-shadow:
            0 0 52px rgba(255, 51, 92, 0.22),
            inset 0 0 42px rgba(0, 0, 0, 0.76);
        }

        .mk-eye {
          position: absolute;
          top: 40%;
          left: 51%;
          width: min(14vw, 124px);
          aspect-ratio: 1;
          transform: translate(-50%, -50%) translateZ(180px);
          border: 1px solid rgba(215, 180, 81, 0.48);
          border-radius: 50%;
          background:
            radial-gradient(circle at 52% 52%, #09070b 0 13%, var(--cult-gold) 14% 20%, rgba(255, 247, 220, 0.92) 21% 31%, rgba(255, 51, 92, 0.2) 32% 44%, transparent 45%),
            radial-gradient(circle, rgba(215, 180, 81, 0.28), transparent 62%);
          box-shadow: 0 0 70px rgba(215, 180, 81, 0.42);
          animation: mk-eye-watch 4.8s steps(2, end) infinite;
        }

        .mk-whisper {
          position: absolute;
          left: 28px;
          bottom: 28px;
          z-index: 2;
          display: grid;
          gap: 6px;
          color: rgba(245, 234, 210, 0.46);
          font-size: 0.74rem;
          font-weight: 900;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          writing-mode: vertical-rl;
          opacity: 0;
        }

        .mk-whisper span {
          text-shadow: 2px 0 rgba(255, 51, 92, 0.55), -2px 0 rgba(88, 246, 255, 0.38);
          animation: mk-flicker 3.2s linear infinite;
        }

        .mk-hero-inner {
          position: relative;
          z-index: 6;
          width: min(1180px, calc(100vw - clamp(36px, 5vw, 96px)));
          margin: 0 auto;
          padding: clamp(56px, 8.4vh, 82px) 0 clamp(42px, 6vh, 64px);
          opacity: var(--mk-copy-opacity);
          pointer-events: none;
          transform: translate3d(0, var(--mk-copy-y), var(--mk-copy-z));
          transition: opacity 0.12s linear;
        }

        .mk-kicker {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          margin: 0 0 18px;
          color: var(--cult-gold);
          font-size: 0.8rem;
          font-weight: 900;
          text-transform: uppercase;
        }

        .mk-kicker::before {
          content: "";
          width: 42px;
          height: 1px;
          background: var(--cult-gold);
        }

        .mk-title {
          position: relative;
          max-width: 760px;
          margin: 0;
          color: #fff7dc;
          font-family: var(--font-display);
          font-size: clamp(5.4rem, 14vw, 11.6rem);
          font-weight: 700;
          line-height: 0.82;
          letter-spacing: 0;
          text-shadow:
            0 0 18px rgba(215, 180, 81, 0.4),
            7px 0 0 rgba(255, 51, 92, 0.28),
            -7px 0 0 rgba(88, 246, 255, 0.22);
        }

        .mk-title::before,
        .mk-title::after {
          content: attr(data-text);
          position: absolute;
          inset: 0;
          pointer-events: none;
          opacity: 0;
        }

        .mk-title::before {
          color: var(--cult-red);
          transform: translate(9px, 0);
          clip-path: inset(9% 0 68% 0);
          animation: mk-glitch 4.6s steps(1, end) infinite;
        }

        .mk-title::after {
          color: var(--cult-cyan);
          transform: translate(-8px, 0);
          clip-path: inset(58% 0 16% 0);
          animation: mk-glitch 5.3s steps(1, end) infinite reverse;
        }

        .mk-subtitle {
          max-width: 640px;
          margin: 26px 0 0;
          color: rgba(245, 234, 210, 0.86);
          font-size: clamp(1.1rem, 2.3vw, 1.75rem);
          font-weight: 900;
          line-height: 1.55;
        }

        .mk-copy {
          max-width: 580px;
          margin: 18px 0 0;
          color: rgba(245, 234, 210, 0.68);
          font-size: 1rem;
          line-height: 1.9;
        }

        .mk-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          margin-top: 30px;
        }

        .mk-button {
          display: inline-flex;
          min-height: 46px;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(215, 180, 81, 0.72);
          border-radius: 999px;
          padding: 10px 18px;
          background: var(--cult-gold);
          color: #120d13;
          font-weight: 900;
          text-decoration: none;
          box-shadow: 0 0 34px rgba(215, 180, 81, 0.28);
        }

        .mk-button-secondary {
          background: rgba(255, 255, 255, 0.08);
          color: var(--cult-ink);
          box-shadow: none;
        }

        .mk-section {
          --mk-panel-z: -760;
          --mk-panel-lift: 0;
          --mk-panel-tilt: 13;
          --mk-panel-opacity: 0;
          --mk-panel-scale: 0.88;
          position: absolute;
          top: 50%;
          left: 50%;
          z-index: 1;
          width: min(880px, calc(100% - 64px));
          min-height: auto;
          margin: 0;
          padding: clamp(22px, 4vw, 44px);
          border: 1px solid rgba(215, 180, 81, 0.22);
          border-radius: 18px;
          background:
            linear-gradient(135deg, rgba(255, 51, 92, 0.1), transparent 34%),
            linear-gradient(180deg, rgba(17, 12, 20, 0.88), rgba(5, 4, 8, 0.76));
          box-shadow:
            0 30px 120px rgba(0, 0, 0, 0.52),
            inset 0 0 54px rgba(215, 180, 81, 0.05);
          opacity: var(--mk-panel-opacity);
          transform:
            translate(-50%, -50%)
            perspective(1200px)
            translate3d(0, calc(var(--mk-panel-lift) * 1px), calc(var(--mk-panel-z) * 1px))
            rotateX(calc(var(--mk-panel-tilt) * 1deg))
            scale(var(--mk-panel-scale));
          transform-origin: 50% 56%;
          transition: opacity 0.18s linear;
          pointer-events: none;
          will-change: transform, opacity;
        }

        .mk-depth-journey {
          display: none;
        }

        .mk-depth-journey::before {
          content: "";
          position: absolute;
          inset: -12%;
          z-index: 0;
          display: block;
          pointer-events: none;
          background:
            repeating-radial-gradient(ellipse at 50% 42%, rgba(215, 180, 81, 0.16) 0 1px, transparent 2px 76px),
            radial-gradient(ellipse at 50% 42%, transparent 0 22%, rgba(44, 8, 72, 0.24) 38%, rgba(0, 0, 0, 0.78) 72%, #08070b 100%);
          opacity: var(--mk-tunnel-opacity);
          transform: translateZ(-420px) scale(var(--mk-tunnel-scale));
          transform-origin: 50% 42%;
        }

        .mk-section h2 {
          margin: 0 0 18px;
          color: #fff7dc;
          font-family: var(--font-display);
          font-size: clamp(2.2rem, 6vw, 5rem);
          line-height: 0.95;
        }

        .mk-section-lead {
          max-width: 780px;
          margin: 0;
          color: rgba(245, 234, 210, 0.68);
          line-height: 1.9;
        }

        .mk-tenets {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          margin-top: 34px;
        }

        .mk-tenet {
          position: relative;
          min-height: 280px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 8px;
          padding: 22px;
          background:
            linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.025)),
            rgba(255, 255, 255, 0.04);
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.24);
        }

        .mk-tenet::after {
          content: "";
          position: absolute;
          inset: auto 18px 18px auto;
          width: 54px;
          aspect-ratio: 1;
          border: 1px solid rgba(159, 255, 110, 0.24);
          transform: rotate(45deg);
          box-shadow: 0 0 28px rgba(159, 255, 110, 0.1);
        }

        .mk-tenet::before {
          content: attr(data-number);
          position: absolute;
          right: -10px;
          bottom: -34px;
          color: rgba(215, 180, 81, 0.13);
          font-family: var(--font-display);
          font-size: 9rem;
          line-height: 1;
        }

        .mk-tenet h3 {
          margin: 0 0 12px;
          color: #ffffff;
          font-size: 1.4rem;
        }

        .mk-tenet p {
          margin: 0;
          color: rgba(245, 234, 210, 0.66);
          line-height: 1.8;
        }

        .mk-fragment {
          display: grid;
          grid-template-columns: 0.9fr 1.1fr;
          gap: 28px;
          align-items: center;
          border-top: 1px solid rgba(215, 180, 81, 0.22);
          border-bottom: 1px solid rgba(215, 180, 81, 0.22);
        }

        .mk-fragment img {
          width: 100%;
          border-radius: 8px;
          filter: saturate(1.05) contrast(1.04);
          box-shadow: 0 30px 90px rgba(0, 0, 0, 0.36);
        }

        .mk-schedule {
          display: grid;
          gap: 1px;
          margin-top: 34px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 8px;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.14);
        }

        .mk-schedule div {
          display: grid;
          grid-template-columns: 180px 1fr;
          gap: 18px;
          padding: 18px;
          background: rgba(8, 7, 11, 0.72);
        }

        .mk-schedule time {
          color: var(--cult-gold);
          font-weight: 900;
        }

        .mk-schedule strong {
          color: #ffffff;
        }

        .mk-footer {
          position: fixed;
          right: 24px;
          bottom: 18px;
          z-index: 10;
          width: auto;
          margin: 0;
          padding: 0;
          color: rgba(245, 234, 210, 0.54);
          font-size: 0.9rem;
          opacity: var(--mk-footer-opacity);
          pointer-events: none;
        }

        @keyframes mk-spin {
          to {
            transform: translate(-50%, -50%) rotate(360deg);
          }
        }

        @keyframes mk-altar-drift {
          0%, 100% {
            transform: rotateX(64deg) rotateZ(-18deg) translateZ(0);
          }

          50% {
            transform: rotateX(58deg) rotateZ(-26deg) translateZ(34px);
          }
        }

        @keyframes mk-eye-watch {
          0%, 34%, 100% {
            transform: translate(-50%, -50%) translateZ(180px) scale(1);
            filter: hue-rotate(0deg);
          }

          35%, 43% {
            transform: translate(-46%, -50%) translateZ(220px) scale(1.08);
            filter: hue-rotate(116deg);
          }
        }

        @keyframes mk-glitch {
          0%, 88%, 100% {
            opacity: 0;
          }

          89%, 91% {
            opacity: 0.72;
          }

          94% {
            opacity: 0.42;
            transform: translate(18px, -5px);
          }
        }

        @keyframes mk-flicker {
          0%, 19%, 21%, 64%, 66%, 100% {
            opacity: 0.34;
          }

          20%, 65% {
            opacity: 0.92;
          }
        }

        @keyframes mk-pulse {
          0%, 100% {
            opacity: 0.56;
            transform: scale(1);
          }

          50% {
            opacity: 0.82;
            transform: scale(1.04);
          }
        }

        @keyframes mk-portrait-breathe {
          0%, 100% {
            box-shadow:
              0 0 0 1px rgba(255, 255, 255, 0.08),
              0 36px 110px rgba(0, 0, 0, 0.6),
              0 0 90px rgba(215, 180, 81, 0.16);
          }

          50% {
            box-shadow:
              0 0 0 1px rgba(159, 255, 110, 0.15),
              0 44px 130px rgba(0, 0, 0, 0.68),
              0 0 120px rgba(255, 51, 92, 0.18);
          }
        }

        @keyframes mk-portrait-decay {
          0%, 100% {
            filter: saturate(0.9) contrast(1.08) brightness(0.82) hue-rotate(0deg);
            transform: scale(1.01) translate3d(0, 0, 0);
          }

          42% {
            filter: saturate(0.72) contrast(1.18) brightness(0.72) hue-rotate(-8deg);
          }

          67% {
            filter: saturate(1.04) contrast(1.24) brightness(0.78) hue-rotate(12deg);
            transform: scale(1.022) translate3d(0.7%, -0.4%, 0);
          }
        }

        @keyframes mk-portrait-vignette {
          0%, 100% {
            opacity: 0.82;
            transform: translate3d(0, 0, 0);
          }

          48% {
            opacity: 1;
            transform: translate3d(-1.2%, 0.6%, 0);
          }
        }

        @keyframes mk-portrait-scan {
          0%, 100% {
            opacity: 0.24;
            transform: translateY(0);
          }

          50% {
            opacity: 0.42;
            transform: translateY(9px);
          }
        }

        @keyframes mk-portrait-glitch {
          0%, 78%, 82%, 100% {
            opacity: 0;
            transform: translate3d(0, 0, 0) scale(1.01);
            clip-path: inset(42% 0 38% 0);
          }

          79% {
            opacity: 0.44;
            transform: translate3d(-18px, 0, 0) scale(1.018);
            clip-path: inset(18% 0 62% 0);
          }

          80% {
            opacity: 0.36;
            transform: translate3d(16px, -4px, 0) scale(1.018);
            clip-path: inset(58% 0 20% 0);
          }

          81% {
            opacity: 0.52;
            transform: translate3d(-8px, 5px, 0) scale(1.018);
            clip-path: inset(34% 0 43% 0);
          }
        }

        @keyframes mk-blackout-cycle {
          0%, 86% {
            opacity: 0;
          }

          88%, 91.5% {
            opacity: 1;
          }

          92.5% {
            opacity: 0.72;
          }

          94% {
            opacity: 0.22;
          }

          97%, 100% {
            opacity: 0;
          }
        }

        @keyframes mk-eye-open-cycle {
          0%, 89% {
            opacity: 0;
            clip-path: inset(50% 0 50% 0);
            transform: scaleY(0.08);
          }

          90.5% {
            opacity: 0;
            clip-path: inset(50% 0 50% 0);
          }

          92% {
            opacity: 0.95;
            clip-path: inset(46% 0 46% 0);
            transform: scaleY(0.22);
          }

          93.8% {
            opacity: 0.72;
            clip-path: inset(26% 0 26% 0);
            transform: scaleY(0.72);
          }

          95.5% {
            opacity: 0.28;
            clip-path: inset(0 0 0 0);
            transform: scaleY(1);
          }

          98%, 100% {
            opacity: 0;
            clip-path: inset(0 0 0 0);
          }
        }

        @keyframes mk-wake-chroma {
          0%, 91% {
            opacity: 0;
            transform: translate3d(0, 0, 0) scaleX(1.02);
          }

          92.2% {
            opacity: 0.72;
            transform: translate3d(-22px, 0, 0) scaleX(1.1);
          }

          93.2% {
            opacity: 0.42;
            transform: translate3d(18px, -8px, 0) scaleX(1.06);
          }

          95.4% {
            opacity: 0.18;
            transform: translate3d(0, 0, 0) scaleX(1);
          }

          98%, 100% {
            opacity: 0;
          }
        }

        @media (max-width: 820px) {
          .mk-hero {
            min-height: 100svh;
            height: 100svh;
            padding: 18px;
          }

          .mk-key-visual {
            top: auto;
            right: 50%;
            left: auto;
            bottom: clamp(230px, 34svh, 310px);
            width: min(54vw, 260px);
            min-width: 0;
            height: 28svh;
            opacity: var(--mk-portrait-opacity);
            border-radius: 14px;
            translate: 50% 0;
          }

          .mk-depth-prop {
            width: var(--prop-mobile-width, var(--prop-width));
          }

          .mk-hero-inner {
            width: 100%;
            max-width: calc(100vw - 36px);
            min-width: 0;
            padding-bottom: 38px;
          }

          .mk-orbit-scene {
            top: 42%;
            right: -22vw;
            width: 104vw;
            opacity: 0.78;
          }

          .mk-black-mass {
            right: -22vw;
            left: auto;
            bottom: 0;
            width: 102vw;
            min-width: 0;
            opacity: calc(0.74 - var(--mk-hero-exit) * 0.62);
          }

          .mk-candles {
            inset: 0;
          }

          .mk-whisper {
            left: auto;
            right: 12px;
            bottom: 92px;
            font-size: 0.58rem;
          }

          .mk-title {
            font-size: clamp(5.4rem, 28vw, 8rem);
            writing-mode: vertical-rl;
            text-orientation: mixed;
            line-height: 0.9;
          }

          .mk-subtitle {
            max-width: min(22em, 100%);
            font-size: 1.02rem;
            line-break: anywhere;
            overflow-wrap: anywhere;
            word-break: normal;
          }

          .mk-copy {
            max-width: 100%;
            line-break: anywhere;
            overflow-wrap: anywhere;
            word-break: break-all;
          }

          .mk-actions {
            flex-direction: column;
          }

          .mk-button {
            width: 100%;
          }

          .mk-section {
            width: min(100%, calc(100% - 28px));
            min-height: auto;
            padding: 22px;
          }

          .mk-depth-journey {
            margin-top: 0;
            padding-top: 0;
            overflow: clip;
          }

          .mk-tenets,
          .mk-fragment,
          .mk-schedule div {
            grid-template-columns: 1fr;
          }

          .mk-tenet {
            min-height: 220px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .mk-sigil,
          .mk-altar,
          .mk-eye,
          .mk-whisper span,
          .mk-title::before,
          .mk-title::after,
          .mk-key-visual,
          .mk-key-visual img,
          .mk-key-visual::before,
          .mk-key-visual::after,
          .mk-key-visual-glitch,
          .mk-depth-prop,
          .mk-flame-canvas,
          .mk-wake-overlay,
          .mk-wake-overlay::before,
          .mk-wake-overlay::after,
          .mk-hero::before {
            animation: none;
          }

          .mk-wake-overlay {
            display: none;
          }
        }
      </style>
      <main class="mk-page" data-ritual-state="running">
        <canvas class="mk-abyss-canvas" data-mk-abyss aria-hidden="true"></canvas>
        <section class="mk-hero">
          <div class="mk-banner" aria-hidden="true"></div>
          <div class="mk-perspective-corridor" aria-hidden="true">
            <div class="mk-loop-tunnel">
              <div class="mk-loop-surface mk-loop-ceiling"></div>
              <div class="mk-loop-surface mk-loop-floor"></div>
              <div class="mk-loop-surface mk-loop-wall-left"></div>
              <div class="mk-loop-surface mk-loop-wall-right"></div>
              <div class="mk-loop-road-core"></div>
              <div class="mk-loop-horizon"></div>
              <svg class="mk-tunnel-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                <path d="M0 0 L37 34 M100 0 L63 34 M0 100 L37 66 M100 100 L63 66"></path>
                <rect x="37" y="34" width="26" height="32"></rect>
                <path class="mk-edge-secondary" d="M18 100 L42 66 M82 100 L58 66 M18 0 L42 34 M82 0 L58 34"></path>
              </svg>
            </div>
            <div class="mk-corridor-plane mk-corridor-plane-top"></div>
            <div class="mk-corridor-plane mk-corridor-plane-bottom"></div>
            <div class="mk-corridor-plane mk-corridor-plane-left"></div>
            <div class="mk-corridor-plane mk-corridor-plane-right"></div>
            ${Array.from({ length: 28 }, (_, index) => `<div class="mk-corridor-frame" data-mk-corridor-frame="${index}"></div>`).join("")}
            <div class="mk-corridor-vortex"></div>
          </div>
          <div class="mk-corridor-props" aria-hidden="true">
            <img class="mk-depth-prop" data-mk-prop="door-far" src="../assets/generated/manzokukyo/prop-door.webp" alt="" width="980" height="653" loading="eager" style="--prop-width: min(24vw, 430px); --prop-mobile-width: 72vw;">
            <img class="mk-depth-prop" data-mk-prop="mirror-far" src="../assets/generated/manzokukyo/prop-mirror.webp" alt="" width="760" height="1140" loading="eager" style="--prop-width: min(15vw, 270px); --prop-mobile-width: 48vw;">
            <img class="mk-depth-prop" data-mk-prop="painting-far" src="../assets/generated/manzokukyo/prop-painting.webp" alt="" width="780" height="1170" loading="eager" style="--prop-width: min(16vw, 290px); --prop-mobile-width: 50vw;">
            <img class="mk-depth-prop" data-mk-prop="coffin-far" src="../assets/generated/manzokukyo/prop-coffin.webp" alt="" width="760" height="507" loading="eager" style="--prop-width: min(15vw, 260px); --prop-mobile-width: 46vw;">
            <img class="mk-depth-prop" data-mk-prop="door" src="../assets/generated/manzokukyo/prop-door.webp" alt="" width="980" height="653" loading="eager" style="--prop-width: min(36vw, 620px); --prop-mobile-width: 86vw;">
            <img class="mk-depth-prop" data-mk-prop="mirror" src="../assets/generated/manzokukyo/prop-mirror.webp" alt="" width="760" height="1140" loading="eager" style="--prop-width: min(24vw, 410px); --prop-mobile-width: 66vw;">
            <img class="mk-depth-prop" data-mk-prop="coffin" src="../assets/generated/manzokukyo/prop-coffin.webp" alt="" width="760" height="507" loading="eager" style="--prop-width: min(20vw, 340px); --prop-mobile-width: 58vw;">
            <img class="mk-depth-prop" data-mk-prop="painting" src="../assets/generated/manzokukyo/prop-painting.webp" alt="" width="780" height="1170" loading="eager" style="--prop-width: min(25vw, 430px); --prop-mobile-width: 68vw;">
          </div>
          <picture class="mk-key-visual">
            <source srcset="../assets/generated/manzokukyo/key-visual-hero.avif" type="image/avif">
            <img src="../assets/generated/manzokukyo/key-visual-hero.webp" alt="満足教キービジュアル" width="1254" height="1254" fetchpriority="high">
            <span class="mk-key-visual-glitch" aria-hidden="true"></span>
            <canvas class="mk-key-visual-noise" data-mk-portrait-noise aria-hidden="true"></canvas>
          </picture>
          <div class="mk-black-mass" aria-hidden="true">
            <img class="mk-altar-prop" src="../assets/generated/manzokukyo/altar.webp" alt="" width="1280" height="720" loading="eager">
            <div class="mk-candles">
              <canvas class="mk-flame-canvas" data-mk-flames aria-hidden="true"></canvas>
            </div>
            <div class="mk-altar-table"></div>
          </div>
          <div class="mk-sigil" aria-hidden="true"></div>
          <div class="mk-orbit-scene" aria-hidden="true">
            <div class="mk-altar">
              <div class="mk-altar-ring"></div>
              <div class="mk-monolith"></div>
              <div class="mk-eye"></div>
            </div>
          </div>
          <div class="mk-whisper" aria-hidden="true">
            <span>do not be satisfied</span>
            <span>the bowl is watching</span>
          </div>
          <div class="mk-hero-inner">
            <p class="mk-kicker">Satisfaction Cult / teaser transmission</p>
            <h1 class="mk-title" data-text="満足教">満足教</h1>
            <p class="mk-subtitle">小さな満足に跪け。救済は、ラーメン一杯ぶんの熱から始まる。</p>
            <p class="mk-copy">残念院さんがひらく、甘くて不穏な小さな祭壇。満たされたと思った瞬間、次の満足がこちらを見つめている。</p>
            <div class="mk-actions">
              <a class="mk-button" href="#doctrine">教義を覗く</a>
              <a class="mk-button mk-button-secondary" href="../">公式設定へ戻る</a>
            </div>
          </div>
        </section>
        <div class="mk-ritual-dim" aria-hidden="true"></div>
        <div class="mk-wake-overlay" aria-hidden="true"></div>
        <button class="mk-ritual-replay" type="button" data-mk-ritual-replay aria-label="黒ミサ演出をリプレイ">Replay Ritual</button>
        <div class="mk-depth-journey" data-mk-depth-journey>
        <section class="mk-section" id="doctrine">
          <h2>満たされよ、しかし満ち足りるな。</h2>
          <p class="mk-section-lead">満足教は、過剰な幸福ではなく、見落とされる小さな満足を拾い上げるための仮想宗教です。教義はまだ霧の中にあり、断片だけが残念院さんの周囲に浮かんでいます。</p>
          <div class="mk-tenets">
            <article class="mk-tenet" data-number="01">
              <h3>一杯の救済</h3>
              <p>温かいものを食べること。くだらない話で笑うこと。それらはすべて、満足の儀式として記録される。</p>
            </article>
            <article class="mk-tenet" data-number="02">
              <h3>おでこの啓示</h3>
              <p>隠されていない額は、迷いなき自己提示の象徴。見よ、そこに教祖の余白がある。</p>
            </article>
            <article class="mk-tenet" data-number="03">
              <h3>黒金の静寂</h3>
              <p>黒は沈黙、金は祝福。満足教の色は、冗談と格式が同じ席に座るための合図である。</p>
            </article>
          </div>
        </section>
        <section class="mk-section mk-fragment" id="signs">
          <img src="../assets/outfit-reference.png" alt="残念院さん 衣装三面図">
          <div>
            <p class="mk-kicker">visual fragment</p>
            <h2>これは礼拝か、ただの衣装か。</h2>
            <p class="mk-section-lead">高い黒襟、白い肩掛け、金の装飾、編み上げブーツ。満足教の視覚言語は、儀式めいた冗談として成立する。まだ正式公開前のため、各設定は仮文言です。</p>
          </div>
        </section>
        <section class="mk-section" id="revelation">
          <h2>Revelation Log</h2>
          <p class="mk-section-lead">公開に向けた仮の告知ログです。実際の公開日、企画内容、導線は今後の設定整理に合わせて差し替えます。</p>
          <div class="mk-schedule">
            <div>
              <time>Phase 00</time>
              <strong>ティザーサイト開門。教義はまだ仮置き。</strong>
            </div>
            <div>
              <time>Phase 01</time>
              <strong>満足教の用語、儀式、禁止事項を整理予定。</strong>
            </div>
            <div>
              <time>Phase 02</time>
              <strong>画像、動画、AIプロンプト用のビジュアル断片を追加予定。</strong>
            </div>
          </div>
        </section>
        <footer class="mk-footer">
          <p>このページは満足教ティザーのデザイン試作です。文章は仮置きであり、公式設定として確定する場合は character.json へ反映してください。</p>
        </footer>
        </div>
      </main>
      <script>
        (() => {
          const page = document.querySelector(".mk-page");
          const replay = document.querySelector("[data-mk-ritual-replay]");
          const wakeOverlay = document.querySelector(".mk-wake-overlay");
          if (!page || !replay || !wakeOverlay || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
          }

          const ritualDurationMs = 37200;
          let ritualTimer = 0;

          function endRitual() {
            page.dataset.ritualState = "ended";
          }

          function startRitual() {
            window.clearTimeout(ritualTimer);
            page.dataset.ritualState = "resetting";
            page.style.setProperty("--mk-ritual-dim", "0");
            page.offsetWidth;
            page.dataset.ritualState = "running";
            page.dispatchEvent(new CustomEvent("mk:ritual-start"));
            ritualTimer = window.setTimeout(endRitual, ritualDurationMs);
          }

          wakeOverlay.addEventListener("animationend", (event) => {
            if (event.animationName === "mk-blackout-cycle" && page.dataset.ritualState === "running") {
              endRitual();
            }
          });
          replay.addEventListener("click", startRitual);
          startRitual();
          window.addEventListener("pagehide", () => window.clearTimeout(ritualTimer), { once: true });
        })();
        (() => {
          const page = document.querySelector(".mk-page");
          const panels = Array.from(document.querySelectorAll(".mk-depth-journey > .mk-section"));
          const props = Array.from(document.querySelectorAll("[data-mk-prop]"));
          const corridorFrames = Array.from(document.querySelectorAll("[data-mk-corridor-frame]"));
          if (!page || !panels.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
          }

          let ticking = false;
          let virtualDepth = 0;
          let lastTouchY = null;
          const maxDepth = 6.8;
          const panelSlots = [0.34, 0.58, 0.82];
          const propRoutes = {
            "door-far": { offset: 0.0, cycle: 1.9, side: -1, lane: 5, pass: 86, scale: 1.65, opacity: 0.5, tilt: 28 },
            "mirror-far": { offset: 0.28, cycle: 2.0, side: 1, lane: 8, pass: 92, scale: 1.9, opacity: 0.54, tilt: -34 },
            "painting-far": { offset: 0.56, cycle: 2.05, side: -1, lane: 13, pass: 98, scale: 2.05, opacity: 0.52, tilt: 30 },
            "coffin-far": { offset: 0.86, cycle: 2.1, side: 1, lane: 11, pass: 92, scale: 2.0, opacity: 0.56, tilt: -32 },
            door: { offset: 1.24, cycle: 2.15, side: -1, lane: 2, pass: 124, scale: 3.15, opacity: 0.76, tilt: 42 },
            mirror: { offset: 1.54, cycle: 2.2, side: 1, lane: 5, pass: 126, scale: 2.85, opacity: 0.78, tilt: -48 },
            coffin: { offset: 1.88, cycle: 2.18, side: -1, lane: 7, pass: 132, scale: 3.1, opacity: 0.82, tilt: 46 },
            painting: { offset: 2.2, cycle: 2.24, side: 1, lane: 4, pass: 128, scale: 2.95, opacity: 0.78, tilt: -44 },
          };

          function clamp(value, min, max) {
            return Math.min(max, Math.max(min, value));
          }

          function updateDepth() {
            ticking = false;
            const depth = virtualDepth;
            const sceneDepth = clamp(depth / maxDepth, 0, 1);
            const heroExit = clamp(sceneDepth / 0.22, 0, 1);
            const corridorIntro = clamp((sceneDepth - 0.08) / 0.2, 0, 1);
            page.style.setProperty("--mk-depth", sceneDepth.toFixed(3));
            page.style.setProperty("--mk-hero-exit", heroExit.toFixed(3));
            page.style.setProperty("--mk-corridor-opacity", (corridorIntro * 0.96).toFixed(3));
            page.style.setProperty("--mk-banner-opacity", clamp(1 - heroExit * 0.78, 0.16, 1).toFixed(3));
            page.style.setProperty("--mk-road-shift", (depth * 620).toFixed(1) + "px");
            page.style.setProperty("--mk-wall-shift", (depth * 430).toFixed(1) + "px");
            page.style.setProperty("--mk-horizon-shift", (depth * 310).toFixed(1) + "px");
            page.style.setProperty("--mk-copy-opacity", clamp(1 - heroExit * 1.28, 0, 1).toFixed(3));
            page.style.setProperty("--mk-copy-y", "0px");
            page.style.setProperty("--mk-copy-z", (180 + heroExit * 620).toFixed(1) + "px");
            page.style.setProperty("--mk-altar-y", "0px");
            page.style.setProperty("--mk-altar-z", (80 + heroExit * 520).toFixed(1) + "px");
            page.style.setProperty("--mk-altar-scale", (1 + heroExit * 0.46).toFixed(3));
            page.style.setProperty("--mk-portrait-y", "0px");
            page.style.setProperty("--mk-portrait-z", (-220 + heroExit * 520).toFixed(1) + "px");
            page.style.setProperty("--mk-portrait-scale", (0.82 + heroExit * 0.22).toFixed(3));
            page.style.setProperty("--mk-portrait-opacity", clamp(0.64 - heroExit * 0.56, 0.04, 0.64).toFixed(3));
            page.style.setProperty("--mk-tunnel-opacity", clamp((sceneDepth - 0.08) / 0.2, 0, 0.78).toFixed(3));
            page.style.setProperty("--mk-tunnel-scale", (1.16 + sceneDepth * 0.42).toFixed(3));
            page.style.setProperty("--mk-footer-opacity", clamp((sceneDepth - 0.9) / 0.08, 0, 1).toFixed(3));

            panels.forEach((panel, index) => {
              const slot = panelSlots[index] ?? (0.34 + index * 0.24);
              const presence = clamp(1 - Math.abs(depth - slot) / 0.17, 0, 1);
              const z = -820 + presence * 860;
              const lift = 0;
              const tilt = 14 - presence * 14;
              const opacity = presence * 0.94;
              panel.style.setProperty("--mk-panel-z", z.toFixed(1));
              panel.style.setProperty("--mk-panel-lift", lift.toFixed(1));
              panel.style.setProperty("--mk-panel-tilt", tilt.toFixed(2));
              panel.style.setProperty("--mk-panel-scale", (0.86 + presence * 0.16).toFixed(3));
              panel.style.setProperty("--mk-panel-opacity", opacity.toFixed(3));
            });

            corridorFrames.forEach((frame, index) => {
              const lane = ((index / corridorFrames.length) + depth * 0.24) % 1;
              const progress = lane;
              const fisheye = Math.pow(progress, 2.35);
              const z = -1680 + fisheye * 2050;
              const scale = 0.08 + Math.pow(progress, 1.78) * 2.45;
              const farGlow = clamp((0.38 - progress) / 0.38, 0, 1);
              const nearFade = clamp((1 - progress) / 0.18, 0, 1);
              const opacity = (0.06 + farGlow * 0.18 + progress * 0.1) * nearFade;
              frame.style.setProperty("--frame-z", z.toFixed(1) + "px");
              frame.style.setProperty("--frame-scale", scale.toFixed(3));
              frame.style.setProperty("--frame-opacity", opacity.toFixed(3));
            });

            props.forEach((prop) => {
              const route = propRoutes[prop.dataset.mkProp];
              if (!route) return;
              const cycle = route.cycle ?? 2;
              const raw = depth < route.offset
                ? -1
                : ((depth - route.offset) % cycle + cycle) % cycle;
              const progress = raw < 0 ? 0 : clamp(raw / cycle, 0, 1);
              const isActive = raw >= 0 ? 1 : 0;
              const enter = clamp(progress / 0.16, 0, 1);
              const exit = clamp((1 - progress) / 0.18, 0, 1);
              const presence = enter * exit * isActive;
              const eased = progress * progress * (3 - 2 * progress);
              const fisheye = Math.pow(progress, 2.42);
              const x = route.side * (route.lane + fisheye * route.pass);
              const z = -1120 + eased * 1510;
              const scale = 0.06 + Math.pow(progress, 2.16) * route.scale;
              const blur = (1 - presence) * 9.5 + progress * 0.5;
              const rotateY = route.tilt * (0.16 + progress * 0.84);
              const rotateZ = route.side * -1 * progress * 3.5;
              prop.style.setProperty("--prop-x", x.toFixed(2) + "vw");
              prop.style.setProperty("--prop-z", z.toFixed(1) + "px");
              prop.style.setProperty("--prop-scale", scale.toFixed(3));
              prop.style.setProperty("--prop-opacity", (presence * route.opacity).toFixed(3));
              prop.style.setProperty("--prop-blur", blur.toFixed(2) + "px");
              prop.style.setProperty("--prop-ry", rotateY.toFixed(2) + "deg");
              prop.style.setProperty("--prop-rz", rotateZ.toFixed(2) + "deg");
            });
          }

          function setDepth(nextDepth) {
            virtualDepth = clamp(nextDepth, 0, maxDepth);
            requestDepthUpdate();
          }

          function requestDepthUpdate() {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(updateDepth);
          }

          updateDepth();
          window.addEventListener("wheel", (event) => {
            event.preventDefault();
            setDepth(virtualDepth + event.deltaY / 1900);
          }, { passive: false });
          window.addEventListener("touchstart", (event) => {
            lastTouchY = event.touches[0]?.clientY ?? null;
          }, { passive: true });
          window.addEventListener("touchmove", (event) => {
            const currentY = event.touches[0]?.clientY;
            if (lastTouchY == null || currentY == null) return;
            event.preventDefault();
            setDepth(virtualDepth + (lastTouchY - currentY) / 1300);
            lastTouchY = currentY;
          }, { passive: false });
          window.addEventListener("touchend", () => {
            lastTouchY = null;
          }, { passive: true });
          window.addEventListener("keydown", (event) => {
            const forwardKeys = ["ArrowDown", "PageDown", " ", "End"];
            const backKeys = ["ArrowUp", "PageUp", "Home"];
            if (forwardKeys.includes(event.key) || backKeys.includes(event.key)) {
              event.preventDefault();
              const direction = forwardKeys.includes(event.key) ? 1 : -1;
              setDepth(event.key === "End" ? maxDepth : event.key === "Home" ? 0 : virtualDepth + direction * 0.42);
            }
          });
          document.querySelectorAll(".mk-actions a[href^='#']").forEach((link) => {
            link.addEventListener("click", (event) => {
              const targetId = link.getAttribute("href").slice(1);
              const targetIndex = panels.findIndex((panel) => panel.id === targetId);
              if (targetIndex === -1) return;
              event.preventDefault();
              setDepth((panelSlots[targetIndex] ?? 0.34) * maxDepth);
            });
          });
          window.addEventListener("resize", requestDepthUpdate);
        })();
        (() => {
          const page = document.querySelector(".mk-page");
          const canvas = document.querySelector("[data-mk-flames]");
          if (!page || !canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
          }

          const ctx = canvas.getContext("2d");
          const cycleMs = 18000;
          const flameCanvasBleedTop = 0.24;
          const fadeWindows = [
            [0.14, 0.19],
            [0.28, 0.34],
            [0.43, 0.5],
            [0.59, 0.67],
            [0.76, 0.88]
          ];
          const altarSpace = {
            // Top-left of the original altar cutout image is (0, 0).
            source: "content/characters/zannenin/assets/manzokukyo/altar-cutout.png",
            width: 1672,
            height: 941
          };
          const candleTips = [
            { id: "left-edge", x: 160, y: 235, flameHeightRatio: 72 / 941, flameWidthRatio: 10 / 1672, seed: 1.2 },
            { id: "left-center", x: 501, y: 260, flameHeightRatio: 86 / 941, flameWidthRatio: 12 / 1672, seed: 2.1 },
            { id: "center", x: 788, y: 250, flameHeightRatio: 108 / 941, flameWidthRatio: 14 / 1672, seed: 3.4 },
            { id: "right-center", x: 1077, y: 260, flameHeightRatio: 86 / 941, flameWidthRatio: 12 / 1672, seed: 4.3 },
            { id: "right-edge", x: 1417, y: 235, flameHeightRatio: 72 / 941, flameWidthRatio: 10 / 1672, seed: 5.5 }
          ];
          let width = 0;
          let height = 0;
          let altarScale = 1;
          let altarOffsetX = 0;
          let altarOffsetY = 0;
          let raf = 0;
          let startTime = performance.now();

          function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const rect = canvas.getBoundingClientRect();
            width = Math.max(1, rect.width);
            height = Math.max(1, rect.height);
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
            canvas.style.width = width + "px";
            canvas.style.height = height + "px";
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            const altarViewportHeight = height / (1 + flameCanvasBleedTop);
            const altarViewportTop = height - altarViewportHeight;
            altarScale = Math.min(width / altarSpace.width, altarViewportHeight / altarSpace.height);
            altarOffsetX = (width - altarSpace.width * altarScale) / 2;
            altarOffsetY = altarViewportTop + (altarViewportHeight - altarSpace.height * altarScale) / 2;
          }

          function flameAlpha(index, elapsed) {
            const progress = (elapsed % cycleMs) / cycleMs;
            const loop = Math.floor(elapsed / cycleMs);
            if (loop >= 2 || page.dataset.ritualState !== "running") {
              return 0;
            }

            const [start, end] = fadeWindows[index];
            if (progress < start) return 1;
            if (progress > end) return 0;
            return 1 - ((progress - start) / (end - start));
          }

          function ritualDim(elapsed, alphas) {
            if (page.dataset.ritualState !== "running") {
              return 0;
            }

            const progress = (elapsed % cycleMs) / cycleMs;
            const loop = Math.floor(elapsed / cycleMs);
            if (loop >= 2) {
              return 0;
            }

            const lit = alphas.reduce((sum, value) => sum + value, 0);
            const extinguished = 1 - lit / candleTips.length;
            const finalFade = Math.max(0, Math.min(1, (progress - 0.76) / 0.12));
            const blackoutPull = Math.max(0, Math.min(1, (progress - 0.86) / 0.03));
            return Math.min(0.96, 0.05 + extinguished * 0.62 + finalFade * 0.12 + blackoutPull * 0.24);
          }

          function flameAnchor(candleTip) {
            return {
              x: altarOffsetX + candleTip.x * altarScale,
              y: altarOffsetY + candleTip.y * altarScale,
              h: candleTip.flameHeightRatio * altarSpace.height * altarScale,
              w: candleTip.flameWidthRatio * altarSpace.width * altarScale
            };
          }

          function drawCandleLight(anchor, alpha) {
            const lightR = anchor.h * 2.65;
            const lightX = anchor.x;
            const lightY = anchor.y - anchor.h * 0.36;

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = alpha;

            const warmAura = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, lightR);
            warmAura.addColorStop(0, "rgba(255, 218, 112, 0.42)");
            warmAura.addColorStop(0.18, "rgba(210, 126, 43, 0.28)");
            warmAura.addColorStop(0.46, "rgba(126, 48, 88, 0.14)");
            warmAura.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = warmAura;
            ctx.beginPath();
            ctx.arc(lightX, lightY, lightR, 0, Math.PI * 2);
            ctx.fill();

            const violetCore = ctx.createRadialGradient(anchor.x, anchor.y - anchor.h * 0.12, 0, anchor.x, anchor.y - anchor.h * 0.12, anchor.h * 1.22);
            violetCore.addColorStop(0, "rgba(220, 116, 255, 0.42)");
            violetCore.addColorStop(0.28, "rgba(116, 34, 178, 0.26)");
            violetCore.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = violetCore;
            ctx.beginPath();
            ctx.arc(anchor.x, anchor.y - anchor.h * 0.12, anchor.h * 1.22, 0, Math.PI * 2);
            ctx.fill();

            const wickBloom = ctx.createRadialGradient(anchor.x, anchor.y, 0, anchor.x, anchor.y, anchor.h * 0.46);
            wickBloom.addColorStop(0, "rgba(255, 230, 172, 0.42)");
            wickBloom.addColorStop(0.36, "rgba(190, 96, 36, 0.18)");
            wickBloom.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = wickBloom;
            ctx.beginPath();
            ctx.arc(anchor.x, anchor.y, anchor.h * 0.46, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
          }

          function drawFlame(candleTip, index, time, alpha) {
            const anchor = flameAnchor(candleTip);
            const baseX = anchor.x;
            const baseY = anchor.y;
            const flameH = anchor.h;
            const flameW = anchor.w;
            const flicker = Math.sin(time * 0.006 + candleTip.seed) * 0.5 + Math.sin(time * 0.013 + candleTip.seed * 2) * 0.5;
            const lean = flicker * flameW * 0.08;

            ctx.save();
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = alpha;

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = alpha;
            const halo = ctx.createRadialGradient(baseX, baseY - flameH * 0.18, 0, baseX, baseY - flameH * 0.18, flameH * 1.18);
            halo.addColorStop(0, "rgba(212, 94, 255, 0.44)");
            halo.addColorStop(0.22, "rgba(128, 34, 176, 0.3)");
            halo.addColorStop(0.55, "rgba(78, 12, 118, 0.16)");
            halo.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(baseX, baseY - flameH * 0.18, flameH * 1.18, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = alpha * 0.7;
            const tipLight = ctx.createRadialGradient(baseX, baseY, 0, baseX, baseY, flameH * 0.28);
            tipLight.addColorStop(0, "rgba(230, 150, 255, 0.48)");
            tipLight.addColorStop(0.38, "rgba(126, 28, 170, 0.3)");
            tipLight.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = tipLight;
            ctx.beginPath();
            ctx.arc(baseX, baseY, flameH * 0.28, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            const glow = ctx.createRadialGradient(baseX, baseY - flameH * 0.34, 0, baseX, baseY - flameH * 0.34, flameH * 0.94);
            glow.addColorStop(0, "rgba(58, 8, 68, 0.5)");
            glow.addColorStop(0.36, "rgba(28, 2, 42, 0.36)");
            glow.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.ellipse(baseX, baseY - flameH * 0.38, flameW * 3.8, flameH * 0.86, 0, 0, Math.PI * 2);
            ctx.fill();

            const smoke = ctx.createRadialGradient(baseX + lean * 0.22, baseY - flameH * 0.72, 0, baseX + lean * 0.22, baseY - flameH * 0.72, flameH * 0.72);
            smoke.addColorStop(0, "rgba(4, 0, 9, 0.72)");
            smoke.addColorStop(0.44, "rgba(22, 2, 32, 0.38)");
            smoke.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = smoke;
            ctx.beginPath();
            ctx.ellipse(baseX + lean * 0.12, baseY - flameH * 0.68, flameW * 2.2, flameH * 0.58, 0, 0, Math.PI * 2);
            ctx.fill();

            for (let layer = 0; layer < 8; layer++) {
              const t = time * (0.002 + layer * 0.0008) + candleTip.seed * (layer + 1);
              const offset = Math.sin(t * 3.1) * flameW * (0.06 + layer * 0.025);
              const topX = baseX + lean + offset;
              const topY = baseY - flameH * (0.76 + layer * 0.046);
              const cp1x = baseX - flameW * (0.6 + layer * 0.04) + Math.sin(t) * flameW * 0.18;
              const cp1y = baseY - flameH * (0.2 + layer * 0.03);
              const cp2x = baseX + flameW * (0.54 + layer * 0.035) + Math.cos(t * 1.7) * flameW * 0.16;
              const cp2y = baseY - flameH * (0.46 + layer * 0.035);
              const strokeAlpha = alpha * (0.26 - layer * 0.018);

              ctx.beginPath();
              ctx.moveTo(baseX + Math.sin(t) * flameW * 0.08, baseY);
              ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, topX, topY);
              ctx.lineWidth = Math.max(1, flameW * (0.9 - layer * 0.055));
              ctx.strokeStyle = "rgba(" + (26 + layer * 5) + ", " + (0 + layer * 2) + ", " + (42 + layer * 10) + ", " + strokeAlpha + ")";
              ctx.stroke();
            }

            const core = ctx.createLinearGradient(baseX, baseY, baseX + lean, baseY - flameH * 0.9);
            core.addColorStop(0, "rgba(12, 0, 18, 0.88)");
            core.addColorStop(0.16, "rgba(102, 18, 142, 0.82)");
            core.addColorStop(0.58, "rgba(38, 0, 62, 0.88)");
            core.addColorStop(1, "rgba(2, 0, 5, 0)");
            ctx.beginPath();
            ctx.moveTo(baseX - flameW * 0.28, baseY);
            ctx.bezierCurveTo(baseX - flameW * 0.9, baseY - flameH * 0.34, baseX + lean - flameW * 0.4, baseY - flameH * 0.7, baseX + lean, baseY - flameH);
            ctx.bezierCurveTo(baseX + lean + flameW * 0.38, baseY - flameH * 0.66, baseX + flameW * 0.82, baseY - flameH * 0.28, baseX + flameW * 0.28, baseY);
            ctx.closePath();
            ctx.fillStyle = core;
            ctx.fill();

            const foot = ctx.createRadialGradient(baseX, baseY - flameH * 0.08, 0, baseX, baseY - flameH * 0.08, flameH * 0.24);
            foot.addColorStop(0, "rgba(158, 38, 218, 0.72)");
            foot.addColorStop(0.36, "rgba(66, 4, 94, 0.44)");
            foot.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = foot;
            ctx.beginPath();
            ctx.ellipse(baseX, baseY - flameH * 0.04, flameW * 1.25, flameH * 0.12, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = alpha * 0.68;
            const ember = ctx.createLinearGradient(baseX, baseY, baseX, baseY - flameH * 0.56);
            ember.addColorStop(0, "rgba(122, 35, 176, 0.4)");
            ember.addColorStop(0.52, "rgba(86, 12, 132, 0.34)");
            ember.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = ember;
            ctx.beginPath();
            ctx.moveTo(baseX - flameW * 0.08, baseY);
            ctx.bezierCurveTo(baseX - flameW * 0.34, baseY - flameH * 0.22, baseX + lean - flameW * 0.16, baseY - flameH * 0.46, baseX + lean, baseY - flameH * 0.62);
            ctx.bezierCurveTo(baseX + lean + flameW * 0.12, baseY - flameH * 0.38, baseX + flameW * 0.28, baseY - flameH * 0.18, baseX + flameW * 0.08, baseY);
            ctx.closePath();
            ctx.fill();

            for (let i = 0; i < 7; i++) {
              const particleT = (time * 0.0015 + i * 0.19 + candleTip.seed) % 1;
              const px = baseX + Math.sin(i * 9.7 + time * 0.004) * flameW * 1.7;
              const py = baseY - particleT * flameH * 1.25;
              const pa = alpha * (1 - particleT) * 0.22;
              ctx.fillStyle = "rgba(72, 10, 108, " + pa + ")";
              ctx.beginPath();
              ctx.arc(px, py, Math.max(0.7, flameW * 0.12), 0, Math.PI * 2);
              ctx.fill();
            }

            ctx.restore();
          }

          function draw(time) {
            ctx.clearRect(0, 0, width, height);
            const elapsed = time - startTime;
            const alphas = candleTips.map((_candleTip, index) => flameAlpha(index, elapsed));
            page.style.setProperty("--mk-ritual-dim", ritualDim(elapsed, alphas).toFixed(3));
            candleTips.forEach((candleTip, index) => {
              const alpha = alphas[index];
              if (alpha > 0.01) {
                drawCandleLight(flameAnchor(candleTip), alpha);
              }
            });
            candleTips.forEach((candleTip, index) => {
              const alpha = alphas[index];
              if (alpha > 0.01) {
                drawFlame(candleTip, index, time, alpha);
              }
            });
            raf = requestAnimationFrame(draw);
          }

          page.addEventListener("mk:ritual-start", () => {
            startTime = performance.now();
          });
          resize();
          window.addEventListener("resize", resize, { passive: true });
          raf = requestAnimationFrame(draw);
          window.addEventListener("pagehide", () => cancelAnimationFrame(raf), { once: true });
        })();
        (() => {
          const canvas = document.querySelector("[data-mk-abyss]");
          if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
          }

          const ctx = canvas.getContext("2d");
          const particles = Array.from({ length: 72 }, (_, index) => ({
            angle: index * 0.78,
            radius: 40 + (index % 18) * 18,
            speed: 0.002 + (index % 7) * 0.0004,
            size: 0.6 + (index % 5) * 0.34
          }));
          let width = 0;
          let height = 0;
          let raf = 0;

          function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
            canvas.style.width = width + "px";
            canvas.style.height = height + "px";
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }

          function draw(time) {
            ctx.clearRect(0, 0, width, height);
            const cx = width * 0.56;
            const cy = height * 0.46;
            ctx.globalCompositeOperation = "lighter";

            for (const particle of particles) {
              const t = time * particle.speed;
              const orbit = particle.radius + Math.sin(t * 3) * 26;
              const x = cx + Math.cos(particle.angle + t) * orbit;
              const y = cy + Math.sin(particle.angle * 0.7 + t * 1.8) * orbit * 0.56;
              const alpha = 0.18 + Math.sin(t * 8 + particle.angle) * 0.12;

              ctx.beginPath();
              ctx.fillStyle = "rgba(215, 180, 81, " + Math.max(0.04, alpha) + ")";
              ctx.arc(x, y, particle.size, 0, Math.PI * 2);
              ctx.fill();
            }

            ctx.globalCompositeOperation = "source-over";
            raf = requestAnimationFrame(draw);
          }

          resize();
          window.addEventListener("resize", resize, { passive: true });
          raf = requestAnimationFrame(draw);
          window.addEventListener("pagehide", () => cancelAnimationFrame(raf), { once: true });
        })();
        (() => {
          const canvas = document.querySelector("[data-mk-portrait-noise]");
          if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
          }

          const ctx = canvas.getContext("2d");
          const noiseSize = 96;
          const imageData = ctx.createImageData(noiseSize, noiseSize);
          let raf = 0;
          let lastDraw = 0;

          function resize() {
            canvas.width = noiseSize;
            canvas.height = noiseSize;
          }

          function draw(time) {
            if (time - lastDraw > 86) {
              const data = imageData.data;
              for (let i = 0; i < data.length; i += 4) {
                const value = Math.random() * 255;
                data[i] = value;
                data[i + 1] = value * 0.92;
                data[i + 2] = value * 0.72;
                data[i + 3] = Math.random() > 0.58 ? 84 : 0;
              }

              ctx.putImageData(imageData, 0, 0);
              lastDraw = time;
            }

            raf = requestAnimationFrame(draw);
          }

          resize();
          raf = requestAnimationFrame(draw);
          window.addEventListener("pagehide", () => cancelAnimationFrame(raf), { once: true });
        })();
      </script>
    `
  });
}

function renderDesignSwitcher() {
  return `
    <div class="design-switcher" data-design-switcher aria-label="デザイン切り替え">
      <span>Design</span>
      <button type="button" data-design-option="classic" aria-pressed="true">Classic</button>
      <button type="button" data-design-option="modern" aria-pressed="false">Modern</button>
    </div>
  `;
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
  const hasRandomVideos = randomDriveVideoSets(randomVideoPlayer).length > 0;

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

function randomDriveVideoSourceItems(player) {
  if (!player) {
    return [];
  }

  if (player.videoSets && typeof player.videoSets === "object") {
    return Object.values(player.videoSets).flatMap((set) => Array.isArray(set?.videos) ? set.videos : []);
  }

  return Array.isArray(player.videos) ? player.videos : [];
}

function randomDriveVideoSets(player) {
  if (!player) {
    return [];
  }

  if (player.videoSets && typeof player.videoSets === "object") {
    return Object.entries(player.videoSets)
      .map(([key, set]) => randomDriveVideoSet(key, set))
      .filter((set) => set.videos.length > 0);
  }

  const videos = randomDriveVideos(player.videos, player.orientationFilter);
  return videos.length > 0
    ? [{
        key: player.orientationFilter ?? "videos",
        label: orientationLabel(player.orientationFilter ?? videos[0]?.orientation),
        orientation: player.orientationFilter ?? videos[0]?.orientation,
        videos
      }]
    : [];
}

function randomDriveVideoSet(key, set) {
  const videos = randomDriveVideos(set?.videos, set?.orientation ?? key);
  return {
    key,
    label: set?.label ?? orientationLabel(set?.orientation ?? key),
    orientation: set?.orientation ?? key,
    videos
  };
}

function randomDriveVideos(videos, orientation) {
  if (!Array.isArray(videos)) {
    return [];
  }

  return videos
    .filter((item) => item?.driveId)
    .map((item, index) => ({
      label: item.displayLabel ?? item.title ?? `${orientationLabel(item.orientation ?? orientation)} ${String(index + 1).padStart(2, "0")}`,
      sourceLabel: item.label ?? item.name ?? item.driveId,
      width: item.width,
      height: item.height,
      orientation: item.orientation,
      playbackUrl: item.playbackPath ?? item.playbackUrl ?? item.fileUrl,
      embedUrl: item.embedUrl ?? `https://drive.google.com/file/d/${item.driveId}/preview`
    }))
    .filter((item) => item.playbackUrl);
}

function orientationLabel(value) {
  if (value === "landscape") {
    return "横動画";
  }
  if (value === "portrait") {
    return "縦動画";
  }
  return "動画";
}

function renderOfficialRandomDriveVideoPlayer(player) {
  const videoSets = randomDriveVideoSets(player);
  if (videoSets.length === 0) {
    return "";
  }

  const title = player.title ?? "Random Videos";
  const description = player.description ?? "";
  const videos = videoSets[0].videos;
  const firstVideo = videos[0];
  const firstOrientation = videoSets[0].orientation ?? firstVideo.orientation ?? "portrait";

  return `
    <section class="panel wide video-panel" id="videos" data-random-drive-video-player>
      <h2 class="section-title">
        <span>${escapeHtml(title)}</span>
        <small>動画</small>
      </h2>
      ${description ? `<p class="section-note">${escapeHtml(description)}</p>` : ""}
      <div class="official-video-layout">
        <div class="official-video-frame" data-random-drive-video-shell data-video-orientation="${escapeHtml(firstOrientation)}">
          <video
            title="${escapeHtml(firstVideo.label)}"
            src="${escapeHtml(firstVideo.playbackUrl)}"
            autoplay
            muted
            controls
            playsinline
            preload="metadata"
            data-random-drive-video-frame
          ></video>
        </div>
        <div class="official-video-meta">
          <p class="eyebrow">Google Drive</p>
          <p class="official-video-title" data-random-drive-video-title>${escapeHtml(firstVideo.label)}</p>
          ${renderRandomDriveVideoToggle(videoSets, "official-video-toggle")}
          <div class="links official-video-actions">
            <button type="button" data-random-drive-video-next>ランダム再生</button>
            <button type="button" data-random-drive-video-unmute>音声ON</button>
            ${player.folderUrl ? `<a href="${escapeHtml(player.folderUrl)}" target="_blank" rel="noopener noreferrer">動画フォルダを開く</a>` : ""}
          </div>
        </div>
      </div>
      <script type="application/json" data-random-drive-video-data>${escapeScriptJson(videoSets)}</script>
    </section>
  `;
}

function renderMusicVideoPlayer(player) {
  if (!player?.embedUrl) {
    return "";
  }

  const title = player.title ?? "Music Videos";
  const description = player.description ?? "";
  const trackTitle = player.trackTitle ?? title;
  const trackSubtitle = player.trackSubtitle ?? "";
  const orientationOptions = Array.isArray(player.orientationOptions) && player.orientationOptions.length > 0
    ? player.orientationOptions
    : [
        { key: "portrait", label: "縦動画", aspectRatio: "9 / 16" },
        { key: "landscape", label: "横動画", aspectRatio: "16 / 9" }
      ];
  const firstOrientation = orientationOptions[0]?.key ?? "portrait";
  const firstAspectRatio = orientationOptions[0]?.aspectRatio ?? "9 / 16";

  return `
    <section class="panel wide video-panel music-video-panel" id="videos" data-music-video-player>
      <h2 class="section-title">
        <span>${escapeHtml(title)}</span>
        <small>動画</small>
      </h2>
      ${description ? `<p class="section-note">${escapeHtml(description)}</p>` : ""}
      <div class="official-video-layout">
        <div
          class="official-video-frame music-video-frame"
          data-music-video-frame
          data-video-orientation="${escapeHtml(firstOrientation)}"
          style="--video-aspect-ratio: ${escapeHtml(firstAspectRatio)};"
        >
          <iframe
            title="${escapeHtml(trackTitle)}"
            src="${escapeHtml(player.embedUrl)}"
            loading="lazy"
            referrerpolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
          ></iframe>
        </div>
        <div class="official-video-meta music-video-meta">
          <p class="eyebrow">YouTube Playlist</p>
          <div class="music-track-card">
            ${player.icon ? `<img src="./${escapeHtml(player.icon)}" alt="" loading="lazy">` : ""}
            <div>
              <p class="official-video-title">${escapeHtml(trackTitle)}</p>
              ${trackSubtitle ? `<p>${escapeHtml(trackSubtitle)}</p>` : ""}
            </div>
          </div>
          ${renderMusicVideoToggle(orientationOptions)}
          <div class="links official-video-actions">
            ${player.playlistUrl ? `<a href="${escapeHtml(player.playlistUrl)}" target="_blank" rel="noopener noreferrer">YouTubeで開く</a>` : ""}
          </div>
        </div>
      </div>
      <script type="application/json" data-music-video-options>${escapeScriptJson(orientationOptions)}</script>
    </section>
  `;
}

function renderMusicVideoToggle(options) {
  if (options.length < 2) {
    return "";
  }

  return `
    <div class="official-video-toggle" role="group" aria-label="動画の表示サイズ">
      ${options.map((option, index) => `
        <button
          type="button"
          data-music-video-orientation="${escapeHtml(option.key ?? "")}"
          aria-pressed="${index === 0 ? "true" : "false"}"
        >
          ${escapeHtml(option.label ?? orientationLabel(option.key))}
        </button>
      `).join("")}
    </div>
  `;
}

function renderRandomDriveVideoPlayer(player) {
  const videoSets = randomDriveVideoSets(player);
  if (videoSets.length === 0) {
    return "";
  }

  const title = player.title ?? "Random Videos";
  const description = player.description ?? "";
  const videos = videoSets[0].videos;
  const firstVideo = videos[0];
  const firstOrientation = videoSets[0].orientation ?? firstVideo.orientation ?? "portrait";

  return `
    <section class="retro-box retro-video-box" id="videos" data-random-drive-video-player>
      <h2>★ ${escapeHtml(title)} ★</h2>
      ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      ${renderRandomDriveVideoToggle(videoSets, "retro-video-toggle")}
      <div class="retro-video-frame" data-random-drive-video-shell data-video-orientation="${escapeHtml(firstOrientation)}">
        <video
          title="${escapeHtml(firstVideo.label)}"
          src="${escapeHtml(firstVideo.playbackUrl)}"
          autoplay
          muted
          controls
          playsinline
          preload="metadata"
          data-random-drive-video-frame
        ></video>
      </div>
      <p class="retro-video-title" data-random-drive-video-title>${escapeHtml(firstVideo.label)}</p>
      <div class="retro-video-actions">
        <button type="button" data-random-drive-video-next>ランダム再生</button>
        <button type="button" data-random-drive-video-unmute>音声ON</button>
        ${player.folderUrl ? `<a href="${escapeHtml(player.folderUrl)}" target="_blank" rel="noopener noreferrer">動画フォルダ</a>` : ""}
      </div>
      <script type="application/json" data-random-drive-video-data>${escapeScriptJson(videoSets)}</script>
    </section>
  `;
}

function renderRandomDriveVideoToggle(videoSets, className) {
  if (videoSets.length < 2) {
    return "";
  }

  return `
    <div class="${className}" role="group" aria-label="動画の向き">
      ${videoSets.map((set, index) => `
        <button type="button" data-random-drive-video-set="${escapeHtml(set.key)}" aria-pressed="${index === 0 ? "true" : "false"}">
          ${escapeHtml(set.label)}
          <span>${set.videos.length}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderRandomDriveVideoScript() {
  return `
    <script>
      (() => {
        for (const root of document.querySelectorAll("[data-music-video-player]")) {
          const frame = root.querySelector("[data-music-video-frame]");
          const data = root.querySelector("[data-music-video-options]");
          const buttons = Array.from(root.querySelectorAll("[data-music-video-orientation]"));
          if (!frame || buttons.length === 0) continue;

          let options = [];
          try {
            options = JSON.parse(data?.textContent || "[]");
          } catch {
            options = [];
          }

          for (const button of buttons) {
            button.addEventListener("click", () => {
              const option = options.find((item) => item.key === button.dataset.musicVideoOrientation);
              if (!option) return;
              frame.dataset.videoOrientation = option.key || "";
              frame.style.setProperty("--video-aspect-ratio", option.aspectRatio || "16 / 9");
              for (const item of buttons) {
                item.setAttribute("aria-pressed", item === button ? "true" : "false");
              }
            });
          }
        }

        for (const root of document.querySelectorAll("[data-random-drive-video-player]")) {
          const data = root.querySelector("[data-random-drive-video-data]");
          const frame = root.querySelector("[data-random-drive-video-frame]");
          const shell = root.querySelector("[data-random-drive-video-shell]");
          const title = root.querySelector("[data-random-drive-video-title]");
          const next = root.querySelector("[data-random-drive-video-next]");
          const unmute = root.querySelector("[data-random-drive-video-unmute]");
          const setButtons = Array.from(root.querySelectorAll("[data-random-drive-video-set]"));
          if (!data || !frame || !next) continue;

          let parsed = [];
          try {
            parsed = JSON.parse(data.textContent || "[]");
          } catch {
            parsed = [];
          }

          const sets = Array.isArray(parsed) && parsed.some((item) => Array.isArray(item?.videos))
            ? parsed
            : [{ key: "videos", label: "動画", orientation: parsed[0]?.orientation, videos: parsed }];
          if (sets.length === 0 || !Array.isArray(sets[0].videos) || sets[0].videos.length === 0) continue;

          let activeSet = sets[0];
          let videos = activeSet.videos;
          let currentIndex = -1;
          const updateMuteButton = () => {
            if (!unmute) return;
            unmute.textContent = frame.muted ? "音声ON" : "音声OFF";
          };

          const updateSetButtons = () => {
            for (const button of setButtons) {
              button.setAttribute("aria-pressed", button.dataset.randomDriveVideoSet === activeSet.key ? "true" : "false");
            }
          };

          const playCurrent = async () => {
            try {
              await frame.play?.();
            } catch {
              frame.muted = true;
              updateMuteButton();
              await frame.play?.().catch(() => {});
            }
          };

          const showVideo = () => {
            let index = Math.floor(Math.random() * videos.length);
            if (videos.length > 1 && index === currentIndex) {
              index = (index + 1) % videos.length;
            }
            currentIndex = index;
            const video = videos[index];
            frame.src = video.playbackUrl || video.embedUrl;
            frame.title = video.label;
            if (title) title.textContent = video.label;
            if (shell) shell.dataset.videoOrientation = activeSet.orientation || video.orientation || "";
            frame.load?.();
            playCurrent();
          };

          for (const button of setButtons) {
            button.addEventListener("click", () => {
              const nextSet = sets.find((set) => set.key === button.dataset.randomDriveVideoSet);
              if (!nextSet || nextSet === activeSet || !Array.isArray(nextSet.videos) || nextSet.videos.length === 0) return;
              activeSet = nextSet;
              videos = activeSet.videos;
              currentIndex = -1;
              updateSetButtons();
              showVideo();
            });
          }

          next.addEventListener("click", showVideo);
          unmute?.addEventListener("click", async () => {
            frame.muted = !frame.muted;
            updateMuteButton();
            await playCurrent();
          });
          frame.addEventListener?.("volumechange", updateMuteButton);
          frame.addEventListener?.("ended", showVideo);
          updateMuteButton();
          updateSetButtons();
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
    ["videos", sectionLabels.videos.en],
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
    if (id === "videos") {
      return Boolean(character.musicVideoPlayer) || randomDriveVideoSets(character.randomVideoPlayer).length > 0;
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

function renderTimelineGroups(character) {
  const timeline = character.timeline ?? [];
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
              <div class="timeline-marker">
                ${renderTimelineDate(item.date)}
              </div>
              <figure class="timeline-media">
                <img src="${escapeHtml(timelineImageSrc(item))}" alt="${escapeHtml(timelineImageAlt(item, character))}" loading="lazy">
              </figure>
              <div class="timeline-copy">
                <h3>${escapeHtml(item.event)}</h3>
                ${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ""}
                ${timelineImageCaption(item) ? `<p class="timeline-image-caption">${escapeHtml(timelineImageCaption(item))}</p>` : ""}
              </div>
            </li>
          `).join("")}
        </ol>
      </section>
    `)
    .join("");
}

function timelineImageData(item) {
  if (!item?.image) {
    return null;
  }

  if (typeof item.image === "string") {
    return { path: item.image };
  }

  if (typeof item.image === "object" && item.image.path) {
    return item.image;
  }

  return null;
}

function timelineImageSrc(item) {
  const image = timelineImageData(item);
  if (!image) {
    return "./assets/generated/timeline-noimage.webp";
  }

  if (/^https?:\/\//.test(image.path)) {
    return image.path;
  }

  return `./${image.path.replace(/^\.?\//, "")}`;
}

function timelineImageAlt(item, character) {
  const image = timelineImageData(item);
  return image?.alt ?? `${character.displayName} 年表: ${item.event}`;
}

function timelineImageCaption(item) {
  return timelineImageData(item)?.caption ?? "";
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

${renderPromptVisualReferenceNote(character, { forVisualGeneration: false })}

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

${renderPromptVisualReferenceNote(character, { forVisualGeneration: false })}

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

function renderPromptVisualReferenceNote(character, { forVisualGeneration = false } = {}) {
  if (!Array.isArray(character.visualReferences) || character.visualReferences.length === 0) {
    return "";
  }

  const baseCount = character.visualReferences.filter((item) => item.source !== "google-drive").length;
  const driveCount = character.visualReferences.filter((item) => item.source === "google-drive").length;
  const referencesLabel = forVisualGeneration ? "image-default.md / video-default.md" : "image-default.md";
  const visualPageUrl = absoluteUrl(`${character.id}/#visual`);
  const driveUrl = findOfficialDriveUrl(character);
  const lines = [
    "## Visual Reference Note",
    "",
    `- ビジュアル資料の全件列挙はここでは省略する。`,
    `- 基本資料: ${baseCount}件、Google Drive由来の追加資料: ${driveCount}件。`,
    `- 詳細な参照画像とURLは \`${referencesLabel}\` と公式サイトの Visual セクションを参照: ${visualPageUrl}`
  ];

  if (driveUrl) {
    lines.push(`- 元の追加資料フォルダ: ${driveUrl}`);
  }

  return lines.join("\n");
}

function renderPromptVisualReferencesMarkdown(character, { maxDriveItems = 8 } = {}) {
  if (!Array.isArray(character.visualReferences) || character.visualReferences.length === 0) {
    return "";
  }

  const baseReferences = character.visualReferences.filter((item) => item.source !== "google-drive");
  const driveReferences = character.visualReferences.filter((item) => item.source === "google-drive");
  const selected = [...baseReferences, ...driveReferences.slice(0, maxDriveItems)];
  const lines = selected.map((item) => {
    const detail = item.description ? `: ${item.description}` : "";
    const urls = [];
    const previewUrl = visualReferencePreviewUrl(character, item);
    if (previewUrl) {
      urls.push(`preview=${previewUrl}`);
    }
    if (item.path) {
      urls.push(`sourcePath=${item.path}`);
    }
    return `- ${item.label}${detail}${urls.length ? ` (${urls.join(", ")})` : ""}`;
  });

  if (driveReferences.length > maxDriveItems) {
    lines.push(`- 追加のGoogle Drive資料は ${driveReferences.length - maxDriveItems}件省略。詳細は公式サイトの Visual セクションを参照: ${absoluteUrl(`${character.id}/#visual`)}`);
  }

  const driveUrl = findOfficialDriveUrl(character);
  if (driveUrl) {
    lines.push(`- Drive folder: ${driveUrl}`);
  }

  return `## Visual References

${lines.join("\n")}`;
}

function visualReferencePreviewUrl(character, item) {
  if (!item?.path) {
    return null;
  }

  const baseName = path.parse(item.path).name;
  return absoluteUrl(`${character.id}/assets/generated/${baseName}-large.webp`);
}

function findOfficialDriveUrl(character) {
  const links = [...(character.contentLinks ?? []), ...(character.links ?? [])];
  const driveLink = links.find((link) => /drive\.google\.com/i.test(link?.url ?? ""));
  return driveLink?.url ?? null;
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

${renderPromptVisualReferencesMarkdown(character)}

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

${renderPromptVisualReferencesMarkdown(character)}

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

function htmlPage({ title, body, theme, description, urlPath = "", imagePath, type = "website", structuredData, headExtra = "", stylesheetHref }) {
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
    <link rel="stylesheet" href="${escapeHtml(stylesheetHref ?? (title === "Character Canon" ? "./styles.css" : "../styles.css"))}">
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
    { loc: absoluteUrl("docs/codex-beginner-manual.html"), priority: "0.5" },
    ...characters.flatMap((character) => [
      { loc: absoluteUrl(`${character.id}/`), priority: "1.0" },
      ...(character.id === "zannenin" ? [
        { loc: absoluteUrl(`${character.id}/manzokukyo/`), priority: "0.7" },
        { loc: absoluteUrl(`${character.id}/desktopchillko/`), priority: "0.7" },
      ] : []),
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
  const designSwitcher = document.querySelector("[data-design-switcher]");
  if (designSwitcher) {
    const storageKey = "character-canon-design";
    const options = Array.from(designSwitcher.querySelectorAll("[data-design-option]"));
    const applyDesign = (value) => {
      const design = value === "modern" ? "modern" : "classic";
      document.body.dataset.design = design;
      for (const option of options) {
        option.setAttribute("aria-pressed", option.dataset.designOption === design ? "true" : "false");
      }
    };

    applyDesign(localStorage.getItem(storageKey));
    for (const option of options) {
      option.addEventListener("click", () => {
        const design = option.dataset.designOption;
        localStorage.setItem(storageKey, design);
        applyDesign(design);
      });
    }
  }

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

.official-video-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(260px, 0.55fr);
  gap: 18px;
  align-items: stretch;
}

.official-video-frame {
  justify-self: center;
  overflow: hidden;
  width: min(100%, 420px);
  aspect-ratio: 9 / 16;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #000000;
  box-shadow: 0 18px 42px rgba(21, 18, 23, 0.12);
}

.official-video-frame[data-video-orientation="landscape"] {
  width: min(100%, 680px);
  aspect-ratio: 16 / 9;
}

.music-video-frame,
.music-video-frame[data-video-orientation="landscape"],
.music-video-frame[data-video-orientation="portrait"] {
  width: min(100%, 680px);
  aspect-ratio: var(--video-aspect-ratio, 16 / 9);
}

.official-video-frame video,
.official-video-frame iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  object-fit: contain;
}

.official-video-meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  padding: 18px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: color-mix(in srgb, var(--theme-paper) 68%, #ffffff);
}

.official-video-title {
  overflow-wrap: anywhere;
  color: var(--theme-text);
  font-weight: 800;
}

.music-track-card {
  display: grid;
  grid-template-columns: 68px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #ffffff;
}

.music-track-card img {
  display: block;
  width: 68px;
  height: 68px;
  border-radius: 8px;
  object-fit: cover;
  background: var(--theme-paper);
}

.music-track-card p {
  margin: 0;
}

.music-track-card .official-video-title {
  margin-bottom: 4px;
}

.official-video-toggle {
  display: inline-flex;
  width: fit-content;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: #fff7df;
}

.official-video-toggle button {
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 999px;
  padding: 7px 12px;
  background: transparent;
  color: var(--theme-muted);
  font: 900 0.86rem/1.2 "Zen Kaku Gothic New", sans-serif;
  cursor: pointer;
}

.official-video-toggle button[aria-pressed="true"] {
  background: var(--theme-primary);
  color: #ffffff;
}

.official-video-toggle span {
  min-width: 1.6em;
  border-radius: 999px;
  padding: 2px 6px;
  background: rgba(255, 255, 255, 0.22);
}

.official-video-actions {
  margin-top: 0;
}

.official-video-actions button {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  border: 1px solid #e8d29b;
  border-radius: 999px;
  padding: 8px 14px;
  background: var(--theme-primary);
  color: #ffffff;
  font: 900 0.9rem/1.2 "Zen Kaku Gothic New", sans-serif;
  cursor: pointer;
  box-shadow: 0 8px 16px rgba(21, 18, 23, 0.08);
}

.official-video-actions button:hover,
.official-video-actions button:focus-visible {
  background: var(--theme-secondary);
  color: #ffffff;
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

.detail-settings {
  grid-column: 1 / -1;
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
  grid-template-columns: minmax(132px, 0.4fr) 1fr;
  gap: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

dt {
  color: var(--accent-dark);
  font-weight: 700;
  overflow-wrap: normal;
  word-break: keep-all;
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
  position: relative;
  display: grid;
  gap: 18px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.timeline::before {
  content: "";
  position: absolute;
  top: 8px;
  bottom: 8px;
  left: 83px;
  width: 2px;
  background: linear-gradient(180deg, var(--theme-secondary), color-mix(in srgb, var(--theme-secondary) 18%, transparent));
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
  position: relative;
  display: grid;
  grid-template-columns: 170px minmax(132px, 220px) minmax(0, 1fr);
  gap: 18px;
  align-items: stretch;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 12px 28px rgba(21, 18, 23, 0.07);
}

.timeline li::before {
  content: "";
  position: absolute;
  left: 76px;
  top: 50%;
  z-index: 1;
  width: 16px;
  height: 16px;
  transform: translateY(-50%);
  border: 3px solid var(--theme-secondary);
  border-radius: 999px;
  background: var(--theme-primary);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--theme-secondary) 18%, #ffffff);
}

.timeline-marker {
  position: relative;
  z-index: 2;
  display: grid;
  align-content: center;
  min-width: 0;
}

.timeline-media {
  position: relative;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  aspect-ratio: 1 / 1;
  border: 1px solid color-mix(in srgb, var(--theme-secondary) 38%, var(--line));
  border-radius: 8px;
  background: color-mix(in srgb, var(--theme-accent) 40%, #ffffff);
}

.timeline-media img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.timeline-copy {
  min-width: 0;
  align-self: center;
}

.timeline-copy h3 {
  margin-bottom: 8px;
}

.timeline-image-caption {
  margin-top: 10px;
  color: var(--theme-muted);
  font-size: 0.84rem;
  font-weight: 800;
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
  width: min(100%, 360px);
  margin: 0 auto;
  overflow: hidden;
  aspect-ratio: 9 / 16;
  border: 4px ridge #99ccff;
  background: #000000;
}

.retro-video-frame[data-video-orientation="landscape"] {
  width: min(100%, 560px);
  aspect-ratio: 16 / 9;
}

.retro-video-frame video,
.retro-video-frame iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  object-fit: contain;
}

.retro-video-title {
  word-break: break-word;
}

.retro-video-toggle {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin: 8px 0;
}

.retro-video-toggle button {
  padding: 4px 10px;
  border: 3px outset #c0c0c0;
  border-radius: 0;
  background: #ccffcc;
  color: #000080;
  font: 700 0.92rem/1.3 "MS PGothic", sans-serif;
  cursor: pointer;
}

.retro-video-toggle button[aria-pressed="true"] {
  border-style: inset;
  background: #ffff99;
  color: #cc0000;
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

.design-switcher {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 50;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px;
  border: 1px solid rgba(21, 18, 23, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 16px 38px rgba(21, 18, 23, 0.16);
  backdrop-filter: blur(14px);
}

.design-switcher span {
  padding: 0 8px;
  color: var(--theme-muted);
  font-size: 0.76rem;
  font-weight: 900;
  text-transform: uppercase;
}

.design-switcher button {
  min-height: 34px;
  border: 0;
  border-radius: 999px;
  padding: 7px 12px;
  background: transparent;
  color: var(--theme-primary);
  font: inherit;
  font-size: 0.84rem;
  font-weight: 900;
  cursor: pointer;
}

.design-switcher button[aria-pressed="true"] {
  background: var(--theme-primary);
  color: #ffffff;
}

body[data-design="modern"] {
  --modern-ink: color-mix(in srgb, var(--theme-primary) 82%, #17141b);
  --modern-soft: color-mix(in srgb, var(--theme-accent) 52%, #ffffff);
  --modern-line: color-mix(in srgb, var(--theme-secondary) 26%, rgba(21, 18, 23, 0.14));
  --modern-shadow: 0 22px 60px rgba(20, 18, 24, 0.12);
  color: var(--modern-ink);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--theme-accent) 30%, #ffffff) 0%, #ffffff 38%, color-mix(in srgb, var(--theme-paper) 76%, #ffffff) 100%);
  background-size: auto;
}

body[data-design="modern"] a {
  text-decoration-thickness: 0.06em;
  text-underline-offset: 0.24em;
}

body[data-design="modern"] .design-switcher {
  border-color: rgba(255, 255, 255, 0.34);
  background: rgba(18, 16, 24, 0.78);
  box-shadow: 0 18px 46px rgba(18, 16, 24, 0.22);
}

body[data-design="modern"] .design-switcher span {
  color: rgba(255, 255, 255, 0.68);
}

body[data-design="modern"] .design-switcher button {
  color: rgba(255, 255, 255, 0.88);
}

body[data-design="modern"] .design-switcher button[aria-pressed="true"] {
  background: #ffffff;
  color: var(--modern-ink);
}

body[data-design="modern"] .character-hero {
  display: grid;
  min-height: min(820px, 82vh);
  align-content: end;
  padding: 30px 0 54px;
  isolation: isolate;
  background:
    linear-gradient(180deg, rgba(18, 16, 24, 0.1), rgba(18, 16, 24, 0.66)),
    linear-gradient(120deg, color-mix(in srgb, var(--theme-primary) 82%, #111111), color-mix(in srgb, var(--theme-secondary) 48%, #222222));
  border-bottom: 0;
}

body[data-design="modern"] .character-hero::before {
  inset: 0;
  z-index: 1;
  height: auto;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0) 64%, color-mix(in srgb, var(--theme-accent) 42%, #ffffff) 100%);
  pointer-events: none;
}

body[data-design="modern"] .brand-banner-shell {
  position: absolute;
  top: 30px;
  left: 50%;
  z-index: 0;
  width: min(1760px, calc(100% - 48px));
  margin: 0;
  transform: translateX(-50%);
}

body[data-design="modern"] .brand-banner {
  aspect-ratio: 21 / 8;
  border: 0;
  border-radius: 8px;
  box-shadow: 0 30px 90px rgba(0, 0, 0, 0.34);
  filter: saturate(1.06) contrast(1.02);
}

body[data-design="modern"] .character-hero .shell {
  z-index: 2;
  width: min(1180px, calc(100% - 56px));
  margin-top: 0;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent;
  box-shadow: none;
  color: #ffffff;
}

body[data-design="modern"] .back-link {
  min-height: 36px;
  margin-bottom: 24px;
  border-color: rgba(255, 255, 255, 0.34);
  background: rgba(255, 255, 255, 0.14);
  color: #ffffff;
  backdrop-filter: blur(12px);
}

body[data-design="modern"] .eyebrow,
body[data-design="modern"] .status {
  color: color-mix(in srgb, var(--theme-secondary) 74%, #ffffff);
}

body[data-design="modern"] .character-hero h1 {
  max-width: 980px;
  color: #ffffff;
  font-size: clamp(3.7rem, 8vw, 7.4rem);
  line-height: 0.98;
  text-shadow: 0 18px 54px rgba(0, 0, 0, 0.34);
}

body[data-design="modern"] .character-hero .catchphrase,
body[data-design="modern"] .character-hero .lead {
  max-width: 760px;
  color: rgba(255, 255, 255, 0.86);
  font-size: 1.08rem;
  text-shadow: 0 10px 34px rgba(0, 0, 0, 0.32);
}

body[data-design="modern"] .character-hero .catchphrase {
  color: #ffffff;
}

body[data-design="modern"] .hero-facts {
  max-width: 860px;
  gap: 8px;
}

body[data-design="modern"] .hero-facts span {
  min-height: 42px;
  border-color: rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.16);
  box-shadow: none;
  color: #ffffff;
  backdrop-filter: blur(12px);
}

body[data-design="modern"] .hero-facts strong {
  color: rgba(255, 255, 255, 0.7);
}

body[data-design="modern"] .page-menu {
  top: 0;
  border-bottom: 1px solid rgba(21, 18, 23, 0.08);
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 12px 34px rgba(21, 18, 23, 0.08);
}

body[data-design="modern"] .page-menu-inner {
  width: min(1320px, calc(100% - 40px));
  padding-top: 9px;
  padding-bottom: 9px;
}

body[data-design="modern"] .page-menu-label {
  background: transparent;
  color: var(--theme-muted);
}

body[data-design="modern"] .page-menu a {
  min-height: 36px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  box-shadow: none;
  color: var(--modern-ink);
}

body[data-design="modern"] .page-menu a:hover,
body[data-design="modern"] .page-menu a:focus-visible,
body[data-design="modern"] .page-menu a.is-active,
body[data-design="modern"] .page-menu a[aria-current="true"] {
  background: var(--modern-ink);
  color: #ffffff;
}

body[data-design="modern"] .content-layout {
  width: min(1320px, calc(100% - 40px));
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 16px;
  padding: 34px 0 88px;
}

body[data-design="modern"] .content-layout > .wide,
body[data-design="modern"] .content-layout > .source-callout,
body[data-design="modern"] .content-layout > .hidden-entrances {
  grid-column: 1 / -1;
}

body[data-design="modern"] .content-layout > #links,
body[data-design="modern"] .content-layout > #fanworks {
  grid-column: span 5;
}

body[data-design="modern"] .content-layout > #prompts {
  grid-column: span 7;
}

body[data-design="modern"] .content-layout > #videos,
body[data-design="modern"] .content-layout > #visual,
body[data-design="modern"] .content-layout > #settings,
body[data-design="modern"] .content-layout > #timeline,
body[data-design="modern"] .content-layout > #rights {
  grid-column: 1 / -1;
}

body[data-design="modern"] .content-layout > .detail-layout {
  grid-column: 1 / -1;
  grid-template-columns: minmax(0, 0.44fr) minmax(0, 0.56fr);
  gap: 16px;
}

body[data-design="modern"] .panel,
body[data-design="modern"] .source-callout {
  border: 1px solid var(--modern-line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.84);
  box-shadow: var(--modern-shadow);
  backdrop-filter: blur(16px);
}

body[data-design="modern"] .panel::before {
  display: none;
}

body[data-design="modern"] .panel h2 {
  font-size: 1.22rem;
}

body[data-design="modern"] .section-title {
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
}

body[data-design="modern"] .section-title small::before {
  content: "";
}

body[data-design="modern"] .section-title small {
  border: 1px solid var(--modern-line);
  border-radius: 999px;
  padding: 4px 9px;
  background: var(--modern-soft);
  color: var(--theme-primary);
  font-size: 0.72rem;
}

body[data-design="modern"] .official-links {
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--theme-primary) 88%, #111111), color-mix(in srgb, var(--theme-secondary) 42%, #1f1a24));
}

body[data-design="modern"] .link-list {
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}

body[data-design="modern"] .link-card,
body[data-design="modern"] .music-track-card,
body[data-design="modern"] .official-video-meta {
  border-radius: 8px;
}

body[data-design="modern"] .link-card {
  min-height: 82px;
  background: rgba(255, 255, 255, 0.1);
}

body[data-design="modern"] .profile-list {
  gap: 0;
}

body[data-design="modern"] .profile-list div {
  grid-template-columns: minmax(112px, 0.34fr) 1fr;
  gap: 14px;
  padding: 14px 0;
}

body[data-design="modern"] dt {
  color: var(--theme-muted);
  font-size: 0.9rem;
}

body[data-design="modern"] dd {
  color: var(--modern-ink);
  font-size: 1.04rem;
}

body[data-design="modern"] .stack article {
  padding: 0 0 16px;
  border-bottom: 1px solid var(--modern-line);
}

body[data-design="modern"] .stack article:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

body[data-design="modern"] .visual-archive {
  border-color: var(--modern-line);
  background: var(--modern-soft);
}

body[data-design="modern"] .visual-link img {
  border-color: var(--modern-line);
  box-shadow: 0 16px 38px rgba(21, 18, 23, 0.1);
}

body[data-design="modern"] .visual-card figcaption {
  font-size: 0.86rem;
}

body[data-design="modern"] .official-video-layout {
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.42fr);
}

body[data-design="modern"] .official-video-frame {
  width: min(100%, 460px);
  border: 0;
  box-shadow: 0 24px 58px rgba(21, 18, 23, 0.16);
}

body[data-design="modern"] .official-video-frame[data-video-orientation="landscape"],
body[data-design="modern"] .music-video-frame,
body[data-design="modern"] .music-video-frame[data-video-orientation="landscape"],
body[data-design="modern"] .music-video-frame[data-video-orientation="portrait"] {
  width: min(100%, 820px);
}

body[data-design="modern"] .source-callout {
  grid-template-columns: minmax(0, 1fr) auto;
  margin-top: 10px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.9), color-mix(in srgb, var(--theme-accent) 34%, #ffffff));
}

body[data-design="modern"] .timeline li {
  grid-template-columns: 160px 1fr;
}

@media (min-width: 901px) {
  body[data-design="modern"] .character-hero .shell {
    transform: translateY(58px);
  }

  body[data-design="modern"] .character-hero h1 {
    max-width: 760px;
    font-size: clamp(3.2rem, 5.6vw, 5.7rem);
  }

  body[data-design="modern"] .character-hero .hero-facts {
    display: none;
  }
}

@media (min-width: 1500px) {
  body[data-design="modern"] .content-layout {
    width: min(1640px, calc(100% - 80px));
    gap: 20px;
  }

  body[data-design="modern"] .character-hero .shell {
    width: min(1400px, calc(100% - 96px));
  }

  body[data-design="modern"] .content-layout > #links {
    grid-column: span 4;
  }

  body[data-design="modern"] .content-layout > #fanworks {
    grid-column: span 4;
  }

  body[data-design="modern"] .content-layout > #prompts {
    grid-column: span 8;
  }

  body[data-design="modern"] .content-layout > .detail-layout {
    grid-template-columns: minmax(420px, 0.34fr) minmax(0, 0.66fr);
  }
}

@media (max-width: 900px) {
  body[data-design="modern"] .character-hero {
    min-height: auto;
    padding: 14px 0 36px;
  }

  body[data-design="modern"] .brand-banner-shell {
    position: relative;
    top: auto;
    left: auto;
    transform: none;
    width: min(100%, calc(100% - 20px));
    margin-bottom: 18px;
  }

  body[data-design="modern"] .brand-banner {
    aspect-ratio: 16 / 9;
  }

  body[data-design="modern"] .character-hero .shell {
    width: min(100%, calc(100% - 28px));
  }

  body[data-design="modern"] .character-hero h1 {
    max-width: 100%;
    font-size: clamp(2.45rem, 14vw, 3.6rem);
    line-height: 1.05;
  }

  body[data-design="modern"] .character-hero .lead,
  body[data-design="modern"] .character-hero .catchphrase {
    font-size: 1rem;
  }

  body[data-design="modern"] .hero-facts span {
    max-width: 100%;
    white-space: normal;
  }

  body[data-design="modern"] .page-menu-inner,
  body[data-design="modern"] .content-layout {
    width: min(100%, calc(100% - 20px));
  }

  body[data-design="modern"] .page-menu-label {
    display: none;
  }

  body[data-design="modern"] .content-layout,
  body[data-design="modern"] .content-layout > .detail-layout {
    grid-template-columns: 1fr;
  }

  body[data-design="modern"] .content-layout > #links,
  body[data-design="modern"] .content-layout > #fanworks,
  body[data-design="modern"] .content-layout > #prompts {
    grid-column: 1;
  }

  body[data-design="modern"] .official-video-layout,
  body[data-design="modern"] .source-callout {
    grid-template-columns: 1fr;
  }

  body[data-design="modern"] .profile-list div,
  body[data-design="modern"] .timeline li {
    grid-template-columns: 1fr;
  }

  .design-switcher {
    right: 10px;
    top: 10px;
    bottom: auto;
    max-width: calc(100% - 20px);
  }

  .design-switcher span {
    display: none;
  }
}

body[data-design="modern"] .character-hero {
  display: block;
  min-height: auto;
  padding: 0 0 56px;
  overflow: clip;
  background:
    linear-gradient(180deg, #151318 0%, color-mix(in srgb, var(--theme-paper) 70%, #ffffff) 100%);
}

body[data-design="modern"] .character-hero::before {
  inset: 0 0 auto;
  z-index: 1;
  height: clamp(320px, 58vh, 690px);
  background:
    linear-gradient(180deg, rgba(10, 9, 12, 0.12) 0%, rgba(10, 9, 12, 0.05) 46%, rgba(10, 9, 12, 0.74) 100%);
}

body[data-design="modern"] .brand-banner-shell {
  position: relative;
  top: auto;
  left: auto;
  z-index: 0;
  width: 100%;
  height: clamp(320px, 58vh, 690px);
  margin: 0;
  transform: none;
}

body[data-design="modern"] .brand-banner {
  width: 100%;
  height: 100%;
  aspect-ratio: auto;
  border-radius: 0;
  object-fit: cover;
  object-position: center;
  box-shadow: none;
}

body[data-design="modern"] .character-hero .shell {
  z-index: 2;
  display: grid;
  width: min(1320px, calc(100% - 56px));
  grid-template-columns: minmax(0, 1fr) minmax(300px, 420px);
  gap: 18px 30px;
  margin-top: -78px;
  padding: 30px;
  transform: none;
  border: 1px solid rgba(255, 255, 255, 0.44);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0.72)),
    color-mix(in srgb, var(--theme-paper) 82%, #ffffff);
  box-shadow: 0 28px 82px rgba(17, 15, 20, 0.2);
  color: var(--modern-ink);
  backdrop-filter: blur(18px);
}

body[data-design="modern"] .character-hero .back-link {
  grid-column: 1 / -1;
  width: fit-content;
  margin: 0;
  border-color: color-mix(in srgb, var(--theme-primary) 16%, transparent);
  background: color-mix(in srgb, var(--theme-primary) 8%, #ffffff);
  color: var(--modern-ink);
  box-shadow: none;
}

body[data-design="modern"] .character-hero .eyebrow {
  grid-column: 1;
  margin: 4px 0 -8px;
  color: var(--theme-secondary);
}

body[data-design="modern"] .character-hero h1 {
  grid-column: 1;
  max-width: 760px;
  color: var(--modern-ink);
  font-size: clamp(3.2rem, 5.6vw, 5.8rem);
  line-height: 1;
  text-shadow: none;
}

body[data-design="modern"] .character-hero .catchphrase,
body[data-design="modern"] .character-hero .lead {
  grid-column: 1;
  max-width: 800px;
  color: color-mix(in srgb, var(--modern-ink) 76%, #5d5965);
  text-shadow: none;
}

body[data-design="modern"] .character-hero .catchphrase {
  margin-bottom: -2px;
  color: var(--modern-ink);
  font-size: 1.1rem;
}

body[data-design="modern"] .character-hero .hero-facts {
  display: grid;
  grid-column: 2;
  grid-row: 2 / span 4;
  align-self: end;
  gap: 0;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--modern-line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.68);
}

body[data-design="modern"] .character-hero .hero-facts span {
  min-height: 52px;
  justify-content: space-between;
  border: 0;
  border-bottom: 1px solid var(--modern-line);
  border-radius: 0;
  padding: 12px 15px;
  background: transparent;
  box-shadow: none;
  color: var(--modern-ink);
  white-space: normal;
}

body[data-design="modern"] .character-hero .hero-facts span:last-child {
  border-bottom: 0;
}

body[data-design="modern"] .character-hero .hero-facts strong {
  color: var(--theme-muted);
}

body[data-design="modern"] .content-layout {
  padding-top: 42px;
}

body[data-design="modern"] .panel,
body[data-design="modern"] .source-callout {
  padding: 28px;
  border-color: rgba(28, 24, 32, 0.1);
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 18px 54px rgba(20, 18, 24, 0.08);
}

body[data-design="modern"] .official-links {
  background:
    linear-gradient(145deg, rgba(14, 13, 18, 0.96), color-mix(in srgb, var(--theme-primary) 74%, #2c2630)),
    var(--theme-primary);
}

body[data-design="modern"] .visual-references {
  padding: 32px;
}

body[data-design="modern"] .visual-grid {
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
}

body[data-design="modern"] .visual-base .visual-link {
  width: min(100%, 1080px);
}

body[data-design="modern"] .detail-layout .panel,
body[data-design="modern"] #settings,
body[data-design="modern"] #timeline {
  background: rgba(255, 255, 255, 0.9);
}

body[data-design="modern"] .stack article h3 {
  font-size: 1.08rem;
}

body[data-design="modern"] .timeline-group-heading {
  align-items: start;
}

body[data-design="modern"] .timeline li {
  padding: 18px 0;
}

@media (min-width: 901px) {
  body[data-design="modern"] .character-hero .shell {
    transform: none;
  }

  body[data-design="modern"] .character-hero .hero-facts {
    display: grid;
  }
}

@media (max-width: 900px) {
  body[data-design="modern"] .character-hero {
    padding-bottom: 32px;
  }

  body[data-design="modern"] .character-hero::before,
  body[data-design="modern"] .brand-banner-shell {
    height: clamp(220px, 36vh, 330px);
  }

  body[data-design="modern"] .character-hero .shell {
    width: min(100%, calc(100% - 20px));
    grid-template-columns: 1fr;
    gap: 14px;
    margin-top: -34px;
    padding: 18px;
  }

  body[data-design="modern"] .character-hero .eyebrow,
  body[data-design="modern"] .character-hero h1,
  body[data-design="modern"] .character-hero .catchphrase,
  body[data-design="modern"] .character-hero .lead,
  body[data-design="modern"] .character-hero .hero-facts {
    grid-column: 1;
    grid-row: auto;
  }

  body[data-design="modern"] .character-hero h1 {
    font-size: clamp(2.35rem, 13vw, 3.45rem);
  }

  body[data-design="modern"] .character-hero .hero-facts {
    display: none;
  }

  body[data-design="modern"] .panel,
  body[data-design="modern"] .source-callout,
  body[data-design="modern"] .visual-references {
    padding: 20px;
  }
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
  .content-layout:not(.guideline-layout) #videos,
  .content-layout:not(.guideline-layout) #settings,
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

  .content-layout:not(.guideline-layout) .detail-settings {
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

@media (max-width: 980px) {
  .profile-list div,
  .timeline li {
    grid-template-columns: 1fr;
    gap: 6px;
  }
}

@media (max-width: 760px) {
  .shell {
    width: min(calc(100% - 20px), 520px);
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
    width: min(calc(100% - 18px), 1120px);
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
    overflow-wrap: anywhere;
    word-break: normal;
    line-break: auto;
    text-wrap: pretty;
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

  .official-video-layout {
    grid-template-columns: 1fr;
  }

  .official-video-meta {
    padding: 14px;
  }

  .official-video-actions button {
    width: 100%;
    justify-content: center;
    min-height: 42px;
  }

  .link-group + .link-group {
    margin-top: 16px;
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

  .timeline::before {
    left: 20px;
  }

  .timeline li {
    grid-template-columns: 1fr;
    min-width: 0;
    gap: 12px;
    padding: 12px;
  }

  .timeline li::before {
    left: 13px;
  }

  .timeline-marker {
    align-content: start;
    padding-left: 28px;
  }

  .timeline-media {
    align-self: start;
    width: 100%;
    max-width: 100%;
  }

  .timeline-media img {
    max-width: 100%;
  }
}

body[data-design="modern"] {
  overflow-x: clip;
}

@media (max-width: 760px) {
  body[data-design="modern"] {
    width: 100%;
    max-width: 100%;
    background: #f7f4ee;
  }

  body[data-design="modern"] .character-hero {
    display: grid;
    min-height: 100svh;
    align-items: end;
    padding: 0 10px 28px;
    overflow: hidden;
    background: #0d0b10;
  }

  body[data-design="modern"] .character-hero::before {
    inset: 0;
    z-index: 1;
    height: auto;
    background:
      linear-gradient(180deg, rgba(9, 8, 12, 0.08) 0%, rgba(9, 8, 12, 0.1) 36%, rgba(9, 8, 12, 0.9) 100%),
      linear-gradient(90deg, rgba(9, 8, 12, 0.74), rgba(9, 8, 12, 0.02) 54%, rgba(9, 8, 12, 0.42));
  }

  body[data-design="modern"] .brand-banner-shell {
    position: absolute;
    inset: 0;
    z-index: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    transform: none;
  }

  body[data-design="modern"] .brand-banner {
    width: 100%;
    height: 100%;
    border-radius: 0;
    object-fit: cover;
    object-position: center top;
    filter: saturate(1.08) contrast(1.04);
  }

  body[data-design="modern"] .character-hero .shell {
    z-index: 2;
    display: block;
    width: 100%;
    max-width: none;
    margin: 0;
    padding: 0 4px;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    color: #ffffff;
    backdrop-filter: none;
  }

  body[data-design="modern"] .character-hero .back-link {
    width: fit-content;
    margin: 0 0 20px;
    border-color: rgba(255, 255, 255, 0.36);
    background: rgba(255, 255, 255, 0.16);
    color: #ffffff;
    box-shadow: 0 16px 34px rgba(0, 0, 0, 0.18);
    backdrop-filter: blur(14px);
  }

  body[data-design="modern"] .character-hero .eyebrow {
    margin: 0 0 8px;
    color: color-mix(in srgb, var(--theme-secondary) 70%, #ffffff);
    text-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
  }

  body[data-design="modern"] .character-hero h1 {
    max-width: min(100%, 9em);
    color: #ffffff;
    font-size: clamp(3.5rem, 18vw, 5.2rem);
    line-height: 0.94;
    text-shadow: 0 20px 58px rgba(0, 0, 0, 0.72);
  }

  body[data-design="modern"] .character-hero .catchphrase,
  body[data-design="modern"] .character-hero .lead {
    max-width: 34em;
    color: rgba(255, 255, 255, 0.9);
    text-shadow: 0 12px 34px rgba(0, 0, 0, 0.66);
  }

  body[data-design="modern"] .character-hero .catchphrase {
    margin-top: 18px;
    color: #ffffff;
    font-size: 1.05rem;
  }

  body[data-design="modern"] .character-hero .lead {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
  }

  body[data-design="modern"] .character-hero .hero-facts {
    display: none;
  }

  body[data-design="modern"] .page-menu {
    overflow: hidden;
  }

  body[data-design="modern"] .page-menu-inner,
  body[data-design="modern"] .content-layout {
    width: min(100%, calc(100% - 20px));
    max-width: none;
  }

  body[data-design="modern"] .content-layout {
    overflow: clip;
    padding-top: 20px;
  }

  body[data-design="modern"] .panel,
  body[data-design="modern"] .source-callout,
  body[data-design="modern"] .visual-references {
    max-width: 100%;
    padding: 18px;
  }

  body[data-design="modern"] .official-links {
    margin-right: 0;
    margin-left: 0;
  }

  body[data-design="modern"] .visual-archive {
    margin-right: -18px;
    margin-left: -18px;
  }

  body[data-design="modern"] .design-switcher {
    top: 10px;
    right: 10px;
    bottom: auto;
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
