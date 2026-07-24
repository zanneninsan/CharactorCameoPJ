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
const guestbookApiUrl = "https://script.google.com/macros/s/AKfycbwzBF_HTRBnv4JgcGitGN9zU9ZjfvmmtKr_nJ2RNwuwemWKeexbJiEZQ2DvQVwFc-hP/exec";
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
      await copySharedAssets();

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
          const manzokukyoTruthDir = path.join(manzokukyoDir, "truth");
          const manzokukyoRedHouseDir = path.join(manzokukyoTruthDir, "red-house");
          await mkdir(manzokukyoDir, { recursive: true });
          await mkdir(manzokukyoTruthDir, { recursive: true });
          await mkdir(manzokukyoRedHouseDir, { recursive: true });
          await writeFile(path.join(manzokukyoDir, "index.html"), renderManzokukyoTeaser(character), "utf8");
          await writeFile(path.join(manzokukyoTruthDir, "index.html"), renderManzokukyoTruth(character), "utf8");
          await writeFile(path.join(manzokukyoRedHouseDir, "index.html"), renderManzokukyoRedHouse(character), "utf8");
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

async function copySharedAssets() {
  const guestbookDir = path.join(sharedContentDir, "guestbook");

  try {
    const guestbookStat = await stat(guestbookDir);
    if (!guestbookStat.isDirectory()) return;
  } catch {
    return;
  }

  await mkdir(path.join(distDir, "assets"), { recursive: true });
  await cp(guestbookDir, path.join(distDir, "assets", "guestbook"), { recursive: true });
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
  const bgmPath = path.join(contentDir, "zannenin", "assets", "manzokukyo", "satisfaction-bgm.m4a");
  const corridorScenePath = path.join(contentDir, "zannenin", "assets", "manzokukyo", "corridor-v2.png");
  const doorScenePath = path.join(contentDir, "zannenin", "assets", "manzokukyo", "door-v2.png");
  const truthChamberPath = path.join(contentDir, "zannenin", "assets", "manzokukyo", "truth-chamber.png");
  const redConfessionChamberPath = path.join(contentDir, "zannenin", "assets", "manzokukyo", "red-confession-chamber.png");
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
  if (await fileExists(bgmPath)) {
    await cp(bgmPath, path.join(outputDir, "satisfaction-bgm.m4a"));
  }

  for (const [source, basename] of [
    [corridorScenePath, "corridor-v2"],
    [doorScenePath, "door-v2"],
    [truthChamberPath, "truth-chamber"],
    [redConfessionChamberPath, "red-confession-chamber"],
  ]) {
    if (!await fileExists(source)) continue;
    await sharp(source)
      .resize({ width: 1920, withoutEnlargement: true })
      .avif({ quality: 54, effort: 6 })
      .toFile(path.join(outputDir, `${basename}.avif`));
    await sharp(source)
      .resize({ width: 1920, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(path.join(outputDir, `${basename}.webp`));
  }

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

function shouldRenderGuestbook(character) {
  return character.id === "zannenin";
}

function renderGuestbookHead(assetPrefix) {
  return `
    <link rel="stylesheet" href="${escapeHtml(assetPrefix)}assets/guestbook/guestbook.css">
    <script src="${escapeHtml(assetPrefix)}assets/guestbook/guestbook.js" defer></script>
  `;
}

function renderGuestbookWidget({
  scope,
  title,
  description,
  buttonLabel = "あしあと帳",
  defaultName = "満足教徒",
  image = "",
  maxLength = 80,
  direct = true
}) {
  return `
    <div
      data-guestbook-widget
      data-guestbook-api="${escapeHtml(guestbookApiUrl)}"
      data-guestbook-scope="${escapeHtml(scope)}"
      data-guestbook-title="${escapeHtml(title)}"
      data-guestbook-description="${escapeHtml(description)}"
      data-guestbook-button-label="${escapeHtml(buttonLabel)}"
      data-guestbook-default-name="${escapeHtml(defaultName)}"
      data-guestbook-max-length="${escapeHtml(String(maxLength))}"
      data-guestbook-direct="${direct ? "true" : "false"}"
      ${image ? `data-guestbook-image="${escapeHtml(image)}"` : ""}
    ></div>
  `;
}

function renderCharacter(character) {
  if (character.id === "zannenin") {
    return renderZanneninCharacter(character);
  }

  const hasRandomVideos = randomDriveVideoSets(character.randomVideoPlayer).length > 0;
  const hasMusicVideos = Boolean(character.musicVideoPlayer);
  const includeGuestbook = shouldRenderGuestbook(character);

  return htmlPage({
    title: character.displayName,
    description: character.summary,
    urlPath: `${character.id}/`,
    imagePath: `${character.id}/assets/generated/ogp.png`,
    type: "profile",
    structuredData: characterStructuredData(character, `${character.id}/`),
    headExtra: `${renderAiPromptHeadMetadata(character)}${includeGuestbook ? renderGuestbookHead("../") : ""}`,
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
          ${includeGuestbook ? renderGuestbookWidget({
            scope: `${character.id}:guestbook`,
            title: `${character.displayName}のあしあと帳`,
            description: "公式プロフィールを見に来た記念に、ひとこと残していけます。",
            buttonLabel: "あしあと帳"
          }) : ""}
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

function renderManzokukyoTruth(character) {
  const title = "真理の扉";
  const description = "満足教の奥へ進んだ者だけが辿りつく、次の謎解きエリアです。";

  return htmlPage({
    title: `${title} | 満足教`,
    description,
    urlPath: `${character.id}/manzokukyo/truth/`,
    imagePath: `${character.id}/assets/generated/ogp.png`,
    type: "website",
    theme: character.theme,
    stylesheetHref: "../../../styles.css",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${title} | 満足教`,
      description,
      url: absoluteUrl(`${character.id}/manzokukyo/truth/`),
      inLanguage: "ja",
      isPartOf: {
        "@type": "WebSite",
        name: "Character Canon",
        url: absoluteUrl("")
      },
      about: {
        "@type": "Thing",
        name: "満足教",
        description
      }
    },
    body: `
      <style>
        :root {
          --truth-black: #050408;
          --truth-ink: #fff7dc;
          --truth-gold: #d7b451;
          --truth-red: #ff335c;
          --truth-cyan: #58f6ff;
          --truth-violet: #9b72ff;
        }

        html,
        body {
          min-height: 100%;
          margin: 0;
          overflow: hidden;
          color: var(--truth-ink);
          background: var(--truth-black);
        }

        .truth-page {
          position: relative;
          min-height: 100svh;
          overflow: hidden;
          isolation: isolate;
          font-family: var(--font-sans);
          background: #050408;
        }

        .truth-chamber,
        .truth-chamber img,
        .truth-atmosphere,
        .truth-scanlines,
        .truth-shock,
        .truth-transition {
          position: absolute;
          inset: 0;
        }

        .truth-chamber {
          z-index: -5;
          overflow: hidden;
        }

        .truth-chamber img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: 50% 50%;
          filter: brightness(0.68) contrast(1.08) saturate(0.82);
          transform: scale(1.07);
          animation: truth-chamber-enter 2.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        .truth-atmosphere {
          z-index: -4;
          pointer-events: none;
          background:
            linear-gradient(90deg, rgba(0, 0, 0, 0.68), transparent 23% 77%, rgba(0, 0, 0, 0.68)),
            linear-gradient(180deg, rgba(0, 0, 0, 0.58), transparent 28% 68%, rgba(0, 0, 0, 0.82)),
            radial-gradient(ellipse at 50% 47%, rgba(126, 60, 255, 0.12), transparent 34%);
        }

        .truth-scanlines {
          z-index: 30;
          pointer-events: none;
          background:
            linear-gradient(rgba(255, 255, 255, 0.025) 50%, transparent 50%),
            radial-gradient(ellipse at 50% 50%, transparent 0 48%, rgba(0, 0, 0, 0.54) 82%, rgba(0, 0, 0, 0.88) 100%);
          background-size: 100% 4px, auto;
          opacity: 0.72;
          mix-blend-mode: screen;
        }

        .truth-topbar {
          position: absolute;
          top: 0;
          right: 0;
          left: 0;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 64px;
          border-bottom: 1px solid rgba(215, 180, 81, 0.22);
          padding: 0 clamp(18px, 4vw, 64px);
          background: linear-gradient(180deg, rgba(2, 2, 4, 0.78), transparent);
          font-family: var(--font-ui);
          font-size: 0.72rem;
          font-weight: 900;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }

        .truth-area {
          display: flex;
          align-items: center;
          gap: 12px;
          color: rgba(255, 247, 220, 0.76);
        }

        .truth-area::before {
          content: "";
          width: 7px;
          height: 7px;
          border: 1px solid var(--truth-gold);
          transform: rotate(45deg);
          box-shadow: 0 0 12px rgba(215, 180, 81, 0.58);
        }

        .truth-nav {
          display: flex;
          gap: 22px;
        }

        .truth-nav a {
          color: rgba(255, 247, 220, 0.64);
          text-decoration: none;
          transition: color 0.2s ease;
        }

        .truth-nav a:hover,
        .truth-nav a:focus-visible {
          color: var(--truth-ink);
        }

        .truth-heading {
          position: absolute;
          top: clamp(84px, 13vh, 126px);
          left: clamp(22px, 6vw, 92px);
          z-index: 10;
          width: min(48rem, calc(100% - 44px));
          text-shadow: 0 4px 22px #000, 0 0 48px rgba(0, 0, 0, 0.92);
          animation: truth-copy-enter 1.1s 1.3s both;
        }

        .truth-kicker {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 0 0 12px;
          color: rgba(215, 180, 81, 0.92);
          font-family: var(--font-ui);
          font-size: clamp(0.68rem, 1.2vw, 0.82rem);
          font-weight: 900;
          letter-spacing: 0.22em;
          text-transform: uppercase;
        }

        .truth-kicker::before {
          content: "";
          width: 34px;
          height: 1px;
          background: var(--truth-gold);
        }

        .truth-heading h1 {
          margin: 0;
          color: #fff2bd;
          font-family: var(--font-display);
          font-size: clamp(3rem, 8vw, 6.8rem);
          line-height: 0.92;
          letter-spacing: 0;
          text-shadow:
            0 3px 0 #000,
            2px 0 rgba(255, 51, 92, 0.34),
            -2px 0 rgba(88, 246, 255, 0.28),
            0 0 30px rgba(255, 221, 126, 0.24);
        }

        .truth-lead {
          max-width: 38em;
          margin: 18px 0 0;
          color: rgba(245, 234, 210, 0.72);
          font-size: clamp(0.86rem, 1.5vw, 1rem);
          font-weight: 700;
          line-height: 1.8;
        }

        .truth-oracle {
          position: absolute;
          top: 46%;
          left: 50%;
          z-index: 5;
          width: clamp(128px, 15vw, 210px);
          aspect-ratio: 1;
          transform: translate(-50%, -50%);
          pointer-events: none;
          opacity: 0.68;
        }

        .truth-oracle-ring,
        .truth-oracle-ring::before,
        .truth-oracle-ring::after {
          position: absolute;
          inset: 0;
          border: 1px solid rgba(215, 180, 81, 0.42);
          border-radius: 50%;
          content: "";
        }

        .truth-oracle-ring {
          background: repeating-conic-gradient(from 0deg, rgba(215, 180, 81, 0.46) 0 1deg, transparent 1deg 16deg);
          mask-image: radial-gradient(circle, transparent 0 60%, #000 61% 63%, transparent 64%);
          animation: truth-orbit 28s linear infinite;
        }

        .truth-oracle-ring::before {
          inset: 17%;
          border-color: rgba(155, 114, 255, 0.46);
          animation: truth-orbit 18s linear reverse infinite;
        }

        .truth-oracle-ring::after {
          inset: 35%;
          border-color: rgba(88, 246, 255, 0.3);
        }

        .truth-oracle-eye {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 38%;
          height: 17%;
          overflow: hidden;
          border: 1px solid rgba(255, 240, 182, 0.64);
          border-radius: 100% 0 100% 0;
          background: rgba(4, 3, 7, 0.88);
          box-shadow: 0 0 28px rgba(155, 114, 255, 0.36);
          transform: translate(-50%, -50%) rotate(-45deg) scaleY(0.18);
          transition: transform 0.42s ease, border-color 0.2s ease;
        }

        .truth-oracle-eye::after {
          content: "";
          position: absolute;
          top: 50%;
          left: 50%;
          width: 40%;
          aspect-ratio: 1;
          border-radius: 50%;
          background: radial-gradient(circle, #050408 0 18%, #fff0a9 20% 34%, var(--truth-violet) 38% 64%, #08040d 68%);
          transform: translate(-50%, -50%);
        }

        .truth-page[data-truth-state="listening"] .truth-oracle-eye,
        .truth-page[data-truth-state="denied"] .truth-oracle-eye {
          transform: translate(-50%, -50%) rotate(-45deg) scaleY(1);
        }

        .truth-console {
          position: absolute;
          right: 50%;
          bottom: clamp(24px, 6vh, 62px);
          z-index: 12;
          display: grid;
          gap: 14px;
          width: min(680px, calc(100% - 36px));
          border: 1px solid rgba(215, 180, 81, 0.42);
          padding: 18px;
          background: linear-gradient(180deg, rgba(12, 8, 16, 0.76), rgba(0, 0, 0, 0.9));
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.72), inset 0 0 46px rgba(126, 60, 255, 0.08);
          transform: translateX(50%);
          backdrop-filter: blur(12px);
          animation: truth-console-enter 1s 1.65s both;
        }

        .truth-console-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          color: rgba(215, 180, 81, 0.84);
          font-family: var(--font-ui);
          font-size: 0.7rem;
          font-weight: 900;
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }

        .truth-console-head output {
          color: rgba(255, 247, 220, 0.46);
          letter-spacing: 0.12em;
        }

        .truth-passphrase-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
        }

        .truth-console label {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }

        .truth-console input {
          min-width: 0;
          min-height: 52px;
          border: 1px solid rgba(255, 247, 220, 0.28);
          border-radius: 2px;
          padding: 10px 16px;
          background: rgba(255, 247, 220, 0.055);
          color: var(--truth-ink);
          font: 800 1rem/1.2 var(--font-sans);
          outline: none;
          caret-color: var(--truth-gold);
          transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
        }

        .truth-console input::placeholder {
          color: rgba(255, 247, 220, 0.34);
        }

        .truth-console input:focus {
          border-color: rgba(215, 180, 81, 0.82);
          background: rgba(8, 5, 12, 0.88);
          box-shadow: 0 0 0 1px rgba(215, 180, 81, 0.2), 0 0 34px rgba(126, 60, 255, 0.16);
        }

        .truth-mobile-runes {
          display: none;
        }

        .truth-mobile-runes > p {
          margin: 0;
          color: rgba(245, 234, 210, 0.58);
          font-size: 0.7rem;
          font-weight: 800;
          text-align: center;
        }

        .truth-rune-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
          gap: 9px;
          align-items: center;
        }

        .truth-console .truth-rune-button {
          display: grid;
          min-width: 0;
          min-height: 82px;
          place-items: center;
          gap: 2px;
          border-color: rgba(215, 180, 81, 0.42);
          padding: 8px;
          background:
            radial-gradient(circle at 50% 44%, rgba(126, 60, 255, 0.16), transparent 55%),
            rgba(5, 3, 8, 0.94);
          color: var(--truth-ink);
          box-shadow: inset 0 0 28px rgba(0, 0, 0, 0.7);
        }

        .truth-rune-button small {
          color: rgba(215, 180, 81, 0.56);
          font-family: var(--font-ui);
          font-size: 0.54rem;
          letter-spacing: 0.13em;
          text-transform: uppercase;
        }

        .truth-rune-button strong {
          font-family: var(--font-display);
          font-size: 2.55rem;
          line-height: 0.9;
          text-shadow: 0 0 18px rgba(155, 114, 255, 0.42);
        }

        .truth-rune-join {
          color: rgba(215, 180, 81, 0.62);
          font-family: var(--font-ui);
          font-size: 1rem;
        }

        .truth-console .truth-rune-button:active {
          border-color: #fff0ad;
          background: rgba(67, 34, 92, 0.74);
          transform: scale(0.97);
        }

        .truth-console button {
          display: inline-flex;
          min-width: 126px;
          min-height: 52px;
          align-items: center;
          justify-content: center;
          gap: 12px;
          border: 1px solid var(--truth-gold);
          border-radius: 2px;
          padding: 10px 18px;
          background: rgba(215, 180, 81, 0.9);
          color: #100c10;
          font: 900 0.88rem/1 var(--font-sans);
          cursor: pointer;
          transition: background 0.2s ease, color 0.2s ease, transform 0.2s ease;
        }

        .truth-console button:hover,
        .truth-console button:focus-visible {
          background: #fff0b0;
          transform: translateY(-1px);
        }

        .truth-console button span {
          font-family: var(--font-ui);
          font-size: 1rem;
        }

        .truth-message {
          min-height: 1.5em;
          margin: 0;
          color: rgba(245, 234, 210, 0.68);
          font-size: 0.82rem;
          font-weight: 800;
          line-height: 1.5;
        }

        .truth-clue {
          color: rgba(255, 247, 220, 0.42);
          font-family: var(--font-ui);
          font-size: 0.66rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .truth-particles {
          position: absolute;
          inset: 0;
          z-index: 4;
          overflow: hidden;
          pointer-events: none;
        }

        .truth-particles i {
          position: absolute;
          bottom: -10%;
          left: calc(var(--x) * 1%);
          width: 2px;
          height: 2px;
          border-radius: 50%;
          background: rgba(255, 228, 152, 0.72);
          box-shadow: 0 0 8px rgba(255, 208, 93, 0.56);
          animation: truth-dust calc(8s + var(--i) * 0.4s) calc(var(--delay) * -1s) linear infinite;
        }

        .truth-door {
          position: absolute;
          top: 0;
          bottom: 0;
          z-index: 50;
          width: 50.15%;
          pointer-events: none;
          background-image: linear-gradient(rgba(0, 0, 0, 0.08), rgba(0, 0, 0, 0.34)), url("../../assets/generated/manzokukyo/door-v2.webp");
          background-repeat: no-repeat;
          background-size: 200% 100%;
          box-shadow: 0 0 90px rgba(0, 0, 0, 0.92);
        }

        .truth-door-left {
          left: 0;
          background-position: left center;
          animation: truth-door-left 1.6s 0.24s cubic-bezier(0.76, 0, 0.24, 1) forwards;
        }

        .truth-door-right {
          right: 0;
          background-position: right center;
          animation: truth-door-right 1.6s 0.24s cubic-bezier(0.76, 0, 0.24, 1) forwards;
        }

        .truth-door-glow {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 50%;
          z-index: 51;
          width: 3px;
          pointer-events: none;
          background: #eee1ff;
          box-shadow: 0 0 18px #c2a8ff, 0 0 60px rgba(126, 60, 255, 0.82), 0 0 140px rgba(255, 238, 174, 0.3);
          transform: translateX(-50%);
          animation: truth-slit 1.9s ease forwards;
        }

        .truth-presence {
          position: absolute;
          top: 18%;
          right: 5%;
          z-index: 8;
          width: clamp(80px, 11vw, 160px);
          aspect-ratio: 1;
          border-radius: 50%;
          background: radial-gradient(ellipse at center, #fff5c8 0 3%, #ff335c 4% 7%, #050408 8% 18%, rgba(255, 51, 92, 0.3) 19%, transparent 48%);
          filter: blur(1px) drop-shadow(0 0 22px rgba(255, 0, 48, 0.46));
          opacity: 0;
          pointer-events: none;
          transform: scaleY(0.05);
        }

        .truth-page[data-denials="2"] .truth-presence,
        .truth-page[data-denials="3"] .truth-presence {
          opacity: 0.68;
          transform: scaleY(1);
          transition: opacity 0.14s steps(2, end), transform 0.18s steps(2, end);
        }

        .truth-shock,
        .truth-transition {
          z-index: 40;
          opacity: 0;
          pointer-events: none;
        }

        .truth-page.truth-denied .truth-shock {
          background:
            repeating-linear-gradient(0deg, rgba(255, 0, 42, 0.14) 0 1px, transparent 1px 5px),
            radial-gradient(circle at 50% 45%, transparent 0 28%, rgba(120, 0, 24, 0.48) 64%, rgba(0, 0, 0, 0.92) 100%);
          animation: truth-shock 1.25s steps(6, end);
        }

        .truth-page.truth-denied .truth-console {
          animation: truth-console-shake 0.5s steps(2, end);
        }

        .truth-page.truth-denied .truth-console input {
          border-color: rgba(255, 51, 92, 0.9);
          background: rgba(38, 0, 9, 0.84);
          color: #ffd5df;
        }

        .truth-page.truth-denied .truth-message {
          color: #ff9aae;
          animation: truth-message-flicker 0.72s steps(2, end);
        }

        .truth-page.truth-denied .truth-chamber img {
          animation: truth-room-jolt 0.56s steps(2, end);
        }

        .truth-page.truth-accepted .truth-transition {
          background: radial-gradient(circle at 50% 48%, #ffffff 0, #e8ddff 12%, rgba(126, 60, 255, 0.9) 28%, #050408 72%);
          animation: truth-accepted 1.2s cubic-bezier(0.7, 0, 0.84, 0) forwards;
        }

        .truth-page.truth-accepted .truth-oracle-eye {
          border-color: #fff4c8;
          transform: translate(-50%, -50%) rotate(-45deg) scale(2.2);
          box-shadow: 0 0 80px #fff, 0 0 160px rgba(126, 60, 255, 0.9);
        }

        @keyframes truth-door-left {
          0% { transform: translateX(0); }
          72% { opacity: 1; }
          100% { opacity: 0; transform: translateX(-102%); }
        }

        @keyframes truth-door-right {
          0% { transform: translateX(0); }
          72% { opacity: 1; }
          100% { opacity: 0; transform: translateX(102%); }
        }

        @keyframes truth-slit {
          0% { opacity: 0.4; transform: translateX(-50%) scaleX(0.5); }
          42% { opacity: 1; transform: translateX(-50%) scaleX(3); }
          100% { opacity: 0; transform: translateX(-50%) scaleX(34); }
        }

        @keyframes truth-chamber-enter {
          from { filter: brightness(1.08) contrast(1.16) saturate(0.7); transform: scale(1.16); }
          to { filter: brightness(0.68) contrast(1.08) saturate(0.82); transform: scale(1.07); }
        }

        @keyframes truth-copy-enter {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes truth-console-enter {
          from { opacity: 0; transform: translate(50%, 22px); }
          to { opacity: 1; transform: translate(50%, 0); }
        }

        @keyframes truth-orbit {
          to { transform: rotate(360deg); }
        }

        @keyframes truth-dust {
          0% { opacity: 0; transform: translate3d(0, 0, 0); }
          15% { opacity: 0.8; }
          100% { opacity: 0; transform: translate3d(calc((var(--i) - 7) * 3px), -110svh, 0); }
        }

        @keyframes truth-shock {
          0%, 100% { opacity: 0; }
          12%, 34%, 66% { opacity: 1; }
          22%, 48%, 82% { opacity: 0.18; }
        }

        @keyframes truth-console-shake {
          0%, 100% { transform: translate(50%, 0); }
          18% { transform: translate(calc(50% - 8px), 3px); }
          36% { transform: translate(calc(50% + 6px), -2px); }
          54% { transform: translate(calc(50% - 4px), -4px); }
          72% { transform: translate(calc(50% + 5px), 2px); }
        }

        @keyframes truth-message-flicker {
          0%, 100% { opacity: 1; }
          20%, 62% { opacity: 0.18; }
          42%, 82% { opacity: 0.76; }
        }

        @keyframes truth-room-jolt {
          0%, 100% { transform: scale(1.07); filter: brightness(0.68) contrast(1.08) saturate(0.82); }
          28% { transform: scale(1.085) translateX(-5px); filter: brightness(0.36) contrast(1.4) saturate(0.2); }
          58% { transform: scale(1.075) translateX(4px); filter: brightness(0.9) contrast(1.24) saturate(0.7); }
        }

        @keyframes truth-accepted {
          0% { opacity: 0; transform: scale(0.08); }
          28% { opacity: 1; }
          100% { opacity: 1; transform: scale(2.4); }
        }

        @media (max-width: 720px) {
          .truth-topbar {
            min-height: 54px;
          }

          .truth-nav a:last-child {
            display: none;
          }

          .truth-heading {
            top: 74px;
            left: 18px;
            width: calc(100% - 36px);
          }

          .truth-heading h1 {
            font-size: clamp(2.8rem, 17vw, 4.8rem);
          }

          .truth-lead {
            max-width: 26em;
            margin-top: 12px;
            font-size: 0.82rem;
            line-height: 1.65;
          }

          .truth-oracle {
            top: 50%;
            width: 118px;
          }

          .truth-console {
            bottom: max(16px, env(safe-area-inset-bottom));
            width: calc(100% - 24px);
            gap: 10px;
            padding: 14px;
          }

          .truth-passphrase-row {
            grid-template-columns: 1fr;
          }

          .truth-console input {
            display: none;
          }

          .truth-mobile-runes {
            display: grid;
            gap: 8px;
          }

          .truth-console button {
            min-height: 46px;
          }

          .truth-clue {
            display: none;
          }

          .truth-chamber img {
            object-position: 50% center;
          }

          .truth-presence {
            top: 36%;
            right: 2%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .truth-door,
          .truth-door-glow {
            display: none;
          }

          .truth-chamber img,
          .truth-heading,
          .truth-console,
          .truth-oracle-ring,
          .truth-oracle-ring::before,
          .truth-particles i {
            animation: none;
          }
        }
      </style>
      <main class="truth-page" data-truth-state="waiting" data-denials="0">
        <picture class="truth-chamber" aria-hidden="true">
          <source srcset="../../assets/generated/manzokukyo/truth-chamber.avif" type="image/avif">
          <source srcset="../../assets/generated/manzokukyo/truth-chamber.webp" type="image/webp">
          <img src="../../assets/manzokukyo/truth-chamber.png" alt="">
        </picture>
        <div class="truth-atmosphere" aria-hidden="true"></div>
        <div class="truth-particles" aria-hidden="true">
          ${Array.from({ length: 16 }, (_, index) => `<i style="--i:${index};--x:${8 + ((index * 37) % 84)};--delay:${(index * 0.73).toFixed(2)}"></i>`).join("")}
        </div>
        <div class="truth-scanlines" aria-hidden="true"></div>

        <header class="truth-topbar">
          <span class="truth-area">Satisfaction Cult / Area 01</span>
          <nav class="truth-nav" aria-label="真理の扉メニュー">
            <a href="../">← 回廊</a>
            <a href="../../">残念院さん公式設定</a>
          </nav>
        </header>

        <section class="truth-heading" aria-labelledby="truth-title">
          <p class="truth-kicker">The chamber is listening</p>
          <h1 id="truth-title">真理の扉</h1>
          <p class="truth-lead">扉は開いた。答えはまだない。ここでは、あなたが満たされたものだけが言葉になる。</p>
        </section>

        <div class="truth-oracle" aria-hidden="true">
          <div class="truth-oracle-ring"></div>
          <div class="truth-oracle-eye"></div>
        </div>
        <div class="truth-presence" aria-hidden="true"></div>

        <form class="truth-console" data-truth-gate data-answers="満足|まんぞく" data-next-url="./red-house/">
          <div class="truth-console-head">
            <span>Offering terminal</span>
            <output data-denial-meter>00 / 03</output>
          </div>
          <label for="truth-passphrase">合言葉</label>
          <div class="truth-mobile-runes" data-truth-mobile-runes aria-label="二つの合言葉の印">
            <p>二つの印をタップして、言葉を合わせる。</p>
            <div class="truth-rune-grid">
              <button class="truth-rune-button" type="button" data-truth-rune="0" aria-label="第一の印、現在は未"><small>First seal</small><strong data-truth-rune-label>未</strong></button>
              <span class="truth-rune-join" aria-hidden="true">＋</span>
              <button class="truth-rune-button" type="button" data-truth-rune="1" aria-label="第二の印、現在は定"><small>Second seal</small><strong data-truth-rune-label>定</strong></button>
            </div>
          </div>
          <div class="truth-passphrase-row">
            <input id="truth-passphrase" name="passphrase" type="text" autocomplete="off" inputmode="text" aria-describedby="truth-message" placeholder="合言葉を捧げる">
            <button type="submit">捧げる <span aria-hidden="true">→</span></button>
          </div>
          <p class="truth-message" id="truth-message" aria-live="polite">祭壇は、あなたの言葉を待っている。</p>
          <small class="truth-clue">hint / 満たすべきものを、一語で</small>
        </form>

        <div class="truth-door truth-door-left" aria-hidden="true"></div>
        <div class="truth-door truth-door-right" aria-hidden="true"></div>
        <div class="truth-door-glow" aria-hidden="true"></div>
        <div class="truth-shock" aria-hidden="true"></div>
        <div class="truth-transition" aria-hidden="true"></div>
      </main>
      <script>
      (() => {
        const form = document.querySelector("[data-truth-gate]");
        const page = document.querySelector(".truth-page");
        if (!form || !page) return;

        const input = form.querySelector("input[name='passphrase']");
        const message = form.querySelector(".truth-message");
        const meter = form.querySelector("[data-denial-meter]");
        const runeButtons = Array.from(form.querySelectorAll("[data-truth-rune]"));
        const mobileQuery = window.matchMedia("(max-width: 720px)");
        const answers = (form.dataset.answers || "").split("|").map((item) => item.trim()).filter(Boolean);
        const nextUrl = form.dataset.nextUrl || "./red-house/";
        const badMessages = [
          "違う。いまの声は、奥の誰かに届いた。",
          "祭壇の下で、爪が石をなぞっている。",
          "その言葉では満たされない。もう一度。",
          "右奥の暗がりが、ひとつ近づいた。",
          "あなたの声を覚えた。次は間違えないで。"
        ];
        let timer = 0;
        let denials = 0;
        const runeOptions = [["未", "満", "赤", "空"], ["定", "足", "罪", "門"]];
        const runeIndices = [0, 0];

        const normalize = (value) => value.replace(/[\u3000\s]+/g, "").trim();
        const setListening = () => {
          if (!page.classList.contains("truth-accepted")) page.dataset.truthState = "listening";
        };

        const renderRunes = () => {
          const selected = runeOptions.map((options, index) => options[runeIndices[index] % options.length]);
          runeButtons.forEach((button, index) => {
            const label = button.querySelector("[data-truth-rune-label]");
            if (label) label.textContent = selected[index];
            button.setAttribute("aria-label", (index === 0 ? "第一の印、現在は" : "第二の印、現在は") + selected[index]);
          });
          input.value = selected.join("");
        };

        const syncInputMode = () => {
          const wasMobile = input.readOnly;
          input.readOnly = mobileQuery.matches;
          input.tabIndex = mobileQuery.matches ? -1 : 0;
          if (mobileQuery.matches) {
            renderRunes();
          } else if (wasMobile) {
            input.value = "";
          }
        };

        input.addEventListener("focus", setListening);
        input.addEventListener("input", setListening);
        input.addEventListener("blur", () => {
          if (!page.classList.contains("truth-denied") && !page.classList.contains("truth-accepted")) {
            page.dataset.truthState = "waiting";
          }
        });

        runeButtons.forEach((button, index) => {
          button.addEventListener("click", () => {
            runeIndices[index] = (runeIndices[index] + 1) % runeOptions[index].length;
            renderRunes();
            setListening();
            message.textContent = "印がひとつ進んだ。二つの音が、祭壇に残る。";
          });
        });

        mobileQuery.addEventListener?.("change", syncInputMode);

        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const value = normalize(input.value);

          if (answers.some((answer) => normalize(answer) === value)) {
            window.clearTimeout(timer);
            page.dataset.truthState = "accepted";
            page.classList.remove("truth-denied");
            page.classList.add("truth-accepted");
            message.textContent = "受理しました。次の部屋が、あなたを待っています。";
            input.disabled = true;
            form.querySelectorAll("button").forEach((button) => { button.disabled = true; });
            window.setTimeout(() => {
              window.location.href = nextUrl;
            }, 1120);
            return;
          }

          window.clearTimeout(timer);
          denials = Math.min(3, denials + 1);
          page.dataset.denials = String(denials);
          page.dataset.truthState = "denied";
          meter.textContent = String(denials).padStart(2, "0") + " / 03";
          message.textContent = badMessages[Math.floor(Math.random() * badMessages.length)];
          page.classList.remove("truth-denied");
          void page.offsetWidth;
          page.classList.add("truth-denied");
          if (!mobileQuery.matches) input.select();
          timer = window.setTimeout(() => {
            page.classList.remove("truth-denied");
            page.dataset.truthState = "listening";
          }, 1280);
        });

        syncInputMode();
      })();
      </script>
    `
  });
}

function renderManzokukyoTruthLegacy(character) {
  const title = "真理の扉";
  const description = "満足教の奥へ進んだ者だけが辿りつく、次の謎解きエリアです。";

  return htmlPage({
    title: `${title} | 満足教`,
    description,
    urlPath: `${character.id}/manzokukyo/truth/`,
    imagePath: `${character.id}/assets/generated/ogp.png`,
    type: "website",
    theme: character.theme,
    stylesheetHref: "../../../styles.css",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${title} | 満足教`,
      description,
      url: absoluteUrl(`${character.id}/manzokukyo/truth/`),
      inLanguage: "ja",
      isPartOf: {
        "@type": "WebSite",
        name: "Character Canon",
        url: absoluteUrl("")
      },
      about: {
        "@type": "Thing",
        name: "満足教",
        description
      }
    },
    body: `
      <style>
        :root {
          --truth-black: #050408;
          --truth-ink: #fff7dc;
          --truth-gold: #d7b451;
          --truth-red: #ff335c;
          --truth-cyan: #58f6ff;
          --truth-violet: #7e3cff;
        }

        html,
        body {
          min-height: 100%;
          margin: 0;
          color: var(--truth-ink);
          background: var(--truth-black);
        }

        body {
          overflow-x: hidden;
        }

        .truth-page {
          position: relative;
          display: grid;
          min-height: 100svh;
          place-items: center;
          overflow: hidden;
          padding: clamp(22px, 5vw, 72px);
          isolation: isolate;
          font-family: var(--font-sans);
          background:
            radial-gradient(circle at 50% 44%, rgba(215, 180, 81, 0.13), transparent 22%),
            radial-gradient(circle at 50% 52%, rgba(126, 60, 255, 0.18), transparent 42%),
            linear-gradient(180deg, #050408, #100b15 48%, #050408);
        }

        .truth-page::before,
        .truth-page::after {
          content: "";
          position: fixed;
          inset: 0;
          pointer-events: none;
        }

        .truth-page::before {
          z-index: -2;
          background:
            repeating-linear-gradient(90deg, rgba(215, 180, 81, 0.08) 0 1px, transparent 1px 82px),
            repeating-linear-gradient(0deg, rgba(88, 246, 255, 0.05) 0 1px, transparent 1px 82px);
          mask-image: radial-gradient(ellipse at 50% 48%, #000 0 54%, transparent 78%);
        }

        .truth-page::after {
          z-index: -1;
          background:
            linear-gradient(rgba(255, 255, 255, 0.035) 50%, transparent 50%),
            radial-gradient(ellipse at 50% 50%, transparent 0 42%, rgba(0, 0, 0, 0.66) 78%, #000 100%);
          background-size: 100% 4px, auto;
          mix-blend-mode: screen;
        }

        .truth-card {
          position: relative;
          width: min(100%, 880px);
          border: 1px solid rgba(215, 180, 81, 0.5);
          padding: clamp(28px, 6vw, 72px);
          background:
            radial-gradient(circle at 50% 0%, rgba(255, 218, 112, 0.14), transparent 30%),
            linear-gradient(180deg, rgba(14, 9, 18, 0.82), rgba(0, 0, 0, 0.74));
          box-shadow:
            0 0 80px rgba(126, 60, 255, 0.18),
            0 34px 120px rgba(0, 0, 0, 0.72),
            inset 0 0 72px rgba(0, 0, 0, 0.74);
          text-align: center;
        }

        .truth-card::before {
          content: "";
          position: absolute;
          inset: -18px;
          border: 1px solid rgba(215, 180, 81, 0.18);
          pointer-events: none;
          transform: skew(-2deg);
        }

        .truth-kicker {
          margin: 0 0 18px;
          color: rgba(215, 180, 81, 0.92);
          font-family: var(--font-ui);
          font-size: 0.82rem;
          font-weight: 900;
          letter-spacing: 0.24em;
          text-transform: uppercase;
        }

        .truth-card h1 {
          display: inline-block;
          margin: 0;
          border: 1px solid rgba(215, 180, 81, 0.72);
          padding: 0.12em 0.18em 0.18em;
          background:
            linear-gradient(180deg, rgba(0, 0, 0, 0.94), rgba(35, 12, 42, 0.9)),
            #000000;
          color: #fff2b8;
          font-family: var(--font-display);
          font-size: clamp(3.2rem, 12vw, 8rem);
          line-height: 0.9;
          text-shadow:
            0 2px 0 #000000,
            3px 0 rgba(255, 51, 92, 0.34),
            -3px 0 rgba(88, 246, 255, 0.28),
            0 0 28px rgba(255, 210, 92, 0.48);
          box-shadow:
            0 0 0 4px rgba(255, 51, 92, 0.18),
            0 0 34px rgba(88, 246, 255, 0.18),
            inset 0 0 30px rgba(0, 0, 0, 0.72);
        }

        .truth-lead {
          max-width: 36em;
          margin: 24px auto 0;
          color: rgba(245, 234, 210, 0.72);
          font-size: clamp(1rem, 2.2vw, 1.2rem);
          line-height: 1.9;
        }

        .truth-clue {
          display: inline-grid;
          gap: 8px;
          margin-top: 34px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          padding: 16px 20px;
          background: rgba(0, 0, 0, 0.34);
          color: rgba(255, 247, 220, 0.86);
          font-family: var(--font-ui);
          font-weight: 800;
          letter-spacing: 0.08em;
        }

        .truth-clue small {
          color: rgba(215, 180, 81, 0.8);
          font-size: 0.74rem;
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }

        .truth-passphrase {
          display: grid;
          gap: 12px;
          width: min(100%, 520px);
          margin: 34px auto 0;
          border: 1px solid rgba(215, 180, 81, 0.25);
          padding: 18px;
          background: rgba(0, 0, 0, 0.34);
        }

        .truth-passphrase label {
          color: rgba(215, 180, 81, 0.9);
          font-family: var(--font-ui);
          font-size: 0.82rem;
          font-weight: 900;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }

        .truth-passphrase-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 10px;
        }

        .truth-passphrase input {
          min-height: 46px;
          border: 1px solid rgba(215, 180, 81, 0.42);
          border-radius: 999px;
          padding: 10px 16px;
          background: rgba(255, 247, 220, 0.08);
          color: var(--truth-ink);
          font: 900 1rem/1.2 var(--font-sans);
          outline: none;
        }

        .truth-passphrase input:focus {
          border-color: rgba(88, 246, 255, 0.82);
          box-shadow: 0 0 0 4px rgba(88, 246, 255, 0.12);
        }

        .truth-passphrase button {
          min-height: 46px;
          border: 1px solid rgba(215, 180, 81, 0.62);
          border-radius: 999px;
          padding: 10px 18px;
          background: rgba(215, 180, 81, 0.9);
          color: #120d10;
          font: 900 0.92rem/1.2 var(--font-sans);
          cursor: pointer;
        }

        .truth-message {
          min-height: 1.7em;
          margin: 0;
          color: rgba(245, 234, 210, 0.74);
          font-weight: 900;
        }

        .truth-page.truth-denied::after {
          z-index: 20;
          background:
            radial-gradient(circle at 50% 40%, transparent 0 28%, rgba(255, 0, 0, 0.4) 68%, rgba(0, 0, 0, 0.82) 100%),
            repeating-linear-gradient(0deg, rgba(255, 0, 0, 0.16) 0 1px, transparent 1px 5px);
          animation: truth-flash 1.15s steps(5, end);
          mix-blend-mode: normal;
        }

        .truth-page.truth-denied .truth-card {
          animation: truth-shake 0.46s steps(2, end);
        }

        .truth-page.truth-denied .truth-passphrase input {
          border-color: rgba(255, 51, 92, 0.95);
          background: rgba(35, 0, 8, 0.88);
          color: #ffd6df;
        }

        .truth-page.truth-denied .truth-message {
          color: #ff9aae;
          animation: truth-text-flicker 0.8s steps(2, end);
        }

        .truth-page.truth-accepted .truth-card {
          filter: brightness(1.08) saturate(1.12);
        }

        .truth-actions {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 12px;
          margin-top: 34px;
        }

        .truth-actions a {
          display: inline-flex;
          min-height: 46px;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(215, 180, 81, 0.52);
          border-radius: 999px;
          padding: 10px 18px;
          color: #fff7dc;
          text-decoration: none;
          font-weight: 900;
        }

        .truth-actions a:first-child {
          background: rgba(215, 180, 81, 0.9);
          color: #120d10;
        }

        @keyframes truth-flash {
          0%, 100% { opacity: 0; }
          18%, 52% { opacity: 1; }
          34%, 72% { opacity: 0.42; }
        }

        @keyframes truth-shake {
          0%, 100% { transform: translate(0, 0); }
          15% { transform: translate(-7px, 3px); }
          30% { transform: translate(6px, -2px); }
          45% { transform: translate(-4px, -4px); }
          60% { transform: translate(5px, 2px); }
          75% { transform: translate(-2px, 4px); }
        }

        @keyframes truth-text-flicker {
          0%, 100% { opacity: 1; }
          20%, 60% { opacity: 0.2; }
          40%, 80% { opacity: 0.78; }
        }

        @media (max-width: 640px) {
          .truth-passphrase-row {
            grid-template-columns: 1fr;
          }

          .truth-passphrase button {
            width: 100%;
          }
        }
      </style>
      <main class="truth-page">
        <section class="truth-card" aria-labelledby="truth-title">
          <p class="truth-kicker">Satisfaction Cult / Area 01</p>
          <h1 id="truth-title">真理の扉</h1>
          <p class="truth-lead">
            扉は開いた。けれど、ここにあるのは答えではなく、次の問いである。
            満たされたと思った瞬間、満足はこちらを見つめている。
          </p>
          <form class="truth-passphrase" data-truth-gate data-answers="満足|まんぞく" data-next-url="./red-house/">
            <label for="truth-passphrase">passphrase</label>
            <div class="truth-passphrase-row">
              <input id="truth-passphrase" name="passphrase" type="text" autocomplete="off" inputmode="text" aria-describedby="truth-message">
              <button type="submit">開く</button>
            </div>
            <p class="truth-message" id="truth-message" aria-live="polite">扉は黙っている。</p>
          </form>
          <div class="truth-actions">
            <a href="../">入口へ戻る</a>
            <a href="../../">残念院さん公式設定へ戻る</a>
          </div>
        </section>
      </main>
      <script>
      (() => {
        const form = document.querySelector("[data-truth-gate]");
        if (!form) return;

        const page = document.querySelector(".truth-page");
        const input = form.querySelector("input[name='passphrase']");
        const message = form.querySelector(".truth-message");
        const answers = (form.dataset.answers || "").split("|").map((item) => item.trim()).filter(Boolean);
        const nextUrl = form.dataset.nextUrl || "./red-house/";
        const badMessages = [
          "扉の向こうで、何かが爪を立てました。",
          "違います。けれど、今の声は覚えられました。",
          "満たされていません。もう一度。",
          "赤い懺悔室の灯りが、ひとつ増えました。"
        ];
        let timer = 0;

        const normalize = (value) => value.replace(/[\\u3000\\s]+/g, "").trim();

        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const value = normalize(input.value);

          if (answers.some((answer) => normalize(answer) === value)) {
            message.textContent = "扉が、満足そうに開きました。";
            page.classList.remove("truth-denied");
            page.classList.add("truth-accepted");
            window.setTimeout(() => {
              window.location.href = nextUrl;
            }, 520);
            return;
          }

          window.clearTimeout(timer);
          message.textContent = badMessages[Math.floor(Math.random() * badMessages.length)];
          page.classList.remove("truth-denied");
          void page.offsetWidth;
          page.classList.add("truth-denied");
          input.select();
          timer = window.setTimeout(() => {
            page.classList.remove("truth-denied");
          }, 1200);
        });
      })();
      </script>
    `
  });
}

function renderZanneninCharacter(character) {
  const hasRandomVideos = randomDriveVideoSets(character.randomVideoPlayer).length > 0;
  const hasMusicVideos = Boolean(character.musicVideoPlayer);
  const includeGuestbook = shouldRenderGuestbook(character);
  const profileFacts = [
    ["AGE", character.profile?.["年齢"]],
    ["HEIGHT", character.profile?.["身長"]],
    ["FROM", character.profile?.["出身"]],
    ["ROLE", "満足教 開祖・教祖"]
  ].filter(([, value]) => value && value !== "未定義");

  return htmlPage({
    title: character.displayName,
    description: character.summary,
    urlPath: `${character.id}/`,
    imagePath: `${character.id}/assets/generated/ogp.png`,
    type: "profile",
    structuredData: characterStructuredData(character, `${character.id}/`),
    headExtra: `${renderAiPromptHeadMetadata(character)}${includeGuestbook ? renderGuestbookHead("../") : ""}
      <link rel="stylesheet" href="./assets/site/home.css?v=20260720-6">
      <script src="./assets/site/home.js?v=20260720-6" defer></script>`,
    theme: character.theme,
    bodyClass: "zannenin-home",
    body: `
      <main class="zn-page" data-zn-page data-satisfaction="17">
        <div class="zn-progress" aria-hidden="true"><span data-zn-progress></span></div>
        <div class="zn-milestone" data-zn-milestone hidden aria-live="assertive" aria-atomic="true">
          <div class="zn-milestone-grid" aria-hidden="true"></div>
          <div class="zn-milestone-echo" data-zn-milestone-echo aria-hidden="true">100%</div>
          <div class="zn-milestone-core">
            <span data-zn-milestone-tier>REWARD UNLOCKED</span>
            <strong><b data-zn-milestone-value>100</b><i>%</i></strong>
            <h2 data-zn-milestone-title>観測上限解除</h2>
            <p data-zn-milestone-copy></p>
          </div>
        </div>

        <header class="zn-hero" id="top">
          <img class="zn-hero-image" src="./assets/brand/banner-source.png" alt="${escapeHtml(character.brandAssets?.banner?.alt ?? `${character.displayName} キービジュアル`)}" fetchpriority="high">
          <div class="zn-hero-shade" aria-hidden="true"></div>
          <nav class="zn-topbar" aria-label="サイト上部メニュー">
            <a class="zn-wordmark" href="#top" aria-label="${escapeHtml(character.displayName)} ページ上部へ">
              <img src="./assets/generated/brand/logo-320.webp" alt="${escapeHtml(character.displayName)}">
            </a>
            <div class="zn-toplinks">
              <a href="../">CHARACTER CANON</a>
              <a href="#links">OFFICIAL LINKS</a>
            </div>
          </nav>

          <div class="zn-hero-copy">
            <p class="zn-serial">SUBJECT 0714 / SATISFACTION OBSERVATION</p>
            <h1>${escapeHtml(character.displayName)}</h1>
            <p class="zn-hero-catch">${escapeHtml(character.catchphrase)}</p>
            <p class="zn-hero-lead">${escapeHtml(character.summary)}</p>
            <div class="zn-hero-actions">
              <a class="zn-primary-action" href="#profile">教祖を知る</a>
              <a class="zn-secondary-action" href="./manzokukyo/">満足教へ</a>
            </div>
          </div>

          <aside class="zn-observer" aria-label="満足度観測装置">
            <div class="zn-observer-head">
              <span>LIVE OBSERVATION</span>
              <i aria-hidden="true"></i>
            </div>
            <p class="zn-observer-value"><strong data-zn-value>17</strong><span>%</span></p>
            <div class="zn-observer-meter" aria-hidden="true"><span data-zn-meter></span></div>
            <p class="zn-oracle" data-zn-oracle aria-live="polite">満足度は自己申告制です。</p>
            <div class="zn-reward" data-zn-reward hidden aria-live="polite">
              <span data-zn-reward-tier>REWARD</span>
              <strong data-zn-reward-title>観測報酬</strong>
              <p data-zn-reward-copy></p>
            </div>
            <button type="button" data-zn-satisfaction>満足を観測</button>
          </aside>

          <a class="zn-scroll-cue" href="#intro"><span>SCROLL</span><i aria-hidden="true"></i></a>
        </header>

        <div class="zn-ticker" aria-hidden="true">
          <div>
            <span>RAMEN</span><b>◆</b><span>NEO SAITAMA</span><b>◆</b><span>MYSTERY</span><b>◆</b><span>COMEDY RELIGION</span><b>◆</b><span>SHIMOKITAZAWA</span><b>◆</b><span>SATISFACTION</span><b>◆</b>
            <span>RAMEN</span><b>◆</b><span>NEO SAITAMA</span><b>◆</b><span>MYSTERY</span><b>◆</b><span>COMEDY RELIGION</span><b>◆</b><span>SHIMOKITAZAWA</span><b>◆</b><span>SATISFACTION</span><b>◆</b>
          </div>
        </div>

        <section class="zn-intro zn-reveal" id="intro">
          <div class="zn-shell zn-intro-grid">
            <div class="zn-intro-title">
              <p>WHO IS SHE?</p>
              <h2>気品と悪戯が、<br>同じ顔をしている。</h2>
            </div>
            <div class="zn-intro-copy">
              <p>${escapeHtml(character.summary)}</p>
              <dl class="zn-quick-facts">
                ${profileFacts.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}
              </dl>
            </div>
          </div>
        </section>

        ${renderPageMenu(character)}

        <div class="zn-content">
          <div class="zn-band zn-band-ink zn-reveal">
            <div class="zn-shell">${renderOfficialLinks(character)}</div>
          </div>

          <div class="zn-band zn-band-paper zn-reveal">
            <div class="zn-shell">${renderVisualReferences(character)}</div>
          </div>

          ${hasMusicVideos || hasRandomVideos ? `
            <div class="zn-band zn-band-signal zn-reveal">
              <div class="zn-shell">
                ${renderMusicVideoPlayer(character.musicVideoPlayer)}
                ${renderOfficialRandomDriveVideoPlayer(character.randomVideoPlayer)}
              </div>
            </div>
          ` : ""}

          <div class="zn-band zn-band-paper zn-reveal">
            <div class="zn-shell zn-feature-grid">
              ${renderFanworkGuidelinesCard(character)}
              ${renderAiPrompts(character)}
            </div>
          </div>

          <div class="zn-band zn-band-profile zn-reveal">
            <div class="zn-shell zn-profile-grid">
              <section class="panel" id="profile">
                ${renderSectionHeading("profile")}
                <dl class="profile-list">
                  ${Object.entries(character.profile).map(([key, value]) => `
                    <div><dt>${escapeHtml(key)}</dt><dd>${renderProfileValue(value)}</dd></div>
                  `).join("")}
                </dl>
              </section>
              <div class="zn-profile-side">
                <section class="panel" id="glossary">
                  ${renderSectionHeading("glossary")}
                  <div class="stack">
                    ${character.glossary.map((item) => `<article><h3>${escapeHtml(item.term)}</h3><p>${escapeHtml(item.definition)}</p></article>`).join("")}
                  </div>
                </section>
                ${renderSideFlavors(character)}
              </div>
            </div>
          </div>

          <div class="zn-band zn-band-ink zn-reveal">
            <div class="zn-shell">
              <section class="panel detail-settings" id="settings">
                ${renderSectionHeading("settings")}
                <div class="stack zn-settings-grid">
                  ${character.settings.map((item) => `<article><p class="status">${escapeHtml(item.status ?? "official")}</p><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></article>`).join("")}
                </div>
              </section>
            </div>
          </div>

          <div class="zn-band zn-band-paper zn-reveal">
            <div class="zn-shell">
              <section class="panel" id="timeline">${renderSectionHeading("timeline")}${renderTimelineGroups(character)}</section>
            </div>
          </div>

          <div class="zn-band zn-band-footer zn-reveal">
            <div class="zn-shell zn-footer-grid">
              ${renderRightsSection(character)}
              ${renderSourceCallout({
                eyebrow: "Source",
                title: "このサイトのソース",
                description: `${character.displayName} の公式設定データは GitHub 上の JSON で管理しています。追記・修正の協力や、設定追加の提案を歓迎します。`,
                links: [
                  { label: "このキャラの設定JSON", href: sourceFileUrl(`content/characters/${character.id}/character.json`) },
                  { label: "GitHubリポジトリ", href: sourceRepoUrl }
                ]
              })}
            </div>
            <div class="zn-endmark" aria-hidden="true"><span>SATISFIED?</span><b>残念院さん</b></div>
          </div>

          ${renderHiddenEntrances(character)}
          ${includeGuestbook ? renderGuestbookWidget({
            scope: `${character.id}:guestbook`,
            title: `${character.displayName}のあしあと帳`,
            description: "公式プロフィールを見に来た記念に、ひとこと残していけます。",
            buttonLabel: "あしあと帳"
          }) : ""}
        </div>
        ${hasRandomVideos || hasMusicVideos ? renderRandomDriveVideoScript() : ""}
      </main>
    `
  });
}

function renderManzokukyoRedHouse(character) {
  const title = "赤い懺悔室";
  const description = "真理の扉の先にある、赤い灯りと懺悔のギミックで遊ぶ少し怖いページです。";

  return htmlPage({
    title: `${title} | 満足教`,
    description,
    urlPath: `${character.id}/manzokukyo/truth/red-house/`,
    imagePath: `${character.id}/assets/generated/ogp.png`,
    type: "website",
    theme: character.theme,
    stylesheetHref: "../../../../styles.css",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${title} | 満足教`,
      description,
      url: absoluteUrl(`${character.id}/manzokukyo/truth/red-house/`),
      inLanguage: "ja",
      isPartOf: {
        "@type": "WebSite",
        name: "Character Canon",
        url: absoluteUrl("")
      }
    },
    body: `
      <style>
        :root {
          --red-black: #050102;
          --red-ink: #fff3e8;
          --red-bone: #e9d8c7;
          --red-brass: #bd8f52;
          --red-crimson: #9f0d1d;
          --red-hot: #ff3d4f;
        }

        html,
        body {
          min-height: 100%;
          margin: 0;
          overflow: hidden;
          color: var(--red-ink);
          background: var(--red-black);
        }

        .red-room,
        .red-room *,
        .red-room *::before,
        .red-room *::after {
          box-sizing: border-box;
        }

        .red-room {
          --mouse-x: 50%;
          --mouse-y: 45%;
          --sin-level: 0;
          position: relative;
          min-height: 100svh;
          overflow: hidden;
          isolation: isolate;
          font-family: var(--font-sans);
          background: #050102;
        }

        .red-room-art,
        .red-room-art img,
        .red-room-shade,
        .red-room-noise,
        .red-room-flash {
          position: absolute;
          inset: 0;
        }

        .red-room-art {
          z-index: -6;
          overflow: hidden;
        }

        .red-room-art img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center;
          filter: brightness(0.65) contrast(1.08) saturate(0.76);
          transform: scale(1.035);
          animation: red-room-enter 2.1s cubic-bezier(0.16, 1, 0.3, 1) both;
          transition: filter 0.5s ease, transform 0.5s ease;
        }

        .red-room-shade {
          z-index: -5;
          pointer-events: none;
          background:
            radial-gradient(circle at var(--mouse-x) var(--mouse-y), rgba(255, 222, 180, 0.055), transparent 18%),
            linear-gradient(90deg, rgba(0, 0, 0, 0.62), transparent 24% 76%, rgba(0, 0, 0, 0.62)),
            linear-gradient(180deg, rgba(0, 0, 0, 0.6), transparent 25% 66%, rgba(0, 0, 0, 0.88)),
            radial-gradient(ellipse at 50% 44%, rgba(130, 0, 16, calc(0.06 + var(--sin-level) * 0.2)), transparent 48%);
        }

        .red-room-noise {
          z-index: 30;
          pointer-events: none;
          background:
            linear-gradient(rgba(255, 255, 255, 0.02) 50%, transparent 50%),
            radial-gradient(ellipse at 50% 50%, transparent 0 50%, rgba(0, 0, 0, 0.54) 84%, #000 100%);
          background-size: 100% 4px, auto;
          opacity: 0.74;
          mix-blend-mode: screen;
        }

        .red-topbar {
          position: absolute;
          top: 0;
          right: 0;
          left: 0;
          z-index: 20;
          display: flex;
          align-items: center;
          justify-content: space-between;
          min-height: 60px;
          border-bottom: 1px solid rgba(189, 143, 82, 0.26);
          padding: 0 clamp(18px, 4vw, 60px);
          background: linear-gradient(180deg, rgba(2, 0, 1, 0.84), transparent);
          font-family: var(--font-ui);
          font-size: 0.7rem;
          font-weight: 900;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }

        .red-area {
          display: flex;
          align-items: center;
          gap: 12px;
          color: rgba(255, 232, 216, 0.76);
        }

        .red-area::before {
          content: "";
          width: 7px;
          height: 7px;
          border: 1px solid var(--red-brass);
          transform: rotate(45deg);
          box-shadow: 0 0 12px rgba(255, 73, 73, 0.44);
        }

        .red-nav {
          display: flex;
          gap: 22px;
        }

        .red-nav a {
          color: rgba(255, 236, 221, 0.62);
          text-decoration: none;
        }

        .red-nav a:hover,
        .red-nav a:focus-visible {
          color: var(--red-ink);
        }

        .red-heading {
          position: absolute;
          top: clamp(80px, 11vh, 110px);
          left: clamp(20px, 5vw, 74px);
          z-index: 10;
          width: min(560px, 46vw);
          text-shadow: 0 4px 28px #000, 0 0 56px #000;
          animation: red-copy-enter 0.9s 0.45s both;
        }

        .red-kicker {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 0 0 10px;
          color: #d9aa78;
          font-family: var(--font-ui);
          font-size: 0.72rem;
          font-weight: 900;
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }

        .red-kicker::before {
          content: "";
          width: 32px;
          height: 1px;
          background: var(--red-brass);
        }

        .red-heading h1 {
          margin: 0;
          color: #fff0e1;
          font-family: var(--font-display);
          font-size: clamp(3rem, 7.2vw, 6.1rem);
          line-height: 0.92;
          letter-spacing: 0;
          text-shadow: 0 3px 0 #130002, 2px 0 rgba(255, 55, 67, 0.48), -2px 0 rgba(255, 219, 174, 0.2), 0 0 32px rgba(159, 13, 29, 0.3);
        }

        .red-lead {
          max-width: 34em;
          margin: 14px 0 0;
          color: rgba(242, 218, 202, 0.7);
          font-size: clamp(0.8rem, 1.35vw, 0.94rem);
          font-weight: 750;
          line-height: 1.72;
        }

        .red-lamps {
          position: absolute;
          top: 78px;
          right: clamp(20px, 5vw, 72px);
          z-index: 14;
          display: grid;
          grid-template-columns: repeat(3, minmax(76px, 104px));
          gap: 8px;
        }

        .red-lamp {
          display: grid;
          min-height: 84px;
          place-items: center;
          border: 1px solid rgba(189, 143, 82, 0.34);
          border-radius: 2px;
          padding: 8px 6px;
          background: rgba(4, 1, 2, 0.68);
          color: rgba(255, 233, 217, 0.62);
          font-family: var(--font-sans);
          cursor: pointer;
          backdrop-filter: blur(9px);
          transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease, transform 0.2s ease;
        }

        .red-lamp:hover,
        .red-lamp:focus-visible {
          border-color: rgba(255, 229, 196, 0.72);
          color: var(--red-ink);
          transform: translateY(-2px);
        }

        .red-lamp i {
          display: block;
          width: 12px;
          height: 19px;
          border: 1px solid rgba(233, 194, 139, 0.7);
          background: #1a0808;
          box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.9);
        }

        .red-lamp small {
          color: rgba(216, 174, 119, 0.56);
          font-family: var(--font-ui);
          font-size: 0.58rem;
          letter-spacing: 0.14em;
        }

        .red-lamp strong {
          font-size: 0.8rem;
          letter-spacing: 0;
        }

        .red-lamp[aria-pressed="true"] {
          border-color: #f1c68e;
          background: rgba(70, 4, 10, 0.76);
          color: #fff6e7;
          box-shadow: 0 0 28px rgba(191, 24, 36, 0.34), inset 0 0 22px rgba(255, 189, 112, 0.08);
        }

        .red-lamp[aria-pressed="true"] i {
          background: #ffe0a6;
          box-shadow: 0 0 12px #ffb065, 0 0 32px rgba(255, 45, 56, 0.68);
        }

        .red-listener {
          position: absolute;
          top: 43%;
          left: 50%;
          z-index: 9;
          display: grid;
          width: clamp(108px, 12vw, 168px);
          aspect-ratio: 1;
          place-items: center;
          border: 0;
          border-radius: 50%;
          padding: 0;
          background: transparent;
          cursor: pointer;
          transform: translate(-50%, -50%);
        }

        .red-listener::before,
        .red-listener::after {
          content: "";
          position: absolute;
          border-radius: 50%;
          pointer-events: none;
        }

        .red-listener::before {
          inset: 0;
          border: 1px solid rgba(189, 143, 82, 0.22);
          background: repeating-conic-gradient(from 0deg, rgba(189, 143, 82, 0.26) 0 1deg, transparent 1deg 24deg);
          mask-image: radial-gradient(circle, transparent 0 61%, #000 62% 64%, transparent 65%);
          animation: red-listener-orbit 24s linear infinite;
        }

        .red-listener::after {
          width: 34%;
          height: 13%;
          border: 1px solid rgba(255, 225, 191, 0.42);
          border-radius: 100% 0 100% 0;
          background: radial-gradient(circle, #090001 0 15%, #f3c077 17% 26%, #8d0817 29% 54%, #060102 58%);
          box-shadow: 0 0 24px rgba(159, 13, 29, 0.54);
          transform: rotate(-45deg) scaleY(calc(0.08 + var(--sin-level) * 0.92));
          transition: transform 0.34s ease, box-shadow 0.2s ease;
        }

        .red-listener:hover::after,
        .red-listener:focus-visible::after,
        .red-room.is-listening .red-listener::after {
          transform: rotate(-45deg) scaleY(1);
          box-shadow: 0 0 32px rgba(255, 32, 49, 0.7);
        }

        .red-listener-hint {
          position: absolute;
          top: calc(50% + 50px);
          left: 50%;
          width: max-content;
          color: rgba(232, 203, 179, 0.42);
          font-family: var(--font-ui);
          font-size: 0.58rem;
          font-weight: 900;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          transform: translateX(-50%);
        }

        .red-console,
        .red-verdict {
          position: absolute;
          z-index: 12;
          border: 1px solid rgba(189, 143, 82, 0.4);
          background: linear-gradient(180deg, rgba(14, 3, 5, 0.78), rgba(3, 1, 2, 0.94));
          box-shadow: 0 22px 72px rgba(0, 0, 0, 0.74), inset 0 0 44px rgba(107, 0, 13, 0.08);
          backdrop-filter: blur(12px);
          animation: red-panel-enter 0.9s 0.7s both;
        }

        .red-console {
          bottom: clamp(22px, 4vh, 44px);
          left: clamp(20px, 5vw, 72px);
          display: grid;
          gap: 11px;
          width: min(620px, 52vw);
          padding: 16px;
        }

        .red-console-head,
        .red-verdict-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          color: rgba(226, 184, 135, 0.86);
          font-family: var(--font-ui);
          font-size: 0.66rem;
          font-weight: 900;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }

        .red-counter {
          color: rgba(255, 235, 217, 0.46);
          letter-spacing: 0.1em;
        }

        .red-console label {
          position: absolute;
          width: 1px;
          height: 1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
        }

        .red-console textarea {
          width: 100%;
          min-height: 88px;
          resize: none;
          border: 1px solid rgba(230, 193, 156, 0.28);
          border-radius: 2px;
          padding: 12px 14px;
          background: rgba(0, 0, 0, 0.38);
          color: var(--red-ink);
          font: 750 0.92rem/1.65 var(--font-sans);
          outline: none;
          caret-color: #efb66d;
        }

        .red-console textarea::placeholder {
          color: rgba(238, 213, 192, 0.3);
        }

        .red-console textarea:focus {
          border-color: rgba(239, 189, 124, 0.78);
          box-shadow: 0 0 0 1px rgba(189, 143, 82, 0.18), 0 0 28px rgba(143, 5, 20, 0.2);
        }

        .red-mobile-offerings {
          display: none;
        }

        .red-mobile-offerings-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .red-mobile-offerings-head p {
          margin: 0;
          color: rgba(238, 214, 193, 0.6);
          font-size: 0.7rem;
          font-weight: 800;
        }

        .red-mobile-slots {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 7px;
        }

        .red-console .red-mobile-slot {
          display: grid;
          min-width: 0;
          min-height: 78px;
          align-content: center;
          gap: 6px;
          border-color: rgba(226, 184, 135, 0.34);
          padding: 8px 6px;
          background:
            linear-gradient(135deg, transparent 0 8px, rgba(26, 5, 8, 0.9) 8px),
            rgba(10, 2, 3, 0.92);
          text-align: left;
        }

        .red-mobile-slot small {
          color: rgba(211, 164, 109, 0.56);
          font-family: var(--font-ui);
          font-size: 0.54rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .red-mobile-slot strong {
          color: rgba(255, 239, 225, 0.86);
          font-size: 0.72rem;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }

        .red-mobile-slot:active {
          border-color: #f2c083;
          background: rgba(92, 6, 17, 0.82);
        }

        .red-meter {
          height: 3px;
          overflow: hidden;
          background: rgba(255, 239, 220, 0.1);
        }

        .red-meter span {
          display: block;
          width: calc(var(--sin-level) * 100%);
          height: 100%;
          background: linear-gradient(90deg, #d8ab70, #d51d30 62%, #ff3147);
          box-shadow: 0 0 12px rgba(255, 39, 57, 0.62);
          transition: width 0.2s ease;
        }

        .red-console-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
        }

        .red-console-actions {
          display: flex;
          gap: 8px;
        }

        .red-console button {
          min-height: 40px;
          border: 1px solid rgba(226, 184, 135, 0.46);
          border-radius: 2px;
          padding: 8px 13px;
          background: rgba(20, 3, 5, 0.76);
          color: rgba(255, 239, 225, 0.78);
          font: 850 0.78rem/1 var(--font-sans);
          cursor: pointer;
        }

        .red-console button[type="submit"] {
          min-width: 132px;
          border-color: #c19259;
          background: linear-gradient(180deg, #a41425, #4a030c);
          color: #fff4e7;
        }

        .red-console button:hover,
        .red-console button:focus-visible {
          border-color: #ffe0b8;
          color: #fff;
        }

        .red-output {
          min-width: 0;
          margin: 0;
          color: rgba(238, 214, 193, 0.62);
          font-size: 0.72rem;
          font-weight: 750;
          line-height: 1.45;
        }

        .red-verdict {
          right: clamp(20px, 5vw, 72px);
          bottom: clamp(22px, 4vh, 44px);
          display: grid;
          grid-template-columns: 92px minmax(0, 1fr);
          gap: 14px;
          width: min(390px, 34vw);
          min-height: 156px;
          padding: 16px;
        }

        .red-verdict-head {
          grid-column: 1 / -1;
        }

        .red-seal {
          position: relative;
          display: grid;
          aspect-ratio: 1;
          place-items: center;
          border: 1px solid rgba(222, 173, 115, 0.34);
          background: radial-gradient(circle, rgba(132, 4, 19, 0.22), transparent 66%);
          overflow: hidden;
        }

        .red-seal::before,
        .red-seal::after {
          content: "";
          position: absolute;
          border: 1px solid rgba(229, 188, 137, 0.34);
        }

        .red-seal::before {
          width: 62%;
          aspect-ratio: 1;
          transform: rotate(45deg);
        }

        .red-seal::after {
          width: 42%;
          aspect-ratio: 1;
          border-radius: 50%;
          box-shadow: 0 0 24px rgba(164, 6, 25, 0.4);
        }

        .red-seal strong {
          position: relative;
          z-index: 1;
          font-family: var(--font-display);
          font-size: 2.8rem;
          font-weight: 900;
          line-height: 1;
          text-shadow: 0 0 14px rgba(255, 34, 55, 0.64);
        }

        .red-verdict-copy {
          align-self: center;
          min-width: 0;
        }

        .red-verdict-copy p {
          margin: 0;
          color: rgba(248, 225, 206, 0.78);
          font-size: 0.78rem;
          font-weight: 750;
          line-height: 1.55;
        }

        .red-verdict-copy small {
          display: block;
          margin-top: 7px;
          color: rgba(225, 180, 132, 0.5);
          font-family: var(--font-ui);
          font-size: 0.58rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .red-memory-echo {
          position: absolute;
          top: 34%;
          right: 8%;
          z-index: 7;
          max-width: 22em;
          margin: 0;
          color: rgba(255, 221, 202, 0.46);
          font-family: var(--font-display);
          font-size: clamp(1.2rem, 2.4vw, 2rem);
          line-height: 1.5;
          text-align: right;
          text-shadow: 0 0 18px #000;
          opacity: 0;
          transform: translateX(12px);
          transition: opacity 0.35s ease, transform 0.35s ease;
        }

        .red-room[data-lamp="memory"] .red-memory-echo {
          opacity: 0.72;
          transform: translateX(0);
        }

        .red-room[data-lamp="silence"] .red-room-art img {
          filter: brightness(0.44) contrast(1.14) saturate(0.42);
        }

        .red-room[data-lamp="satisfaction"] .red-room-art img,
        .red-room.is-absolved .red-room-art img {
          filter: brightness(0.75) contrast(1.04) saturate(0.7) sepia(0.16);
        }

        .red-room-flash {
          z-index: 40;
          opacity: 0;
          pointer-events: none;
        }

        .red-room.is-judging .red-room-flash {
          background:
            repeating-linear-gradient(0deg, rgba(255, 0, 33, 0.12) 0 1px, transparent 1px 5px),
            radial-gradient(circle at 50% 44%, transparent 0 20%, rgba(123, 0, 16, 0.58) 64%, rgba(0, 0, 0, 0.94) 100%);
          animation: red-judge-flash 0.86s steps(5, end);
        }

        .red-room.is-judging .red-listener::after {
          transform: rotate(-45deg) scale(1.7);
          box-shadow: 0 0 64px rgba(255, 22, 43, 0.9);
        }

        .red-room.is-judging .red-console,
        .red-room.is-judging .red-verdict {
          animation: red-panel-shake 0.48s steps(2, end);
        }

        .red-room.is-absolved .red-seal strong {
          color: #fff0ad;
          text-shadow: 0 0 22px #ffce7a, 0 0 52px rgba(255, 72, 43, 0.54);
        }

        .red-room.is-absolved .red-seal {
          border-color: rgba(255, 221, 153, 0.72);
          box-shadow: 0 0 34px rgba(255, 187, 84, 0.18);
        }

        @keyframes red-room-enter {
          from { opacity: 0; transform: scale(1.12); filter: brightness(0.2) contrast(1.4) saturate(0.3); }
          to { opacity: 1; transform: scale(1.035); filter: brightness(0.65) contrast(1.08) saturate(0.76); }
        }

        @keyframes red-copy-enter {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes red-panel-enter {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes red-listener-orbit {
          to { transform: rotate(360deg); }
        }

        @keyframes red-judge-flash {
          0%, 100% { opacity: 0; }
          18%, 52% { opacity: 1; }
          34%, 76% { opacity: 0.22; }
        }

        @keyframes red-panel-shake {
          0%, 100% { transform: translate(0, 0); }
          20% { transform: translate(-7px, 2px); }
          42% { transform: translate(6px, -3px); }
          64% { transform: translate(-4px, -2px); }
          82% { transform: translate(3px, 3px); }
        }

        @media (max-width: 920px) {
          html,
          body {
            overflow: auto;
          }

          .red-room {
            min-height: 1120px;
          }

          .red-heading {
            top: 74px;
            left: 18px;
            width: calc(100% - 36px);
          }

          .red-heading h1 {
            font-size: clamp(3rem, 15vw, 5rem);
          }

          .red-lead {
            max-width: 32em;
          }

          .red-lamps {
            top: 250px;
            right: 12px;
            left: 12px;
            grid-template-columns: repeat(3, 1fr);
          }

          .red-lamp {
            min-height: 70px;
          }

          .red-listener {
            top: 435px;
            width: 118px;
          }

          .red-memory-echo {
            top: 390px;
            right: 18px;
            max-width: 13em;
            font-size: 1.1rem;
          }

          .red-console {
            top: 560px;
            right: 12px;
            bottom: auto;
            left: 12px;
            width: auto;
          }

          .red-console textarea {
            display: none;
          }

          .red-mobile-offerings {
            display: grid;
            gap: 9px;
          }

          .red-verdict {
            top: 875px;
            right: 12px;
            bottom: auto;
            left: 12px;
            width: auto;
          }

          .red-room-art img {
            position: fixed;
            object-position: center top;
          }
        }

        @media (max-width: 520px) {
          .red-topbar {
            min-height: 52px;
          }

          .red-nav a:last-child {
            display: none;
          }

          .red-heading {
            top: 66px;
          }

          .red-heading h1 {
            font-size: clamp(2.8rem, 16vw, 4rem);
          }

          .red-lamps {
            top: 238px;
          }

          .red-console-foot {
            align-items: stretch;
            flex-direction: column;
          }

          .red-console-actions {
            display: grid;
            grid-template-columns: 1fr 1fr 42px;
          }

          .red-console button[type="submit"] {
            min-width: 0;
          }

          .red-verdict {
            top: 900px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .red-room-art img,
          .red-heading,
          .red-console,
          .red-verdict,
          .red-listener::before {
            animation: none;
          }
        }
      </style>
      <main class="red-room" data-confession-page data-lamp="none" data-confessions="0">
        <picture class="red-room-art" aria-hidden="true">
          <source srcset="../../../assets/generated/manzokukyo/red-confession-chamber.avif" type="image/avif">
          <source srcset="../../../assets/generated/manzokukyo/red-confession-chamber.webp" type="image/webp">
          <img src="../../../assets/manzokukyo/red-confession-chamber.png" alt="">
        </picture>
        <div class="red-room-shade" aria-hidden="true"></div>
        <div class="red-room-noise" aria-hidden="true"></div>

        <header class="red-topbar">
          <span class="red-area">Satisfaction Cult / Area 02</span>
          <nav class="red-nav" aria-label="赤い懺悔室メニュー">
            <a href="../">← 真理の扉</a>
            <a href="../../../">残念院さん公式設定</a>
          </nav>
        </header>

        <section class="red-heading" aria-labelledby="red-confession-title">
          <p class="red-kicker">Leave one thing behind</p>
          <h1 id="red-confession-title">赤い懺悔室</h1>
          <p class="red-lead">満足していないことを、ひとつだけ置いていく。部屋は裁かない。ただ、あなたの声と選んだ灯りを少しだけ覚えている。</p>
        </section>

        <div class="red-lamps" role="group" aria-label="三つの灯り" data-confession-switches>
          <button class="red-lamp" type="button" data-lamp="silence" aria-pressed="false"><i aria-hidden="true"></i><small>LAMP 01</small><strong>沈黙</strong></button>
          <button class="red-lamp" type="button" data-lamp="memory" aria-pressed="false"><i aria-hidden="true"></i><small>LAMP 02</small><strong>記憶</strong></button>
          <button class="red-lamp" type="button" data-lamp="satisfaction" aria-pressed="false"><i aria-hidden="true"></i><small>LAMP 03</small><strong>満足</strong></button>
        </div>

        <button class="red-listener" type="button" data-listener aria-label="格子の向こうを覗く" title="格子の向こうを覗く">
          <span class="red-listener-hint" aria-hidden="true">look through</span>
        </button>
        <p class="red-memory-echo" aria-hidden="true" data-memory-echo>前にここへ来た声が、まだ壁の中にいる。</p>

        <form class="red-console" data-confession-form>
          <div class="red-console-head">
            <span>Confession intake</span>
            <output class="red-counter" data-confession-counter>000 / 180</output>
          </div>
          <label for="confession-text">懺悔欄</label>
          <textarea id="confession-text" name="confession" maxlength="180" autocomplete="off" placeholder="まだ満足していないことを、ひとつだけ"></textarea>
          <div class="red-mobile-offerings" data-mobile-offerings aria-label="三枚の懺悔札">
            <div class="red-mobile-offerings-head">
              <p>札をタップして、懺悔を組み立てる。</p>
              <button type="button" data-mobile-shuffle>札を混ぜる</button>
            </div>
            <div class="red-mobile-slots">
              <button class="red-mobile-slot" type="button" data-confession-slot="0"><small>札・起</small><strong data-slot-label>ほんとうは</strong></button>
              <button class="red-mobile-slot" type="button" data-confession-slot="1"><small>札・行</small><strong data-slot-label>満足したふりをした</strong></button>
              <button class="red-mobile-slot" type="button" data-confession-slot="2"><small>札・結</small><strong data-slot-label>少し反省しています</strong></button>
            </div>
          </div>
          <div class="red-meter" aria-hidden="true"><span data-confession-meter></span></div>
          <div class="red-console-foot">
            <p class="red-output" data-confession-output aria-live="polite">帳の向こうで、返事を待っている。</p>
            <div class="red-console-actions">
              <button type="submit">懺悔を渡す</button>
              <button type="button" data-random-confession>代筆</button>
              <button type="button" data-clear-confession aria-label="懺悔を消す" title="懺悔を消す">×</button>
            </div>
          </div>
        </form>

        <aside class="red-verdict" aria-label="懺悔室からの返答">
          <div class="red-verdict-head">
            <span>Room response</span>
            <span data-verdict-status>waiting</span>
          </div>
          <div class="red-seal" aria-hidden="true"><strong data-sigil-word>未</strong></div>
          <div class="red-verdict-copy">
            <p data-confession-log aria-live="polite">三つの灯りのうち、ひとつを選べる。</p>
            <small data-confession-count>confessions / 00</small>
          </div>
        </aside>

        <div class="red-room-flash" aria-hidden="true"></div>
      </main>
      <script>
        (() => {
          const page = document.querySelector("[data-confession-page]");
          const form = document.querySelector("[data-confession-form]");
          const textarea = document.querySelector("#confession-text");
          const output = document.querySelector("[data-confession-output]");
          const log = document.querySelector("[data-confession-log]");
          const sigil = document.querySelector("[data-sigil-word]");
          const counter = document.querySelector("[data-confession-counter]");
          const countLabel = document.querySelector("[data-confession-count]");
          const verdictStatus = document.querySelector("[data-verdict-status]");
          const memoryEcho = document.querySelector("[data-memory-echo]");
          const randomButton = document.querySelector("[data-random-confession]");
          const clearButton = document.querySelector("[data-clear-confession]");
          const listener = document.querySelector("[data-listener]");
          const lampButtons = Array.from(document.querySelectorAll(".red-lamp[data-lamp]"));
          const mobileShuffle = document.querySelector("[data-mobile-shuffle]");
          const confessionSlots = Array.from(document.querySelectorAll("[data-confession-slot]"));
          const mobileQuery = window.matchMedia("(max-width: 920px)");

          if (!page || !form || !textarea || !output || !log || !sigil || !counter) return;

          const sampleConfessions = [
            "カップ麺の待ち時間を一分だけごまかしました。",
            "満足したふりをして、まだ次の満足を探しています。",
            "赤い部屋へ戻るリンクを確認してから怖がっています。",
            "今日はなにもしていないのに、少しだけ誇らしいです。"
          ];
          const slotOptions = [
            ["ほんとうは", "今日も", "こっそり", "気づけば"],
            ["満足したふりをした", "何もしなかった", "夜更かしをやめられなかった", "ラーメンを一口もらった"],
            ["少し反省しています", "でも後悔はしていません", "もう忘れたいです", "まだ満足していません"]
          ];
          const lampTexts = {
            silence: "沈黙の灯りが点いた。書かれた言葉だけが、重く残る。",
            memory: "記憶の灯りが点いた。壁の中で、以前の声が目を覚ます。",
            satisfaction: "満足の灯りが点いた。赤が少しだけ、やさしい色になる。"
          };
          const verdicts = [
            "帳は閉じた。まだ赤い。",
            "受理された。満足には、少し届かない。",
            "格子の向こうで小さな拍手がした。誰のものかは、考えない方がいい。",
            "赤い灯りが一度だけ瞬いた。今の言葉は、しばらく残る。"
          ];
          const whispers = [
            "もう少し近くで話して。",
            "前の人は、そこまで言わなかった。",
            "その灯り、本当に自分で選んだ？",
            "満足したら、ここへは戻れない。"
          ];
          let confessionCount = 0;
          let whisperIndex = 0;
          const slotIndices = [0, 0, 0];

          const includesSatisfaction = (text) => text.includes("満足") || text.includes("まんぞく");

          const updateLevel = () => {
            const text = textarea.value.trim();
            const level = Math.min(1, Array.from(text).length / 120);
            page.style.setProperty("--sin-level", level.toFixed(3));
            counter.textContent = String(Array.from(textarea.value).length).padStart(3, "0") + " / 180";
            sigil.textContent = includesSatisfaction(text) ? "満" : text.length > 54 ? "罪" : "未";
          };

          const renderMobileConfession = () => {
            const parts = slotOptions.map((options, index) => options[slotIndices[index] % options.length]);
            confessionSlots.forEach((button, index) => {
              const label = button.querySelector("[data-slot-label]");
              if (label) label.textContent = parts[index];
            });
            textarea.value = parts[0] + "、" + parts[1] + "。" + parts[2] + "。";
            updateLevel();
          };

          const shuffleMobileConfession = () => {
            slotIndices.forEach((_, index) => {
              slotIndices[index] = Math.floor(Math.random() * slotOptions[index].length);
            });
            renderMobileConfession();
            output.textContent = "三枚の札が、新しい懺悔を作った。";
          };

          const syncInputMode = () => {
            textarea.readOnly = mobileQuery.matches;
            textarea.tabIndex = mobileQuery.matches ? -1 : 0;
            if (mobileQuery.matches && !textarea.value) renderMobileConfession();
          };

          const setLamp = (button) => {
            const wasActive = button.getAttribute("aria-pressed") === "true";
            lampButtons.forEach((item) => item.setAttribute("aria-pressed", "false"));
            const lamp = wasActive ? "none" : (button.dataset.lamp || "none");
            if (!wasActive) button.setAttribute("aria-pressed", "true");
            page.dataset.lamp = lamp;
            log.textContent = lamp === "none" ? "灯りが消えた。格子だけが残った。" : lampTexts[lamp];
            verdictStatus.textContent = lamp === "none" ? "waiting" : lamp;
            if (lamp === "satisfaction") sigil.textContent = "満";
            else updateLevel();
          };

          const judge = () => {
            const text = textarea.value.trim();
            page.classList.remove("is-absolved", "is-listening");
            page.classList.remove("is-judging");
            void page.offsetWidth;
            page.classList.add("is-judging");
            window.setTimeout(() => page.classList.remove("is-judging"), 900);

            if (!text) {
              output.textContent = "空白も声になる。けれど、今日は受け取らない。";
              log.textContent = "格子の向こうで、指が二度だけ鳴った。";
              sigil.textContent = "空";
              verdictStatus.textContent = "refused";
              return;
            }

            confessionCount += 1;
            page.dataset.confessions = String(confessionCount);
            countLabel.textContent = "confessions / " + String(confessionCount).padStart(2, "0");

            if (includesSatisfaction(text) || page.dataset.lamp === "satisfaction") {
              output.textContent = "今日だけ、あなたの懺悔は軽くなった。";
              log.textContent = "奥の帳がわずかに開いた。先はまだ、作られていない。";
              sigil.textContent = "赦";
              verdictStatus.textContent = "absolved";
              page.classList.add("is-absolved");
              return;
            }

            const score = Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), text.length);
            output.textContent = verdicts[score % verdicts.length];
            log.textContent = page.dataset.lamp === "memory"
              ? "壁が今の言葉を復唱した。最後の一音だけ、あなたの声ではなかった。"
              : "部屋は受理した。灯りを変えると、返事も変わるかもしれない。";
            verdictStatus.textContent = "recorded";
            sigil.textContent = "罪";
          };

          textarea.addEventListener("input", updateLevel);
          textarea.addEventListener("focus", () => page.classList.add("is-listening"));
          textarea.addEventListener("blur", () => page.classList.remove("is-listening"));
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            judge();
          });

          randomButton?.addEventListener("click", () => {
            if (mobileQuery.matches) {
              shuffleMobileConfession();
            } else {
              textarea.value = sampleConfessions[Math.floor(Math.random() * sampleConfessions.length)];
              updateLevel();
            }
            output.textContent = "代筆された懺悔が、告解台に置かれた。";
            if (!mobileQuery.matches) textarea.focus();
          });

          clearButton?.addEventListener("click", () => {
            if (mobileQuery.matches) {
              slotIndices.fill(0);
              renderMobileConfession();
            } else {
              textarea.value = "";
            }
            page.classList.remove("is-absolved", "is-listening");
            updateLevel();
            output.textContent = "消した跡だけが、きれいに残った。";
            log.textContent = "三つの灯りのうち、ひとつを選べる。";
            verdictStatus.textContent = "waiting";
            if (!mobileQuery.matches) textarea.focus();
          });

          confessionSlots.forEach((button, index) => {
            button.addEventListener("click", () => {
              slotIndices[index] = (slotIndices[index] + 1) % slotOptions[index].length;
              renderMobileConfession();
              output.textContent = "一枚の札が裏返った。";
            });
          });

          mobileShuffle?.addEventListener("click", shuffleMobileConfession);
          mobileQuery.addEventListener?.("change", syncInputMode);

          lampButtons.forEach((button) => button.addEventListener("click", () => setLamp(button)));

          listener?.addEventListener("click", () => {
            page.classList.add("is-listening");
            const whisper = whispers[whisperIndex % whispers.length];
            whisperIndex += 1;
            log.textContent = whisper;
            memoryEcho.textContent = whisper;
            window.setTimeout(() => page.classList.remove("is-listening"), 1200);
          });

          page.addEventListener("pointermove", (event) => {
            const rect = page.getBoundingClientRect();
            page.style.setProperty("--mouse-x", ((event.clientX - rect.left) / rect.width * 100).toFixed(2) + "%");
            page.style.setProperty("--mouse-y", ((event.clientY - rect.top) / rect.height * 100).toFixed(2) + "%");
          });

          syncInputMode();
          updateLevel();
        })();
      </script>
    `
  });
}

function renderManzokukyoRedHouseLegacy(character) {
  const title = "赤い懺悔室";
  const description = "真理の扉の先にある、赤い灯りと懺悔のギミックで遊ぶ少し怖いページです。";

  return htmlPage({
    title: `${title} | 満足教`,
    description,
    urlPath: `${character.id}/manzokukyo/truth/red-house/`,
    imagePath: `${character.id}/assets/generated/ogp.png`,
    type: "website",
    theme: character.theme,
    stylesheetHref: "../../../../styles.css",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${title} | 満足教`,
      description,
      url: absoluteUrl(`${character.id}/manzokukyo/truth/red-house/`),
      inLanguage: "ja",
      isPartOf: {
        "@type": "WebSite",
        name: "Character Canon",
        url: absoluteUrl("")
      },
      about: {
        "@type": "Thing",
        name: "満足教",
        description
      }
    },
    body: `
      <style>
        html,
        body {
          min-height: 100%;
          margin: 0;
          background: #060102;
        }

        .red-confession-page,
        .red-confession-page *,
        .red-confession-page *::before,
        .red-confession-page *::after {
          box-sizing: border-box;
        }

        .red-confession-page {
          --mouse-x: 50%;
          --mouse-y: 48%;
          --sin-level: 0;
          --lamp-alpha: 0.32;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          min-height: 100svh;
          overflow: hidden;
          padding: clamp(18px, 5vw, 56px);
          background:
            radial-gradient(circle at var(--mouse-x) var(--mouse-y), rgba(255, 68, 68, calc(0.12 + var(--lamp-alpha) * 0.18)), transparent 18%),
            repeating-linear-gradient(90deg, rgba(255, 45, 45, 0.04) 0 1px, transparent 1px 44px),
            linear-gradient(180deg, #210305 0%, #080102 58%, #020000 100%);
          color: #ffe7df;
          font-family: var(--font-sans);
          isolation: isolate;
          transition: background 0.28s ease;
        }

        .red-confession-page::before,
        .red-confession-page::after {
          position: absolute;
          inset: 0;
          z-index: -1;
          content: "";
          pointer-events: none;
        }

        .red-confession-page::before {
          background:
            linear-gradient(90deg, rgba(12, 0, 0, 0.86), transparent 18% 82%, rgba(12, 0, 0, 0.86)),
            repeating-linear-gradient(0deg, transparent 0 16px, rgba(255, 195, 168, 0.035) 17px 18px);
          opacity: 0.86;
        }

        .red-confession-page::after {
          background:
            radial-gradient(circle at 50% 47%, transparent 0 34%, rgba(0, 0, 0, 0.72) 74%),
            linear-gradient(rgba(255, 0, 0, 0.08), rgba(255, 0, 0, 0.02));
          mix-blend-mode: multiply;
        }

        .red-confession-room {
          min-width: 0;
          width: 100%;
          max-width: 1040px;
          border: 1px solid rgba(255, 109, 86, 0.62);
          padding: clamp(18px, 4vw, 34px);
          background:
            linear-gradient(135deg, rgba(104, 7, 10, 0.88), rgba(18, 2, 3, 0.98) 58%),
            repeating-linear-gradient(90deg, rgba(255, 221, 190, 0.04) 0 2px, transparent 2px 18px);
          box-shadow:
            inset 0 0 0 1px rgba(0, 0, 0, 0.86),
            0 0 0 8px rgba(255, 0, 0, 0.06),
            0 22px 80px rgba(0, 0, 0, 0.74),
            0 0 62px rgba(255, 0, 0, calc(0.16 + var(--lamp-alpha) * 0.24));
          backdrop-filter: blur(10px);
        }

        .red-confession-small {
          margin: 0 0 8px;
          color: #ffc7ac;
          font-size: 0.82rem;
          font-weight: 900;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }

        .red-confession-header {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: clamp(16px, 4vw, 34px);
          align-items: start;
          margin-bottom: clamp(18px, 4vw, 30px);
        }

        .red-confession-header > div {
          min-width: 0;
        }

        .red-confession-header h1 {
          margin: 0;
          color: #fff3e8;
          font-family: var(--font-display);
          font-size: 6.4rem;
          line-height: 0.95;
          text-shadow:
            0 0 10px rgba(255, 45, 45, 0.9),
            3px 3px 0 #100000,
            -1px -1px 0 rgba(255, 216, 179, 0.34);
          overflow-wrap: anywhere;
        }

        .red-confession-lead {
          max-width: 58ch;
          margin: 14px 0 0;
          color: #ffd7c5;
          font-weight: 850;
          line-height: 1.8;
          overflow-wrap: anywhere;
        }

        .red-confession-eye {
          position: relative;
          display: grid;
          width: clamp(118px, 17vw, 170px);
          aspect-ratio: 1;
          place-items: center;
          border: 1px solid rgba(255, 199, 172, 0.55);
          border-radius: 50%;
          background:
            radial-gradient(circle at var(--mouse-x) var(--mouse-y), #fff7df 0 9%, #d11224 10% 22%, #260004 23% 48%, #070001 49% 100%);
          box-shadow:
            inset 0 0 34px rgba(0, 0, 0, 0.92),
            0 0 42px rgba(255, 0, 0, 0.34);
          overflow: hidden;
        }

        .red-confession-eye::after {
          width: 54%;
          height: 16%;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.72);
          box-shadow: 0 0 18px rgba(0, 0, 0, 0.9);
          content: "";
          transform: rotate(-4deg);
        }

        .red-confession-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.08fr) minmax(280px, 0.92fr);
          gap: clamp(16px, 3vw, 28px);
          align-items: stretch;
          min-width: 0;
        }

        .confession-booth,
        .confession-panel {
          min-width: 0;
          border: 1px solid rgba(255, 170, 132, 0.32);
          background: rgba(12, 0, 2, 0.72);
          box-shadow: inset 0 0 26px rgba(0, 0, 0, 0.62);
        }

        .confession-booth {
          display: grid;
          gap: 14px;
          padding: clamp(16px, 3vw, 24px);
        }

        .confession-booth label,
        .confession-panel h2 {
          margin: 0;
          color: #ffe0cf;
          font-size: 0.92rem;
          font-weight: 950;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .confession-booth textarea {
          width: 100%;
          min-width: 0;
          min-height: 178px;
          resize: vertical;
          border: 1px solid rgba(255, 172, 132, 0.44);
          border-radius: 0;
          padding: 14px 15px;
          background:
            linear-gradient(rgba(50, 0, 4, 0.74), rgba(16, 0, 2, 0.92)),
            repeating-linear-gradient(0deg, transparent 0 31px, rgba(255, 120, 90, 0.12) 32px 33px);
          color: #fff2e8;
          font: inherit;
          font-weight: 800;
          line-height: 1.75;
          outline: none;
          box-shadow: inset 0 0 22px rgba(0, 0, 0, 0.56);
        }

        .confession-booth textarea:focus {
          border-color: #ffd0b8;
          box-shadow:
            inset 0 0 22px rgba(0, 0, 0, 0.56),
            0 0 0 3px rgba(255, 116, 84, 0.22);
        }

        .confession-meter {
          height: 12px;
          border: 1px solid rgba(255, 184, 145, 0.42);
          background: #130002;
          overflow: hidden;
        }

        .confession-meter span {
          display: block;
          width: calc(var(--sin-level) * 100%);
          height: 100%;
          background:
            linear-gradient(90deg, #ffddb8, #ff4c4c 55%, #910010);
          box-shadow: 0 0 18px rgba(255, 61, 61, 0.82);
          transition: width 0.22s ease;
        }

        .confession-output {
          min-height: 4.2em;
          margin: 0;
          color: #ffd8c7;
          font-weight: 850;
          line-height: 1.7;
          overflow-wrap: anywhere;
        }

        .confession-actions,
        .confession-switches,
        .red-confession-links {
          display: flex;
          flex-wrap: wrap;
          gap: 10px;
        }

        .confession-actions button,
        .confession-switches button,
        .red-confession-links a {
          max-width: 100%;
          border: 1px solid rgba(255, 206, 178, 0.54);
          border-radius: 0;
          min-height: 44px;
          padding: 10px 13px;
          background: #150003;
          color: #ffe2d2;
          font: inherit;
          font-weight: 950;
          text-decoration: none;
          box-shadow: inset 0 -2px 0 rgba(255, 74, 74, 0.24);
          cursor: pointer;
        }

        .confession-actions button:hover,
        .confession-switches button:hover,
        .red-confession-links a:hover {
          border-color: #ffe5d7;
          background: #340006;
        }

        .confession-actions button:first-child {
          background: linear-gradient(180deg, #9a0712, #350004);
        }

        .confession-panel {
          display: grid;
          gap: 16px;
          padding: clamp(16px, 3vw, 24px);
        }

        .confession-sigil {
          position: relative;
          display: grid;
          min-height: 220px;
          place-items: center;
          border: 1px solid rgba(255, 178, 140, 0.22);
          background:
            radial-gradient(circle at center, rgba(255, 70, 70, calc(0.1 + var(--lamp-alpha) * 0.24)), transparent 35%),
            repeating-conic-gradient(from 4deg, rgba(255, 193, 146, 0.08) 0 8deg, transparent 8deg 18deg),
            #090001;
          overflow: hidden;
        }

        .confession-sigil::before,
        .confession-sigil::after {
          position: absolute;
          border: 1px solid rgba(255, 214, 187, 0.38);
          content: "";
        }

        .confession-sigil::before {
          width: 62%;
          aspect-ratio: 1;
          transform: rotate(45deg);
        }

        .confession-sigil::after {
          width: 34%;
          aspect-ratio: 1;
          border-radius: 50%;
          box-shadow: 0 0 28px rgba(255, 0, 0, 0.38);
        }

        .confession-sigil strong {
          position: relative;
          z-index: 1;
          color: #fff0dc;
          font-family: var(--font-display);
          font-size: 4.2rem;
          line-height: 1;
          text-shadow: 0 0 14px rgba(255, 0, 0, 0.86), 2px 2px 0 #000;
        }

        .confession-switches button[aria-pressed="true"] {
          border-color: #fff1dd;
          background: #6f000b;
          color: #fff7ed;
          box-shadow:
            inset 0 0 18px rgba(255, 201, 173, 0.12),
            0 0 18px rgba(255, 29, 29, 0.32);
        }

        .confession-log {
          min-height: 4.6em;
          margin: 0;
          color: #ffcdb7;
          font-weight: 850;
          line-height: 1.7;
          overflow-wrap: anywhere;
        }

        .red-confession-links {
          margin-top: clamp(16px, 3vw, 26px);
          justify-content: center;
        }

        .red-confession-page.is-judging .red-confession-room {
          animation: confession-shudder 0.42s steps(2, end);
        }

        .red-confession-page.is-absolved .red-confession-eye {
          background:
            radial-gradient(circle at center, #fff8e3 0 18%, #ffcf8f 19% 31%, #310005 32% 100%);
        }

        .red-confession-page.is-absolved .confession-sigil strong {
          color: #fff7df;
        }

        @keyframes confession-shudder {
          0%,
          100% {
            transform: translate(0, 0);
          }

          25% {
            transform: translate(-6px, 4px);
          }

          50% {
            transform: translate(5px, -3px);
          }

          75% {
            transform: translate(-3px, -2px);
          }
        }

        @media (max-width: 780px) {
          .red-confession-header,
          .red-confession-grid {
            grid-template-columns: 1fr;
          }

          .red-confession-header h1 {
            font-size: 3.6rem;
          }

          .red-confession-eye {
            justify-self: start;
          }
        }

        @media (max-width: 480px) {
          .red-confession-page {
            padding: 16px;
          }

          .red-confession-room {
            width: 100%;
            max-width: calc(100vw - 32px);
          }

          .red-confession-header h1 {
            font-size: 2.7rem;
          }

          .confession-sigil strong {
            font-size: 3.1rem;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            animation-duration: 0.001ms !important;
            scroll-behavior: auto !important;
            transition-duration: 0.001ms !important;
          }
        }

      </style>
      <main class="red-confession-page" data-confession-page>
        <section class="red-confession-room" aria-labelledby="red-confession-title">
          <header class="red-confession-header">
            <div>
              <p class="red-confession-small">red confession room / area 02</p>
              <h1 id="red-confession-title">赤い懺悔室</h1>
              <p class="red-confession-lead">赤い灯りの下で、満足していないことをひとつだけ置いていく。扉は裁かない。ただ、少しだけ覚えている。</p>
            </div>
            <div class="red-confession-eye" aria-hidden="true"></div>
          </header>

          <div class="red-confession-grid">
            <form class="confession-booth" data-confession-form>
              <label for="confession-text">懺悔欄</label>
              <textarea id="confession-text" name="confession" maxlength="180" autocomplete="off" placeholder="例: 今日はまだ満足していない"></textarea>
              <div class="confession-meter" aria-hidden="true"><span data-confession-meter></span></div>
              <p class="confession-output" data-confession-output aria-live="polite">赤い帳の向こうで、誰かが返事を待っている。</p>
              <div class="confession-actions">
                <button type="submit">懺悔する</button>
                <button type="button" data-random-confession>代筆させる</button>
                <button type="button" data-clear-confession>忘れる</button>
              </div>
            </form>

            <aside class="confession-panel" aria-label="懺悔室の仕掛け">
              <h2>三つの灯り</h2>
              <div class="confession-sigil" aria-hidden="true"><strong data-sigil-word>未</strong></div>
              <div class="confession-switches" data-confession-switches>
                <button type="button" data-lamp="silence" aria-pressed="false">沈黙</button>
                <button type="button" data-lamp="memory" aria-pressed="false">記憶</button>
                <button type="button" data-lamp="satisfaction" aria-pressed="false">満足</button>
              </div>
              <p class="confession-log" data-confession-log aria-live="polite">灯りを選ぶと、部屋の機嫌が変わる。</p>
            </aside>
          </div>

          <nav class="red-confession-links" aria-label="赤い懺悔室メニュー">
            <a href="../">真理の扉へ戻る</a>
            <a href="../../../">残念院さん公式設定へ戻る</a>
          </nav>
        </section>
      </main>
      <script>
        (() => {
          const page = document.querySelector("[data-confession-page]");
          const form = document.querySelector("[data-confession-form]");
          const textarea = document.querySelector("#confession-text");
          const meter = document.querySelector("[data-confession-meter]");
          const output = document.querySelector("[data-confession-output]");
          const log = document.querySelector("[data-confession-log]");
          const sigil = document.querySelector("[data-sigil-word]");
          const randomButton = document.querySelector("[data-random-confession]");
          const clearButton = document.querySelector("[data-clear-confession]");
          const lampButtons = Array.from(document.querySelectorAll("[data-lamp]"));

          if (!page || !form || !textarea || !meter || !output || !log || !sigil) {
            return;
          }

          const sampleConfessions = [
            "カップ麺の待ち時間を一分だけごまかしました。",
            "満足したふりをして、まだ次の満足を探しています。",
            "赤い部屋の戻るリンクを確認してから怖がっています。",
            "今日はなにもしていないのに、少しだけ誇らしいです。"
          ];
          const lampTexts = {
            silence: "沈黙の灯りが点いた。文字数だけが、やけに正直だ。",
            memory: "記憶の灯りが点いた。前に来た気配だけが、ほんの少し濃くなる。",
            satisfaction: "満足の灯りが点いた。部屋の赤が、少しだけやさしい赤になる。"
          };
          const verdicts = [
            "帳は閉じた。まだ赤い。",
            "懺悔は受理された。満足には、少し届かない。",
            "壁の向こうで小さな拍手がした。誰のものかは、考えない方がいい。",
            "赤い灯りが一度だけ瞬いた。今の言葉は、しばらく残る。"
          ];

          const setLevel = () => {
            const text = textarea.value.trim();
            const level = Math.min(1, text.length / 90);
            page.style.setProperty("--sin-level", level.toFixed(2));
            page.style.setProperty("--lamp-alpha", (0.24 + level * 0.48).toFixed(2));
            meter.style.width = "";
            sigil.textContent = text.includes("満足") || text.includes("まんぞく") ? "満" : text.length > 54 ? "罪" : "未";
          };

          const judge = () => {
            const text = textarea.value.trim();
            page.classList.remove("is-absolved");
            page.classList.add("is-judging");
            window.setTimeout(() => page.classList.remove("is-judging"), 460);

            if (!text) {
              output.textContent = "空白は懺悔ではない。けれど、空白にも温度はある。";
              sigil.textContent = "空";
              return;
            }

            if (text.includes("満足") || text.includes("まんぞく")) {
              output.textContent = "赤い懺悔室は満足した。今日だけ、あなたの罪は軽い。";
              log.textContent = "奥の扉が半分だけ開いた気がする。まだ先は作りかけだ。";
              sigil.textContent = "赦";
              page.classList.add("is-absolved");
              return;
            }

            const index = (text.length + Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0)) % verdicts.length;
            output.textContent = verdicts[index];
            log.textContent = "三つの灯りは、まだ答えを選びきれていない。";
          };

          textarea.addEventListener("input", setLevel);
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            judge();
          });

          randomButton?.addEventListener("click", () => {
            const next = sampleConfessions[Math.floor(Math.random() * sampleConfessions.length)];
            textarea.value = next;
            setLevel();
            output.textContent = "代筆された懺悔が、赤い紙に滲んだ。";
            textarea.focus();
          });

          clearButton?.addEventListener("click", () => {
            textarea.value = "";
            page.classList.remove("is-absolved");
            setLevel();
            output.textContent = "忘れたことだけが、きれいに残った。";
            log.textContent = "灯りを選ぶと、部屋の機嫌が変わる。";
            textarea.focus();
          });

          lampButtons.forEach((button) => {
            button.addEventListener("click", () => {
              const active = button.getAttribute("aria-pressed") !== "true";
              lampButtons.forEach((item) => item.setAttribute("aria-pressed", "false"));
              button.setAttribute("aria-pressed", active ? "true" : "false");
              const lamp = button.dataset.lamp || "silence";
              log.textContent = active ? lampTexts[lamp] : "灯りが消えた。赤だけが残った。";
              page.style.setProperty("--lamp-alpha", active ? "0.84" : "0.32");
              if (active && lamp === "satisfaction") {
                sigil.textContent = "満";
              } else {
                setLevel();
              }
            });
          });

          page.addEventListener("pointermove", (event) => {
            const rect = page.getBoundingClientRect();
            page.style.setProperty("--mouse-x", ((event.clientX - rect.left) / rect.width * 100).toFixed(2) + "%");
            page.style.setProperty("--mouse-y", ((event.clientY - rect.top) / rect.height * 100).toFixed(2) + "%");
          });

          setLevel();
        })();
      </script>
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
    headExtra: renderGuestbookHead("../../"),
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
          --mk-gate-opacity: 0;
          --mk-gate-scale: 0.78;
          --mk-gate-z: -760px;
          --mk-walk-opacity: 0;
          --mk-walk-scale: 1.02;
          --mk-walk-x: 0px;
          --mk-walk-y: 0px;
          --mk-walk-blur: 0px;
          --mk-door-scene-opacity: 0;
          --mk-door-scene-scale: 0.84;
          --mk-floor-shift: 0px;
          --mk-hud-opacity: 0;
          --mk-threshold-glow: 0;
          --mk-ornament-opacity: 1;
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
          opacity: calc(0.74 * var(--mk-ornament-opacity));
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
          top: -42%;
          right: 0;
          left: 0;
          display: block;
          width: 100%;
          height: 142%;
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

        .mk-bgm-toggle {
          position: fixed;
          left: clamp(22px, 4vw, 72px);
          bottom: clamp(22px, 4vw, 58px);
          z-index: 82;
          display: inline-flex;
          min-height: 52px;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(88, 246, 255, 0.56);
          border-radius: 999px;
          padding: 12px 20px;
          background:
            radial-gradient(circle at 28% 18%, rgba(88, 246, 255, 0.22), transparent 42%),
            rgba(8, 7, 11, 0.78);
          color: #fff7dc;
          font: inherit;
          font-size: 0.9rem;
          font-weight: 900;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          box-shadow:
            0 0 34px rgba(88, 246, 255, 0.18),
            0 20px 60px rgba(0, 0, 0, 0.54);
          cursor: pointer;
          transition: border-color 0.28s ease, box-shadow 0.28s ease, color 0.28s ease;
        }

        .mk-bgm-toggle:hover,
        .mk-bgm-toggle:focus-visible,
        .mk-bgm-toggle[aria-pressed="true"] {
          border-color: rgba(215, 180, 81, 0.82);
          color: #fff0b8;
          box-shadow:
            0 0 42px rgba(215, 180, 81, 0.3),
            0 22px 64px rgba(0, 0, 0, 0.62);
        }

        .mk-page .guestbook-launch {
          right: clamp(22px, 4vw, 72px);
          bottom: clamp(22px, 4vw, 58px);
          z-index: 81;
          min-height: 52px;
          padding: 12px 20px;
          font-size: 0.9rem;
          letter-spacing: 0.08em;
          transition: bottom 0.38s ease;
        }

        .mk-page[data-ritual-state="ended"] .guestbook-launch {
          bottom: calc(clamp(22px, 4vw, 58px) + 66px);
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
          opacity: calc(0.52 * var(--mk-ornament-opacity));
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
          opacity: var(--mk-ornament-opacity);
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

        .mk-scroll-cue {
          position: fixed;
          top: clamp(92px, 14vh, 150px);
          right: clamp(24px, 5vw, 88px);
          z-index: 12;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          border: 1px solid rgba(215, 180, 81, 0.48);
          border-radius: 999px;
          padding: 12px 16px;
          background:
            radial-gradient(circle at 85% 50%, rgba(215, 180, 81, 0.18), transparent 46%),
            rgba(8, 7, 11, 0.68);
          color: rgba(255, 247, 220, 0.88);
          font-family: var(--font-ui);
          font-size: 0.78rem;
          font-weight: 900;
          letter-spacing: 0.18em;
          opacity: var(--mk-copy-opacity);
          pointer-events: none;
          text-transform: uppercase;
          box-shadow:
            0 0 28px rgba(215, 180, 81, 0.18),
            0 18px 52px rgba(0, 0, 0, 0.36);
        }

        .mk-scroll-cue::before {
          content: "";
          width: 34px;
          height: 1px;
          background: linear-gradient(90deg, var(--cult-gold), transparent);
        }

        .mk-scroll-cue::after {
          content: "↓";
          color: var(--cult-gold);
          animation: mk-click-pulse 1.1s steps(2, end) infinite;
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

        .mk-truth-gate {
          position: fixed;
          top: 50%;
          left: 50%;
          z-index: 34;
          display: grid;
          width: min(76vw, 560px);
          min-height: min(72vw, 420px);
          place-items: center;
          padding: clamp(24px, 5vw, 56px);
          border: 1px solid rgba(215, 180, 81, 0.64);
          color: #fff7dc;
          text-align: center;
          text-decoration: none;
          opacity: var(--mk-gate-opacity);
          pointer-events: none;
          transform:
            translate(-50%, -50%)
            perspective(1200px)
            translateZ(var(--mk-gate-z))
            scale(var(--mk-gate-scale));
          transform-style: preserve-3d;
          transition: opacity 0.26s ease, filter 0.26s ease;
          filter:
            drop-shadow(0 0 28px rgba(215, 180, 81, 0.24))
            drop-shadow(0 0 70px rgba(126, 60, 255, 0.18));
          will-change: transform, opacity;
        }

        .mk-truth-gate::before,
        .mk-truth-gate::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
        }

        .mk-truth-gate::before {
          border: 1px solid rgba(255, 239, 172, 0.46);
          background:
            radial-gradient(ellipse at 50% 18%, rgba(255, 238, 166, 0.18), transparent 34%),
            linear-gradient(90deg, transparent 0 10%, rgba(215, 180, 81, 0.36) 10.4% 10.8%, transparent 11.2% 88.8%, rgba(215, 180, 81, 0.36) 89.2% 89.6%, transparent 90%),
            linear-gradient(180deg, rgba(12, 8, 18, 0.42), rgba(0, 0, 0, 0.78));
          clip-path: polygon(18% 0, 82% 0, 100% 18%, 100% 100%, 0 100%, 0 18%);
          box-shadow:
            inset 0 0 64px rgba(0, 0, 0, 0.86),
            inset 0 0 0 10px rgba(215, 180, 81, 0.08),
            0 0 90px rgba(255, 180, 66, 0.2);
        }

        .mk-truth-gate::after {
          inset: -22%;
          background:
            conic-gradient(from 0deg at 50% 50%, transparent 0 28deg, rgba(215, 180, 81, 0.24) 31deg 33deg, transparent 36deg 90deg),
            radial-gradient(circle at 50% 50%, rgba(255, 210, 92, 0.24), rgba(126, 60, 255, 0.12) 28%, transparent 56%);
          opacity: calc(var(--mk-gate-opacity) * 0.78);
          animation: mk-gate-orbit 8s linear infinite;
          mix-blend-mode: screen;
        }

        .mk-truth-gate span,
        .mk-truth-gate strong,
        .mk-truth-gate small {
          position: relative;
          z-index: 1;
          display: block;
          text-shadow:
            2px 0 rgba(255, 51, 92, 0.32),
            -2px 0 rgba(88, 246, 255, 0.28),
            0 0 24px rgba(255, 206, 92, 0.28);
        }

        .mk-truth-gate span {
          color: rgba(215, 180, 81, 0.92);
          font-family: var(--font-ui);
          font-size: clamp(0.74rem, 1.8vw, 0.9rem);
          font-weight: 900;
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }

        .mk-truth-gate strong {
          margin-top: 14px;
          font-family: var(--font-display);
          font-size: clamp(2.8rem, 9vw, 6.2rem);
          line-height: 0.92;
        }

        .mk-truth-gate small {
          margin-top: 18px;
          color: rgba(245, 234, 210, 0.74);
          font-family: var(--font-ui);
          font-size: clamp(0.72rem, 1.7vw, 0.86rem);
          font-weight: 800;
          letter-spacing: 0.24em;
          text-transform: uppercase;
          animation: mk-click-pulse 1.2s steps(2, end) infinite;
        }

        .mk-page[data-depth-end="true"] .mk-truth-gate {
          pointer-events: auto;
        }

        .mk-page[data-entering-truth="true"] .mk-truth-gate {
          filter:
            drop-shadow(0 0 46px rgba(255, 238, 166, 0.52))
            drop-shadow(0 0 120px rgba(126, 60, 255, 0.34));
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

        @keyframes mk-gate-orbit {
          to {
            transform: rotate(360deg);
          }
        }

        @keyframes mk-click-pulse {
          50% {
            opacity: 0.38;
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

        .mk-walk-scene {
          position: absolute;
          inset: 0;
          z-index: 2;
          overflow: hidden;
          background: #050407;
          opacity: var(--mk-walk-opacity);
          pointer-events: none;
          transform: translate3d(0, var(--mk-walk-y), 0);
          transition: opacity 0.18s linear;
        }

        .mk-walk-scene::before,
        .mk-walk-scene::after {
          content: "";
          position: absolute;
          inset: 0;
          z-index: 8;
          pointer-events: none;
        }

        .mk-walk-scene::before {
          background:
            linear-gradient(rgba(255, 255, 255, 0.025) 50%, transparent 50%),
            radial-gradient(ellipse at 50% 48%, transparent 0 42%, rgba(0, 0, 0, 0.3) 72%, rgba(0, 0, 0, 0.9) 100%);
          background-size: 100% 4px, auto;
        }

        .mk-walk-scene::after {
          background:
            linear-gradient(90deg, rgba(0, 0, 0, 0.46), transparent 18% 82%, rgba(0, 0, 0, 0.46)),
            radial-gradient(ellipse at 50% 48%, rgba(215, 180, 81, calc(0.04 + var(--mk-threshold-glow) * 0.1)), transparent 34%);
          mix-blend-mode: screen;
        }

        .mk-walk-corridor,
        .mk-final-door-scene {
          position: absolute;
          inset: -5%;
          background-position: center;
          background-repeat: no-repeat;
          background-size: cover;
          will-change: transform, opacity, filter;
        }

        .mk-walk-corridor {
          z-index: 1;
          background-image: url("../assets/generated/manzokukyo/corridor-v2.webp");
          opacity: calc(1 - var(--mk-door-scene-opacity) * 0.82);
          transform:
            translate3d(var(--mk-walk-x), var(--mk-walk-y), 0)
            scale(var(--mk-walk-scale));
          transform-origin: 50% 54%;
          filter:
            blur(var(--mk-walk-blur))
            brightness(calc(0.78 + var(--mk-depth) * 0.14))
            contrast(1.08)
            saturate(0.88);
        }

        .mk-final-door-scene {
          z-index: 5;
          background-image: url("../assets/generated/manzokukyo/door-v2.webp");
          opacity: var(--mk-door-scene-opacity);
          transform:
            translate3d(calc(var(--mk-walk-x) * -0.16), calc(var(--mk-walk-y) * 0.34), 0)
            scale(var(--mk-door-scene-scale));
          transform-origin: 50% 51%;
          filter:
            brightness(calc(0.78 + var(--mk-threshold-glow) * 0.18))
            contrast(1.08)
            saturate(0.92);
          transition: filter 0.22s ease;
        }

        .mk-passage-ribs {
          position: absolute;
          inset: 0;
          z-index: 3;
          overflow: hidden;
          perspective: 1100px;
          transform-style: preserve-3d;
        }

        .mk-passage-rib {
          --rib-scale: 0.3;
          --rib-opacity: 0;
          position: absolute;
          top: 49%;
          left: 50%;
          width: min(84vw, 1460px);
          height: min(92vh, 920px);
          border: clamp(18px, 3.2vw, 58px) solid rgba(3, 3, 5, 0.92);
          border-bottom-width: clamp(12px, 2vw, 34px);
          border-radius: 46% 46% 3% 3% / 28% 28% 3% 3%;
          opacity: var(--rib-opacity);
          transform: translate(-50%, -50%) scale(var(--rib-scale));
          transform-origin: 50% 54%;
          box-shadow:
            inset 0 0 0 1px rgba(215, 180, 81, 0.16),
            inset 0 0 48px rgba(0, 0, 0, 0.72),
            0 0 30px rgba(0, 0, 0, 0.82);
          will-change: transform, opacity;
        }

        .mk-passage-rib::before {
          content: "";
          position: absolute;
          inset: calc(clamp(18px, 3.2vw, 58px) * -0.72);
          border: 1px solid rgba(215, 180, 81, 0.18);
          border-radius: inherit;
        }

        .mk-walk-floor-lines {
          position: absolute;
          inset: 0;
          z-index: 4;
          clip-path: polygon(0 100%, 100% 100%, 58% 56%, 42% 56%);
          background:
            repeating-linear-gradient(0deg, rgba(215, 180, 81, 0.16) 0 1px, transparent 1px 11vh),
            linear-gradient(90deg, transparent 0 44%, rgba(215, 180, 81, 0.12) 44.3% 44.5%, transparent 44.8% 55.2%, rgba(215, 180, 81, 0.12) 55.5% 55.7%, transparent 56%);
          background-position: center var(--mk-floor-shift), center;
          opacity: calc(0.22 * (1 - var(--mk-door-scene-opacity)));
          filter: drop-shadow(0 0 12px rgba(215, 180, 81, 0.18));
        }

        .mk-walk-fog {
          position: absolute;
          inset: 42% -20% -24%;
          z-index: 6;
          background:
            radial-gradient(ellipse at 22% 72%, rgba(126, 60, 255, 0.16), transparent 34%),
            radial-gradient(ellipse at 76% 62%, rgba(245, 234, 210, 0.1), transparent 32%),
            radial-gradient(ellipse at 50% 86%, rgba(58, 34, 72, 0.2), transparent 48%);
          opacity: calc(0.36 + var(--mk-depth) * 0.24);
          filter: blur(18px);
          transform: translate3d(calc(var(--mk-walk-x) * -2), calc(var(--mk-walk-y) * -1), 0);
          animation: mk-walk-fog-drift 12s ease-in-out infinite alternate;
        }

        .mk-depth-hud {
          position: fixed;
          top: clamp(16px, 3vh, 32px);
          left: 50%;
          z-index: 30;
          display: grid;
          width: min(520px, calc(100% - 180px));
          grid-template-columns: auto minmax(90px, 1fr) auto;
          align-items: center;
          gap: 12px;
          color: rgba(245, 234, 210, 0.72);
          opacity: var(--mk-hud-opacity);
          transform: translateX(-50%);
          pointer-events: none;
          transition: opacity 0.2s linear;
        }

        .mk-depth-hud span {
          font: 900 0.62rem/1 var(--font-ui);
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .mk-depth-hud i {
          position: relative;
          height: 1px;
          overflow: visible;
          background: rgba(245, 234, 210, 0.2);
        }

        .mk-depth-hud i::before {
          content: "";
          position: absolute;
          top: 50%;
          left: calc(var(--mk-depth) * 100%);
          width: 7px;
          height: 7px;
          border: 1px solid var(--cult-gold);
          background: #08070b;
          transform: translate(-50%, -50%) rotate(45deg);
          box-shadow: 0 0 12px rgba(215, 180, 81, 0.48);
        }

        .mk-truth-gate {
          width: min(38vw, 520px);
          min-height: min(78vh, 740px);
          border: 0;
          padding: 0;
          background: transparent;
          transform:
            translate(-50%, -49%)
            perspective(1200px)
            translateZ(var(--mk-gate-z))
            scale(var(--mk-gate-scale));
          filter: drop-shadow(0 0 46px rgba(126, 60, 255, calc(var(--mk-gate-opacity) * 0.2)));
        }

        .mk-truth-gate::before {
          inset: 2% 7% 12%;
          border: 1px solid rgba(215, 180, 81, calc(0.16 + var(--mk-threshold-glow) * 0.26));
          background: transparent;
          clip-path: polygon(20% 0, 80% 0, 100% 18%, 100% 100%, 0 100%, 0 18%);
          box-shadow:
            inset 0 0 52px rgba(126, 60, 255, calc(var(--mk-threshold-glow) * 0.12)),
            0 0 48px rgba(215, 180, 81, calc(var(--mk-threshold-glow) * 0.12));
        }

        .mk-truth-gate::after {
          display: none;
        }

        .mk-truth-gate span {
          position: absolute;
          top: 4%;
          left: 50%;
          width: max-content;
          transform: translateX(-50%);
        }

        .mk-truth-gate strong {
          position: absolute;
          bottom: 8%;
          left: 50%;
          width: max-content;
          margin: 0;
          border: 1px solid rgba(215, 180, 81, 0.56);
          padding: 11px 18px 13px;
          background: rgba(5, 4, 8, 0.78);
          font-size: clamp(1.45rem, 3.4vw, 2.5rem);
          line-height: 1;
          transform: translateX(-50%);
          backdrop-filter: blur(8px);
        }

        .mk-truth-gate small {
          position: absolute;
          bottom: 2.5%;
          left: 50%;
          width: max-content;
          margin: 0;
          transform: translateX(-50%);
        }

        .mk-page[data-entering-truth="true"] .mk-final-door-scene {
          opacity: 1;
          transform: scale(1.12);
          filter: brightness(1.7) contrast(1.02) saturate(0.72);
          transition: transform 0.62s cubic-bezier(0.22, 1, 0.36, 1), filter 0.62s ease;
        }

        .mk-page[data-entering-truth="true"] .mk-truth-gate strong,
        .mk-page[data-entering-truth="true"] .mk-truth-gate small,
        .mk-page[data-entering-truth="true"] .mk-truth-gate span {
          opacity: 0;
          transition: opacity 0.2s ease;
        }

        @keyframes mk-walk-fog-drift {
          from { translate: -2% 0; }
          to { translate: 2% -3%; }
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

          .mk-depth-hud {
            top: 14px;
            width: calc(100% - 32px);
          }

          .mk-walk-corridor,
          .mk-final-door-scene {
            inset: -3%;
            background-position: 50% center;
          }

          .mk-passage-rib {
            width: 118vw;
            height: 88svh;
          }

          .mk-truth-gate {
            width: min(78vw, 430px);
            min-height: min(72svh, 620px);
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
            opacity: calc(0.78 * var(--mk-ornament-opacity));
          }

          .mk-black-mass {
            right: -22vw;
            left: auto;
            bottom: 0;
            width: 102vw;
            min-width: 0;
            opacity: calc(0.74 * var(--mk-ornament-opacity));
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

          .mk-scroll-cue {
            top: 48px;
            right: 14px;
            max-width: calc(100vw - 28px);
            gap: 6px;
            padding: 6px 10px;
            font-size: 0.58rem;
            line-height: 1.25;
            letter-spacing: 0.08em;
            white-space: nowrap;
          }

          .mk-scroll-cue::before {
            width: 20px;
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
          html,
          body {
            height: auto;
            min-height: 100%;
            overflow: auto;
            scrollbar-width: auto;
            -ms-overflow-style: auto;
          }

          .mk-sigil,
          .mk-altar,
          .mk-eye,
          .mk-whisper span,
          .mk-title::before,
          .mk-title::after,
          .mk-scroll-cue::after,
          .mk-key-visual,
          .mk-key-visual img,
          .mk-key-visual::before,
          .mk-key-visual::after,
          .mk-key-visual-glitch,
          .mk-depth-prop,
          .mk-flame-canvas,
          .mk-truth-gate::after,
          .mk-truth-gate small,
          .mk-wake-overlay,
          .mk-wake-overlay::before,
          .mk-wake-overlay::after,
          .mk-hero::before {
            animation: none;
          }

          .mk-page {
            --mk-copy-opacity: 1;
            --mk-copy-y: 0px;
            --mk-copy-z: 0px;
            --mk-altar-y: 0px;
            --mk-altar-z: 0px;
            --mk-altar-scale: 1;
            --mk-portrait-y: 0px;
            --mk-portrait-z: 0px;
            --mk-portrait-scale: 1;
            --mk-portrait-opacity: 0.72;
            --mk-corridor-opacity: 0;
            --mk-hero-exit: 0;
            --mk-banner-opacity: 0.48;
            --mk-tunnel-opacity: 0;
            --mk-tunnel-scale: 1;
            --mk-footer-opacity: 1;
            height: auto;
            min-height: 100svh;
            overflow: visible;
            perspective: none;
            touch-action: auto;
            user-select: auto;
          }

          .mk-abyss-canvas,
          .mk-perspective-corridor,
          .mk-corridor-props,
          .mk-walk-scene,
          .mk-depth-hud,
          .mk-flame-canvas,
          .mk-ritual-dim,
          .mk-wake-overlay,
          .mk-wake-overlay::before,
          .mk-wake-overlay::after,
          .mk-key-visual-glitch,
          .mk-key-visual-noise,
          .mk-ritual-replay {
            display: none;
          }

          .mk-hero {
            position: relative;
            min-height: 100svh;
            height: auto;
            align-items: center;
            overflow: hidden;
            transform-style: flat;
          }

          .mk-banner {
            transform: none;
          }

          .mk-key-visual {
            position: relative;
            inset: auto;
            width: min(430px, 100%);
            min-width: 0;
            height: auto;
            aspect-ratio: 1;
            margin: 26px 0 0 auto;
            transform: none;
            will-change: auto;
          }

          .mk-key-visual img {
            height: 100%;
            transform: none;
          }

          .mk-black-mass {
            display: none;
          }

          .mk-depth-journey {
            position: relative;
            z-index: 2;
            display: grid;
            gap: 24px;
            width: min(1120px, calc(100% - 32px));
            margin: 0 auto;
            padding: 32px 0 54px;
            overflow: visible;
          }

          .mk-depth-journey::before {
            display: none;
          }

          .mk-section {
            position: relative;
            top: auto;
            left: auto;
            width: 100%;
            min-height: auto;
            margin: 0;
            opacity: 1;
            transform: none;
            pointer-events: auto;
            transition: none;
            will-change: auto;
          }

          .mk-footer {
            opacity: 1;
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
          <div class="mk-walk-scene" aria-hidden="true">
            <div class="mk-walk-corridor"></div>
            <div class="mk-passage-ribs">
              ${Array.from({ length: 10 }, (_, index) => `<div class="mk-passage-rib" data-mk-rib="${index}"></div>`).join("")}
            </div>
            <div class="mk-walk-floor-lines"></div>
            <div class="mk-final-door-scene"></div>
            <div class="mk-walk-fog"></div>
          </div>
          <picture class="mk-key-visual">
            <source srcset="../assets/generated/manzokukyo/key-visual-hero.avif" type="image/avif">
            <img src="../assets/generated/manzokukyo/key-visual-hero.webp" alt="満足教キービジュアル" width="1254" height="1254" fetchpriority="high">
            <span class="mk-key-visual-glitch" aria-hidden="true"></span>
            <canvas class="mk-key-visual-noise" data-mk-portrait-noise aria-hidden="true"></canvas>
          </picture>
          <div class="mk-black-mass" aria-hidden="true">
            <img class="mk-altar-prop" src="../assets/generated/manzokukyo/altar.webp" alt="" width="1672" height="941" loading="eager">
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
            <p class="mk-subtitle">あなたの満足、私たちがお手伝いします。</p>
            <p class="mk-copy">残念院さんがひらく、甘くて不穏な小さな祭壇。満たされたと思った瞬間、次の満足がこちらを見つめている。</p>
          </div>
          <p class="mk-scroll-cue" data-mk-scroll-cue>スクロールで回廊へ進む / 戻る</p>
        </section>
        <div class="mk-ritual-dim" aria-hidden="true"></div>
        <div class="mk-wake-overlay" aria-hidden="true"></div>
        <a class="mk-truth-gate" href="./truth/" data-mk-truth-gate aria-hidden="true">
          <span>Threshold reached</span>
          <strong>扉に触れる</strong>
          <small>click / tap</small>
        </a>
        <div class="mk-depth-hud" aria-hidden="true">
          <span>ENTRY</span>
          <i></i>
          <span data-mk-depth-label>参道</span>
        </div>
        <audio data-mk-bgm src="../assets/generated/manzokukyo/satisfaction-bgm.m4a" preload="metadata" loop></audio>
        <button class="mk-bgm-toggle" type="button" data-mk-bgm-toggle aria-pressed="false" aria-label="BGMを再生">BGM OFF</button>
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
        ${renderGuestbookWidget({
          scope: `${character.id}:guestbook`,
          title: "満足教のあしあと帳",
          description: "満足教ティザーを見た記念に、ひとことだけ残していけます。",
          buttonLabel: "満足あしあと"
        })}
      </main>
      <script>
        (() => {
          const audio = document.querySelector("[data-mk-bgm]");
          const toggle = document.querySelector("[data-mk-bgm-toggle]");
          if (!audio || !toggle) {
            return;
          }

          audio.volume = 0.42;

          function setState(isPlaying) {
            toggle.setAttribute("aria-pressed", isPlaying ? "true" : "false");
            toggle.setAttribute("aria-label", isPlaying ? "BGMを停止" : "BGMを再生");
            toggle.textContent = isPlaying ? "BGM ON" : "BGM OFF";
          }

          toggle.addEventListener("click", async () => {
            if (audio.paused) {
              try {
                await audio.play();
                setState(true);
              } catch {
                setState(false);
              }
            } else {
              audio.pause();
              setState(false);
            }
          });

          audio.addEventListener("pause", () => setState(false));
          audio.addEventListener("play", () => setState(true));
          window.addEventListener("pagehide", () => audio.pause(), { once: true });
          setState(false);
        })();
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
          const ribs = Array.from(document.querySelectorAll("[data-mk-rib]"));
          const truthGate = document.querySelector("[data-mk-truth-gate]");
          const depthLabel = document.querySelector("[data-mk-depth-label]");
          const scrollCue = document.querySelector("[data-mk-scroll-cue]");
          if (!page || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
          }

          let ticking = false;
          let virtualDepth = 0;
          let lastTouchY = null;
          const maxDepth = 6.8;

          function clamp(value, min, max) {
            return Math.min(max, Math.max(min, value));
          }

          function smoothstep(value) {
            const t = clamp(value, 0, 1);
            return t * t * (3 - 2 * t);
          }

          function updateDepth() {
            ticking = false;
            const depth = virtualDepth;
            const sceneDepth = clamp(depth / maxDepth, 0, 1);
            const heroExit = smoothstep(sceneDepth / 0.2);
            const walkIntro = smoothstep((sceneDepth - 0.07) / 0.14);
            const travel = smoothstep((sceneDepth - 0.1) / 0.68);
            const doorApproach = smoothstep((sceneDepth - 0.68) / 0.2);
            const gateReveal = smoothstep((sceneDepth - 0.9) / 0.075);
            const cameraBob = walkIntro * (1 - doorApproach) * Math.sin(depth * 5.4) * 3.2;
            const cameraSway = walkIntro * (1 - doorApproach) * Math.sin(depth * 1.38) * 5.2;
            page.style.setProperty("--mk-depth", sceneDepth.toFixed(3));
            page.style.setProperty("--mk-hero-exit", heroExit.toFixed(3));
            page.style.setProperty("--mk-corridor-opacity", "0");
            page.style.setProperty("--mk-banner-opacity", clamp(1 - heroExit * 0.94, 0.03, 1).toFixed(3));
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
            page.style.setProperty("--mk-ornament-opacity", clamp(1 - heroExit * 1.08, 0, 1).toFixed(3));
            page.style.setProperty("--mk-tunnel-opacity", "0");
            page.style.setProperty("--mk-walk-opacity", walkIntro.toFixed(3));
            page.style.setProperty("--mk-walk-scale", (1.02 + travel * 1.56).toFixed(3));
            page.style.setProperty("--mk-walk-x", cameraSway.toFixed(2) + "px");
            page.style.setProperty("--mk-walk-y", cameraBob.toFixed(2) + "px");
            page.style.setProperty("--mk-walk-blur", (doorApproach * 1.4).toFixed(2) + "px");
            page.style.setProperty("--mk-door-scene-opacity", doorApproach.toFixed(3));
            page.style.setProperty("--mk-door-scene-scale", (0.84 + doorApproach * 0.18).toFixed(3));
            page.style.setProperty("--mk-floor-shift", (depth * 760).toFixed(1) + "px");
            page.style.setProperty("--mk-hud-opacity", (walkIntro * clamp((1 - sceneDepth) / 0.04, 0, 1)).toFixed(3));
            page.style.setProperty("--mk-threshold-glow", gateReveal.toFixed(3));
            page.style.setProperty("--mk-footer-opacity", clamp((sceneDepth - 0.9) / 0.08, 0, 1).toFixed(3));
            page.style.setProperty("--mk-gate-opacity", gateReveal.toFixed(3));
            page.style.setProperty("--mk-gate-scale", (0.94 + gateReveal * 0.06).toFixed(3));
            page.style.setProperty("--mk-gate-z", (-260 + gateReveal * 260).toFixed(1) + "px");
            page.dataset.depthEnd = gateReveal > 0.96 ? "true" : "false";
            page.dataset.walkStage = sceneDepth < 0.1 ? "entry" : sceneDepth < 0.68 ? "corridor" : sceneDepth < 0.9 ? "threshold" : "door";
            if (truthGate) {
              truthGate.setAttribute("aria-hidden", gateReveal > 0.24 ? "false" : "true");
            }

            ribs.forEach((rib, index) => {
              const lane = ((index / Math.max(1, ribs.length)) + travel * 2.25) % 1;
              const nearFade = clamp((1 - lane) / 0.14, 0, 1);
              const scale = 0.3 + Math.pow(lane, 2.1) * 3.15;
              const opacity = Math.sin(lane * Math.PI) * 0.28 * nearFade * walkIntro * (1 - doorApproach);
              rib.style.setProperty("--rib-scale", scale.toFixed(3));
              rib.style.setProperty("--rib-opacity", opacity.toFixed(3));
            });

            if (depthLabel) {
              depthLabel.textContent = sceneDepth < 0.28 ? "参道" : sceneDepth < 0.68 ? "回廊" : sceneDepth < 0.9 ? "扉前" : "到達";
            }
            if (scrollCue) {
              scrollCue.textContent = sceneDepth < 0.1
                ? "スクロールで回廊へ進む / 戻る"
                : sceneDepth < 0.9
                  ? "歩みを進める / 戻る"
                  : "扉はすぐそこにある";
            }
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
            setDepth(virtualDepth + event.deltaY / 1120);
          }, { passive: false });
          window.addEventListener("touchstart", (event) => {
            lastTouchY = event.touches[0]?.clientY ?? null;
          }, { passive: true });
          window.addEventListener("touchmove", (event) => {
            const currentY = event.touches[0]?.clientY;
            if (lastTouchY == null || currentY == null) return;
            event.preventDefault();
            setDepth(virtualDepth + (lastTouchY - currentY) / 760);
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
          truthGate?.addEventListener("click", (event) => {
            if (page.dataset.depthEnd !== "true") {
              event.preventDefault();
              setDepth(maxDepth);
              return;
            }

            event.preventDefault();
            page.dataset.enteringTruth = "true";
            window.setTimeout(() => {
              window.location.href = truthGate.getAttribute("href") || "./truth/";
            }, 520);
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
          const fadeWindows = [
            [0.14, 0.19],
            [0.28, 0.34],
            [0.43, 0.5],
            [0.59, 0.67],
            [0.76, 0.88]
          ];
          const altarSpace = {
            // Coordinates are measured from the top-left of the original altar cutout.
            source: "content/characters/zannenin/assets/manzokukyo/altar-cutout.png",
            width: 1672,
            height: 941,
            flameBleedTopRatio: 0.42
          };
          const candleTips = [
            { id: "left-edge", x: 365, y: 84, flameHeightRatio: 72 / 941, flameWidthRatio: 16 / 1672, seed: 1.2 },
            { id: "left-center", x: 620, y: 94, flameHeightRatio: 86 / 941, flameWidthRatio: 19 / 1672, seed: 2.1 },
            { id: "center", x: 835, y: 56, flameHeightRatio: 108 / 941, flameWidthRatio: 23 / 1672, seed: 3.4 },
            { id: "right-center", x: 1051, y: 94, flameHeightRatio: 86 / 941, flameWidthRatio: 19 / 1672, seed: 4.3 },
            { id: "right-edge", x: 1306, y: 84, flameHeightRatio: 72 / 941, flameWidthRatio: 16 / 1672, seed: 5.5 }
          ];
          let width = 0;
          let height = 0;
          let altarScale = 1;
          let altarOffsetX = 0;
          let altarOffsetY = 0;
          let raf = 0;
          let resizeTimer = 0;
          let startTime = performance.now();
          const resizeRecalculateDelayMs = 800;

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
            const altarCanvasHeightRatio = 1 + altarSpace.flameBleedTopRatio;
            altarScale = Math.min(width / altarSpace.width, height / (altarSpace.height * altarCanvasHeightRatio));
            altarOffsetX = (width - altarSpace.width * altarScale) / 2;
            altarOffsetY = height - altarSpace.height * altarScale;
          }

          function scheduleResizeRecalculation() {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(resize, resizeRecalculateDelayMs);
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
            const lightR = anchor.h * 3.45;
            const lightX = anchor.x;
            const lightY = anchor.y - anchor.h * 0.36;

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = alpha * 1.18;

            const warmAura = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, lightR);
            warmAura.addColorStop(0, "rgba(255, 236, 176, 0.62)");
            warmAura.addColorStop(0.16, "rgba(232, 154, 64, 0.42)");
            warmAura.addColorStop(0.4, "rgba(132, 72, 38, 0.2)");
            warmAura.addColorStop(0.72, "rgba(54, 30, 20, 0.09)");
            warmAura.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = warmAura;
            ctx.beginPath();
            ctx.arc(lightX, lightY, lightR, 0, Math.PI * 2);
            ctx.fill();

            const candleGlow = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, anchor.h * 1.34);
            candleGlow.addColorStop(0, "rgba(255, 245, 204, 0.7)");
            candleGlow.addColorStop(0.24, "rgba(226, 156, 78, 0.42)");
            candleGlow.addColorStop(0.64, "rgba(96, 50, 31, 0.14)");
            candleGlow.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = candleGlow;
            ctx.beginPath();
            ctx.arc(lightX, lightY, anchor.h * 1.34, 0, Math.PI * 2);
            ctx.fill();

            const violetCore = ctx.createRadialGradient(anchor.x, anchor.y - anchor.h * 0.12, 0, anchor.x, anchor.y - anchor.h * 0.12, anchor.h * 1.22);
            violetCore.addColorStop(0, "rgba(154, 104, 170, 0.22)");
            violetCore.addColorStop(0.32, "rgba(62, 34, 78, 0.16)");
            violetCore.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = violetCore;
            ctx.beginPath();
            ctx.arc(anchor.x, anchor.y - anchor.h * 0.12, anchor.h * 1.22, 0, Math.PI * 2);
            ctx.fill();

            const wickBloom = ctx.createRadialGradient(anchor.x, anchor.y, 0, anchor.x, anchor.y, anchor.h * 0.46);
            wickBloom.addColorStop(0, "rgba(255, 231, 184, 0.38)");
            wickBloom.addColorStop(0.38, "rgba(120, 68, 42, 0.14)");
            wickBloom.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = wickBloom;
            ctx.beginPath();
            ctx.arc(anchor.x, anchor.y, anchor.h * 0.46, 0, Math.PI * 2);
            ctx.fill();

            ctx.restore();
          }

          function flameNoise(value, seed) {
            return (
              Math.sin(value * 1.73 + seed) +
              Math.sin(value * 4.11 + seed * 2.37) * 0.52 +
              Math.sin(value * 8.29 + seed * 0.71) * 0.26
            ) / 1.78;
          }

          function flameLobePath(ctx, baseX, baseY, flameH, flameW, lean, time, seed, widthScale, heightScale, swayScale) {
            const left = [];
            const right = [];
            const steps = 9;
            const h = flameH * heightScale;
            const w = flameW * widthScale;
            const t = time * 0.0024;

            for (let i = 0; i <= steps; i++) {
              const p = i / steps;
              const taper = Math.pow(Math.sin(p * Math.PI), 0.58) * (1 - p * 0.18);
              const neck = 1 - Math.pow(p, 2.6) * 0.62;
              const radius = w * (0.34 + taper * 1.08) * neck;
              const sway = flameNoise(t + p * 2.6, seed) * w * swayScale * (0.18 + p * 0.92);
              const center = baseX + lean * p + sway;
              const y = baseY - h * p;
              left.push({
                x: center - radius * (0.76 + flameNoise(t + p * 3.3, seed + 8) * 0.16),
                y
              });
              right.push({
                x: center + radius * (0.76 + flameNoise(t + p * 3.1, seed + 14) * 0.16),
                y
              });
            }

            const tipX = baseX + lean + flameNoise(t + 3.8, seed + 22) * w * 0.68;
            const tipY = baseY - h * (0.98 + flameNoise(t + 5.4, seed + 3) * 0.035);
            ctx.beginPath();
            ctx.moveTo(left[0].x, left[0].y);
            for (let i = 1; i < left.length - 1; i++) {
              const next = left[i + 1];
              ctx.quadraticCurveTo(left[i].x, left[i].y, (left[i].x + next.x) / 2, (left[i].y + next.y) / 2);
            }
            ctx.quadraticCurveTo(left[left.length - 1].x, left[left.length - 1].y, tipX, tipY);
            for (let i = right.length - 1; i > 0; i--) {
              const prev = right[i - 1];
              ctx.quadraticCurveTo(right[i].x, right[i].y, (right[i].x + prev.x) / 2, (right[i].y + prev.y) / 2);
            }
            ctx.quadraticCurveTo(right[0].x, right[0].y, left[0].x, left[0].y);
            ctx.closePath();
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
            ctx.globalAlpha = alpha * 0.84;
            const halo = ctx.createRadialGradient(baseX, baseY - flameH * 0.18, 0, baseX, baseY - flameH * 0.18, flameH * 1.22);
            halo.addColorStop(0, "rgba(255, 240, 193, 0.44)");
            halo.addColorStop(0.18, "rgba(218, 139, 65, 0.3)");
            halo.addColorStop(0.38, "rgba(82, 48, 62, 0.2)");
            halo.addColorStop(0.66, "rgba(28, 18, 38, 0.1)");
            halo.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = halo;
            ctx.beginPath();
            ctx.arc(baseX, baseY - flameH * 0.18, flameH * 1.42, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = alpha * 0.9;
            const tipLight = ctx.createRadialGradient(baseX, baseY, 0, baseX, baseY, flameH * 0.28);
            tipLight.addColorStop(0, "rgba(255, 249, 213, 0.82)");
            tipLight.addColorStop(0.32, "rgba(224, 151, 75, 0.36)");
            tipLight.addColorStop(0.68, "rgba(70, 42, 76, 0.16)");
            tipLight.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = tipLight;
            ctx.beginPath();
            ctx.arc(baseX, baseY, flameH * 0.28, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            const glow = ctx.createRadialGradient(baseX, baseY - flameH * 0.34, 0, baseX, baseY - flameH * 0.34, flameH * 0.94);
            glow.addColorStop(0, "rgba(36, 20, 42, 0.42)");
            glow.addColorStop(0.38, "rgba(16, 10, 24, 0.3)");
            glow.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.ellipse(baseX, baseY - flameH * 0.38, flameW * 3.8, flameH * 0.86, 0, 0, Math.PI * 2);
            ctx.fill();

            const smoke = ctx.createRadialGradient(baseX + lean * 0.22, baseY - flameH * 0.72, 0, baseX + lean * 0.22, baseY - flameH * 0.72, flameH * 0.72);
            smoke.addColorStop(0, "rgba(5, 4, 8, 0.66)");
            smoke.addColorStop(0.46, "rgba(18, 12, 24, 0.34)");
            smoke.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = smoke;
            ctx.beginPath();
            ctx.ellipse(baseX + lean * 0.12, baseY - flameH * 0.68, flameW * 2.2, flameH * 0.58, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = alpha * 0.82;
            const warmShell = ctx.createLinearGradient(baseX, baseY, baseX + lean, baseY - flameH * 0.98);
            warmShell.addColorStop(0, "rgba(255, 248, 220, 0.74)");
            warmShell.addColorStop(0.16, "rgba(226, 162, 82, 0.5)");
            warmShell.addColorStop(0.38, "rgba(154, 77, 56, 0.3)");
            warmShell.addColorStop(0.66, "rgba(58, 35, 66, 0.18)");
            warmShell.addColorStop(0.88, "rgba(12, 8, 18, 0.1)");
            warmShell.addColorStop(1, "rgba(0, 0, 0, 0)");
            flameLobePath(ctx, baseX, baseY, flameH, flameW, lean, time + 40, candleTip.seed + 2, 1.56, 1.03, 1.04);
            ctx.fillStyle = warmShell;
            ctx.fill();
            ctx.restore();

            const outerCore = ctx.createLinearGradient(baseX, baseY, baseX + lean, baseY - flameH * 1.02);
            outerCore.addColorStop(0, "rgba(32, 18, 42, 0.44)");
            outerCore.addColorStop(0.18, "rgba(72, 38, 86, 0.34)");
            outerCore.addColorStop(0.46, "rgba(24, 14, 34, 0.46)");
            outerCore.addColorStop(0.74, "rgba(6, 5, 10, 0.28)");
            outerCore.addColorStop(1, "rgba(0, 0, 0, 0)");
            flameLobePath(ctx, baseX, baseY, flameH, flameW, lean, time, candleTip.seed, 0.92, 0.98, 0.8);
            ctx.fillStyle = outerCore;
            ctx.fill();

            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = alpha * 0.56;
            const edgeLight = ctx.createLinearGradient(baseX - flameW, baseY, baseX + lean, baseY - flameH);
            edgeLight.addColorStop(0, "rgba(255, 232, 171, 0.18)");
            edgeLight.addColorStop(0.32, "rgba(205, 125, 66, 0.15)");
            edgeLight.addColorStop(0.58, "rgba(92, 64, 110, 0.12)");
            edgeLight.addColorStop(1, "rgba(0, 0, 0, 0)");
            flameLobePath(ctx, baseX, baseY, flameH, flameW, lean, time + 120, candleTip.seed + 4, 1.38, 0.98, 1.12);
            ctx.fillStyle = edgeLight;
            ctx.fill();
            ctx.restore();

            ctx.save();
            flameLobePath(ctx, baseX, baseY, flameH, flameW, lean, time, candleTip.seed + 12, 0.9, 0.94, 0.66);
            ctx.clip();
            for (let layer = 0; layer < 13; layer++) {
              const p = layer / 12;
              const t = time * (0.0028 + layer * 0.00028) + candleTip.seed * (layer + 1);
              const startX = baseX + flameNoise(t, candleTip.seed + layer) * flameW * 0.42;
              const endX = baseX + lean * (0.56 + p * 0.36) + flameNoise(t + 2.2, candleTip.seed + layer * 3) * flameW * 0.72;
              const endY = baseY - flameH * (0.28 + p * 0.68);
              ctx.beginPath();
              ctx.moveTo(startX, baseY - flameH * 0.02);
              ctx.bezierCurveTo(
                baseX + flameNoise(t + 0.8, candleTip.seed) * flameW * 0.7,
                baseY - flameH * (0.16 + p * 0.18),
                endX - flameNoise(t + 1.6, candleTip.seed) * flameW * 0.38,
                baseY - flameH * (0.42 + p * 0.28),
                endX,
                endY
              );
              ctx.lineWidth = Math.max(0.65, flameW * (0.38 - p * 0.18));
              const warm = layer % 3 === 0;
              ctx.strokeStyle = warm
                ? "rgba(232, " + (156 + layer * 2) + ", " + (88 + layer) + ", " + (alpha * (0.1 + (1 - p) * 0.1)) + ")"
                : "rgba(" + (58 + layer * 2) + ", " + (38 + layer) + ", " + (70 + layer * 3) + ", " + (alpha * (0.12 + (1 - p) * 0.09)) + ")";
              ctx.stroke();
            }
            ctx.restore();

            const innerCore = ctx.createLinearGradient(baseX, baseY, baseX + lean * 0.72, baseY - flameH * 0.7);
            innerCore.addColorStop(0, "rgba(12, 9, 14, 0.9)");
            innerCore.addColorStop(0.2, "rgba(48, 28, 66, 0.62)");
            innerCore.addColorStop(0.58, "rgba(8, 6, 12, 0.78)");
            innerCore.addColorStop(1, "rgba(0, 0, 0, 0)");
            flameLobePath(ctx, baseX, baseY, flameH, flameW, lean * 0.72, time + 70, candleTip.seed + 18, 0.32, 0.72, 0.58);
            ctx.fillStyle = innerCore;
            ctx.fill();

            const foot = ctx.createRadialGradient(baseX, baseY - flameH * 0.08, 0, baseX, baseY - flameH * 0.08, flameH * 0.24);
            foot.addColorStop(0, "rgba(102, 72, 118, 0.46)");
            foot.addColorStop(0.38, "rgba(36, 22, 46, 0.3)");
            foot.addColorStop(1, "rgba(0, 0, 0, 0)");
            ctx.fillStyle = foot;
            ctx.beginPath();
            ctx.ellipse(baseX, baseY - flameH * 0.04, flameW * 1.25, flameH * 0.12, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = alpha * 0.54;
            const ember = ctx.createLinearGradient(baseX, baseY, baseX, baseY - flameH * 0.56);
            ember.addColorStop(0, "rgba(92, 58, 108, 0.28)");
            ember.addColorStop(0.52, "rgba(44, 28, 58, 0.24)");
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
              ctx.fillStyle = "rgba(52, 36, 66, " + pa + ")";
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
          window.addEventListener("resize", scheduleResizeRecalculation, { passive: true });
          raf = requestAnimationFrame(draw);
          window.addEventListener("pagehide", () => {
            window.clearTimeout(resizeTimer);
            cancelAnimationFrame(raf);
          }, { once: true });
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

function htmlPage({ title, body, theme, description, urlPath = "", imagePath, type = "website", structuredData, headExtra = "", stylesheetHref, bodyClass = "" }) {
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
  <body${bodyClass ? ` class="${escapeHtml(bodyClass)}"` : ""}${theme ? ` style="${escapeHtml(renderThemeStyle(theme))}"` : ""}>
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
    .map((link) => link.canonicalUrl ? absoluteUrl(link.canonicalUrl) : link.url)
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
        { loc: absoluteUrl(`${character.id}/manzokukyo/truth/`), priority: "0.6" },
        { loc: absoluteUrl(`${character.id}/manzokukyo/truth/red-house/`), priority: "0.4" },
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
  document.body.dataset.design = "classic";

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

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
  }

  .retro-marquee span {
    animation: none !important;
    transform: none !important;
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
