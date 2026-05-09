import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const scanDirs = ["AGENTS.md", "README.md", "content", "docs", "schemas", "scripts"];
const textExtensions = new Set([".json", ".md", ".mjs", ".js", ".css", ".html", ".txt"]);
const ignoredDirs = new Set(["dist", "node_modules", ".git", ".build-lock"]);
const ignoredFiles = new Set([path.join("docs", "encoding-safety.md")]);

const mojibakeFragments = [
  "\u7e3a",
  "\u7e67",
  "\u8b41",
  "\u8708",
  "\u881f",
  "\u9aef",
  "\u8373",
  "\u9015",
  "\u8811",
  "\u9695",
  "\u9b06",
  "\u9adf",
  "\u83a0",
  "\u87b3",
  "\u9a65",
];

const findings = [];

function isTextFile(filePath) {
  return textExtensions.has(path.extname(filePath));
}

function collectFiles(entryPath) {
  const fullPath = path.join(rootDir, entryPath);
  if (!fs.existsSync(fullPath)) {
    return [];
  }

  const stat = fs.statSync(fullPath);
  if (stat.isFile()) {
    return isTextFile(fullPath) ? [fullPath] : [];
  }

  const files = [];
  for (const entry of fs.readdirSync(fullPath, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) {
      continue;
    }

    const relativePath = path.join(entryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(relativePath));
    } else if (isTextFile(relativePath) && !ignoredFiles.has(relativePath)) {
      files.push(path.join(rootDir, relativePath));
    }
  }
  return files;
}

function lineAndColumn(text, index) {
  const before = text.slice(0, index);
  const lines = before.split(/\r?\n/);
  return {
    line: lines.length,
    column: lines.at(-1).length + 1,
  };
}

function addFinding(filePath, type, index, match) {
  const relativePath = path.relative(rootDir, filePath);
  const location = lineAndColumn(fs.readFileSync(filePath, "utf8"), index);
  findings.push({
    file: relativePath,
    type,
    line: location.line,
    column: location.column,
    match,
  });
}

for (const entry of scanDirs) {
  for (const filePath of collectFiles(entry)) {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      addFinding(filePath, "UTF-8 BOM", 0, "BOM");
    }

    const text = buffer.toString("utf8");
    const replacementIndex = text.indexOf("\uFFFD");
    if (replacementIndex !== -1) {
      addFinding(filePath, "Unicode replacement character", replacementIndex, "\uFFFD");
    }

    for (const fragment of mojibakeFragments) {
      const index = text.indexOf(fragment);
      if (index !== -1) {
        addFinding(filePath, "possible mojibake fragment", index, fragment);
      }
    }
  }
}

if (findings.length > 0) {
  console.error("Possible encoding/mojibake issues found:");
  for (const finding of findings) {
    console.error(
      `- ${finding.file}:${finding.line}:${finding.column} ${finding.type}: ${JSON.stringify(finding.match)}`,
    );
  }
  process.exit(1);
}

console.log("Encoding check passed.");
