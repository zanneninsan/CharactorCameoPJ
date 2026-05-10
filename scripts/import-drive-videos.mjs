import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.join(rootDir, "content", "characters");
const folderMime = "application/vnd.google-apps.folder";
const videoMimes = new Set(["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"]);
const defaultFolderId = "11gm-Sd1oVcIlhSTCvDPiga1g-CiL2TDn";

const characterId = process.argv[2] ?? "zannenin";
const rootFolderId = process.argv[3] ?? defaultFolderId;
const hiddenPageSlug = process.argv[4] ?? "secret";

async function main() {
  const characterPath = path.join(contentDir, characterId, "character.json");
  const character = JSON.parse(await readFile(characterPath, "utf8"));
  const videos = await collectDriveVideos(rootFolderId);

  if (videos.length === 0) {
    throw new Error(`No supported video files found in Google Drive folder ${rootFolderId}.`);
  }

  const targetPage = findHiddenPage(character, hiddenPageSlug);
  targetPage.randomVideoPlayer = {
    title: targetPage.randomVideoPlayer?.title ?? "ランダム動画再生",
    description: targetPage.randomVideoPlayer?.description ?? "Google Driveフォルダに置いた動画から、アクセスごとにランダムで1本を表示します。",
    folderUrl: `https://drive.google.com/drive/folders/${rootFolderId}`,
    videos: videos.map((file) => ({
      label: buildLabel(file),
      driveId: file.id,
      mime: file.mime,
      source: "google-drive"
    }))
  };

  await writeFile(characterPath, `${JSON.stringify(character, null, 2)}\n`, "utf8");
  console.log(`Imported ${videos.length} Drive video(s) for ${characterId}/${hiddenPageSlug}.`);
}

function findHiddenPage(character, slug) {
  const pages = Array.isArray(character.hiddenPages) ? character.hiddenPages : [];
  const page = pages.find((item) => item?.slug === slug);
  if (!page) {
    throw new Error(`Hidden page "${slug}" was not found in ${character.id}.`);
  }
  return page;
}

async function collectDriveVideos(rootId) {
  const seenFolders = new Set();
  const videos = [];

  async function visit(folderId, folders = []) {
    if (seenFolders.has(folderId)) {
      return;
    }
    seenFolders.add(folderId);

    const entries = await listDriveFolder(folderId);
    for (const entry of entries) {
      if (entry.mime === folderMime) {
        await visit(entry.id, [...folders, entry.name]);
      } else if (videoMimes.has(entry.mime)) {
        videos.push({ ...entry, folders });
      }
    }
  }

  await visit(rootId);
  return videos.sort((a, b) => buildLabel(a).localeCompare(buildLabel(b), "ja"));
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

function buildLabel(file) {
  const group = file.folders.at(-1);
  const baseName = file.name.replace(/\.[^.]+$/, "");
  return group ? `${group}: ${baseName}` : baseName;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
