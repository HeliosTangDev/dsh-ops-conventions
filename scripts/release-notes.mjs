// 从 CHANGELOG.md 抽出某个版本的发布说明（供 CI 的 gh release create --notes-file 用）。
// 约定：版本段标题形如 `## 0.9.6`，后面可带说明（如 `## 0.9.6（续，2026-11-16 …）`）；
// 同一版本出现多段时按文件顺序拼接（0.9.6 就有「续」段与旧段两处）。
import { readFileSync } from "node:fs";

const HEADING = /^##[ \t]+(\d+\.\d+\.\d+)(.*)$/;

/**
 * @param {string} text CHANGELOG 全文
 * @param {string} version 不带 v 前缀的版本号
 * @returns {string} 说明正文（已去首尾空白）；找不到时返回空串
 */
export function extractReleaseNotes(text, version) {
  const want = String(version ?? "").trim().replace(/^v/i, "");
  const lines = String(text ?? "").split(/\r?\n/);
  const chunks = [];
  let current = null;
  for (const line of lines) {
    const m = HEADING.exec(line);
    if (m) {
      // 命中别的版本 = 本版本段结束；同一版本再出现（如「续」段）则继续收集
      if (current === want && m[1] !== want) break;
      current = m[1];
      continue;
    }
    if (current === want) chunks.push(line);
  }
  return chunks.join("\n").trim();
}

/**
 * 生成发布说明；找不到对应版本时给一条可用的兜底文本，绝不返回空，
 * 避免 CI 里 `gh release create --notes-file` 拿到空文件。
 */
export function buildReleaseNotes(text, version) {
  const want = String(version ?? "").trim().replace(/^v/i, "");
  const body = extractReleaseNotes(text, want);
  if (body) return body;
  return `本版说明见仓库 CHANGELOG.md（未找到 \`## ${want}\` 段）。`;
}

// CLI: node scripts/release-notes.mjs <version> [changelogPath]
if (process.argv[1] && process.argv[1].endsWith("release-notes.mjs")) {
  const version = process.argv[2];
  const file = process.argv[3] || "CHANGELOG.md";
  if (!version) {
    console.error("usage: node scripts/release-notes.mjs <version> [CHANGELOG.md]");
    process.exit(2);
  }
  const text = readFileSync(file, "utf8");
  process.stdout.write(buildReleaseNotes(text, version) + "\n");
}
