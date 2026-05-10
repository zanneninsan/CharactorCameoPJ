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
const target = process.argv[4] ?? "main";
const orientationFilter = process.argv[5] ?? "both";

async function main() {
  const characterPath = path.join(contentDir, characterId, "character.json");
  const character = JSON.parse(await readFile(characterPath, "utf8"));
  const videos = await collectDriveVideos(rootFolderId);
  const probedVideos = await probeVideoDimensions(videos);
  const requestedOrientations = requestedVideoOrientations(orientationFilter);
  const videoSets = Object.fromEntries(
    requestedOrientations.map((orientation) => [orientation, buildVideoSet(probedVideos, orientation)])
  );
  const importedCount = Object.values(videoSets).reduce((sum, set) => sum + set.videos.length, 0);

  if (importedCount === 0) {
    throw new Error(`No ${orientationFilter} video files found in Google Drive folder ${rootFolderId}.`);
  }

  const targetObject = target === "main" ? character : findHiddenPage(character, target);
  const existingPlayer = targetObject.randomVideoPlayer ?? {};
  const nextVideoSets = orientationFilter === "both"
    ? videoSets
    : { ...(existingPlayer.videoSets ?? {}), ...videoSets };
  targetObject.randomVideoPlayer = {
    title: existingPlayer.title ?? "ランダム動画再生",
    description: shouldKeepVideoDescription(existingPlayer, orientationFilter)
      ? existingPlayer.description
      : buildDescription(orientationFilter),
    folderUrl: `https://drive.google.com/drive/folders/${rootFolderId}`,
    orientationFilter,
    videoSets: nextVideoSets
  };

  await writeFile(characterPath, `${JSON.stringify(character, null, 2)}\n`, "utf8");
  console.log(`Imported ${importedCount} ${orientationFilter} Drive video(s) for ${characterId}/${target}.`);
}

function shouldKeepVideoDescription(player, orientation) {
  if (!player.description || player.orientationFilter !== orientation) {
    return false;
  }
  if (orientation === "both" && (player.description.includes("縦動画だけ") || player.description.includes("横動画だけ"))) {
    return false;
  }
  return true;
}

function findHiddenPage(character, slug) {
  const pages = Array.isArray(character.hiddenPages) ? character.hiddenPages : [];
  const page = pages.find((item) => item?.slug === slug);
  if (!page) {
    throw new Error(`Hidden page "${slug}" was not found in ${character.id}.`);
  }
  return page;
}

function buildDescription(orientation) {
  if (orientation === "portrait") {
    return "Google Driveフォルダに置いた縦動画から、再生終了ごとに次の1本をランダムで連続再生します。";
  }
  if (orientation === "landscape") {
    return "Google Driveフォルダに置いた横動画から、再生終了ごとに次の1本をランダムで連続再生します。";
  }
  return "Google Driveフォルダに置いた縦動画・横動画から、向きを切り替えてランダム連続再生します。";
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

async function probeVideoDimensions(videos) {
  const results = [];
  for (const video of videos) {
    if (video.mime !== "video/mp4") {
      results.push(video);
      continue;
    }
    const buffer = await downloadDriveFile(video.id);
    const dimensions = parseMp4Dimensions(buffer);
    results.push({
      ...video,
      ...dimensions,
      orientation: dimensions && dimensions.height > dimensions.width ? "portrait" : "landscape"
    });
  }
  return results;
}

function filterByOrientation(videos, orientation) {
  if (orientation === "all") {
    return videos;
  }
  return videos.filter((video) => video.orientation === orientation);
}

function requestedVideoOrientations(value) {
  if (value === "both" || value === "all") {
    return ["portrait", "landscape"];
  }
  if (value === "portrait" || value === "landscape") {
    return [value];
  }
  throw new Error(`Unknown video orientation "${value}". Use portrait, landscape, both, or all.`);
}

function buildVideoSet(videos, orientation) {
  const filteredVideos = filterByOrientation(videos, orientation);
  return {
    label: orientation === "landscape" ? "横動画" : "縦動画",
    orientation,
    videos: filteredVideos.map((file) => ({
      label: buildLabel(file),
      driveId: file.id,
      mime: file.mime,
      source: "google-drive",
      width: file.width,
      height: file.height,
      orientation: file.orientation
    }))
  };
}

async function downloadDriveFile(fileId) {
  const response = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`);
  if (!response.ok) {
    throw new Error(`Failed to download Google Drive video ${fileId}: ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    throw new Error(`Google Drive returned an HTML confirmation page for ${fileId}; direct download is unavailable.`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function parseMp4Dimensions(buffer) {
  for (const moov of findBoxes(buffer, ["moov"])) {
    for (const trak of findBoxes(buffer, ["trak"], moov.content, moov.end)) {
      const mdia = findBoxes(buffer, ["mdia"], trak.content, trak.end)[0];
      if (mdia && handlerType(buffer, mdia) === "vide") {
        return tkhdDimensions(buffer, trak);
      }
    }
  }
  return null;
}

function findBoxes(buffer, pathParts, start = 0, end = buffer.length) {
  let scopes = [{ content: start, end }];
  for (const type of pathParts) {
    const matches = [];
    for (const scope of scopes) {
      matches.push(...readBoxes(buffer, scope.content, scope.end).filter((box) => box.type === type));
    }
    scopes = matches;
    if (scopes.length === 0) {
      return [];
    }
  }
  return scopes;
}

function readBoxes(buffer, start, end) {
  const result = [];
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > end) break;
      size = readUInt64BE(buffer, offset + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (size < headerSize || offset + size > end) {
      break;
    }

    result.push({ type, start: offset, end: offset + size, content: offset + headerSize });
    offset += size;
  }
  return result;
}

function handlerType(buffer, mdia) {
  const hdlr = findBoxes(buffer, ["hdlr"], mdia.content, mdia.end)[0];
  if (!hdlr) {
    return null;
  }
  return buffer.toString("ascii", hdlr.content + 8, hdlr.content + 12);
}

function tkhdDimensions(buffer, trak) {
  const tkhd = findBoxes(buffer, ["tkhd"], trak.content, trak.end)[0];
  if (!tkhd) {
    return null;
  }

  const version = buffer[tkhd.content];
  const offset = tkhd.content + (version === 1 ? 88 : 76);
  if (offset + 8 > tkhd.end) {
    return null;
  }

  return {
    width: buffer.readUInt32BE(offset) / 65536,
    height: buffer.readUInt32BE(offset + 4) / 65536
  };
}

function readUInt64BE(buffer, offset) {
  return buffer.readUInt32BE(offset) * 2 ** 32 + buffer.readUInt32BE(offset + 4);
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
