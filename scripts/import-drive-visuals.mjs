import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.join(rootDir, "content", "characters");
const folderMime = "application/vnd.google-apps.folder";
const imageMimes = new Set(["image/jpeg", "image/png", "image/webp"]);
const defaultFolderId = "1JiEWJgxa6w5T--V_8YlxrBjfnUMqbnpF";

const characterId = process.argv[2] ?? "zannenin";
const rootFolderId = process.argv[3] ?? defaultFolderId;

async function main() {
  const characterPath = path.join(contentDir, characterId, "character.json");
  const character = JSON.parse(await readFile(characterPath, "utf8"));
  const importDir = path.join(contentDir, characterId, "assets", "drive-visuals");
  await mkdir(importDir, { recursive: true });

  const files = await collectDriveImages(rootFolderId);
  const existingReferences = Array.isArray(character.visualReferences) ? character.visualReferences : [];
  const existingDriveIds = new Set(existingReferences.map((item) => item.driveId).filter(Boolean));
  const existingPaths = new Set(existingReferences.map((item) => item.path).filter(Boolean));
  const additions = [];

  for (const file of files) {
    if (existingDriveIds.has(file.id)) {
      continue;
    }

    const relativePath = path.posix.join("assets", "drive-visuals", `${slugifyPath([...file.folders, file.name])}.webp`);
    if (existingPaths.has(relativePath)) {
      continue;
    }

    const outputPath = path.join(contentDir, characterId, relativePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    const imageBuffer = await downloadDriveFile(file.id);
    await sharp(imageBuffer)
      .rotate()
      .resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 86, alphaQuality: 92 })
      .toFile(outputPath);

    additions.push({
      label: buildLabel(file),
      path: relativePath,
      type: inferType(file.folders),
      description: buildDescription(file),
      source: "google-drive",
      driveId: file.id
    });
    existingDriveIds.add(file.id);
    existingPaths.add(relativePath);
    console.log(`Imported ${file.folders.join(" / ")} / ${file.name}`);
  }

  character.visualReferences = [...existingReferences, ...additions];
  await writeFile(characterPath, `${JSON.stringify(character, null, 2)}\n`, "utf8");
  console.log(`Imported ${additions.length} new visual reference(s).`);
}

async function collectDriveImages(rootId) {
  const seenFolders = new Set();
  const images = [];

  async function visit(folderId, folders = []) {
    if (seenFolders.has(folderId)) {
      return;
    }
    seenFolders.add(folderId);

    const entries = await listDriveFolder(folderId);
    for (const entry of entries) {
      if (entry.mime === folderMime) {
        await visit(entry.id, [...folders, entry.name]);
      } else if (imageMimes.has(entry.mime)) {
        images.push({ ...entry, folders });
      }
    }
  }

  await visit(rootId);
  return images;
}

async function listDriveFolder(folderId) {
  const response = await fetch(`https://drive.google.com/drive/folders/${folderId}`);
  if (!response.ok) {
    throw new Error(`Failed to list Google Drive folder ${folderId}: ${response.status}`);
  }

  const html = decodeDriveHtml(await response.text());
  const recordPattern = /\[\[null,"([A-Za-z0-9_-]{20,})"\],null,null,null,"([^"]+)"([\s\S]*?)(?=,\[\[null,"[A-Za-z0-9_-]{20,}"\],null,null,null,"|$)/g;
  const entries = [];
  let match;

  while ((match = recordPattern.exec(html))) {
    const [, id, mime, record] = match;
    const name = record.match(/\[\[\["([^"]+)"/)?.[1];
    if (!name || id === folderId) {
      continue;
    }
    entries.push({ id, mime, name });
  }

  return [...new Map(entries.map((entry) => [entry.id, entry])).values()];
}

function decodeDriveHtml(value) {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("\\u003d", "=")
    .replaceAll("\\u0026", "&");
}

async function downloadDriveFile(fileId) {
  const response = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`);
  if (!response.ok) {
    throw new Error(`Failed to download Google Drive file ${fileId}: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    throw new Error(`Google Drive returned an HTML confirmation page for ${fileId}; direct download is unavailable.`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function buildLabel(file) {
  const group = file.folders.at(-1);
  const baseName = file.name.replace(/\.[^.]+$/, "");
  return group ? `${group}: ${baseName}` : baseName;
}

function buildDescription(file) {
  const location = file.folders.length > 0 ? file.folders.join(" / ") : "公式資料集";
  return `Google Drive公式資料集「${location}」から取り込んだビジュアル資料。元ファイル名: ${file.name}`;
}

function inferType(folders) {
  const joined = folders.join(" ");
  if (joined.includes("衣装")) return "outfit";
  if (joined.includes("表情")) return "expression";
  if (joined.includes("ネタ")) return "meme";
  return "reference";
}

function slugifyPath(parts) {
  const joined = parts.join("-");
  const ascii = joined
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const hash = hashText(joined);
  return `${ascii || "drive-visual"}-${hash}`;
}

function hashText(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
