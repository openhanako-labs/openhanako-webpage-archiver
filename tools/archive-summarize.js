/**
 * webpage-archiver — 存档摘要生成器 v2.1
 *
 * 扫描存档目录中的 HTML 文件，
 * 提取标题、来源 URL、正文文本、日期，
 * 生成结构化元数据（JSON），供 Agent 做 AI 摘要。
 *
 * v2.1 新增：隐私审计维度
 * - 扫描追踪脚本（Google Analytics、Facebook Pixel 等）
 * - 检测指纹采集 API（WebRTC、Battery、Canvas 等）
 * - 每条发现附「怎么收集的 / 意味着什么 / 能做什么」三段式说明
 *
 * 整合来源：sinceyouarrived.world/taken — 隐私可视化与诚实脚注
 *
 * 触发词：存档摘要、生成摘要、AI 摘要、archive summary
 */

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __PLUGIN_DIR = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), ".."));

const name = "archive_summarize";
const description = "扫描网页存档目录，提取标题、来源 URL、正文文本和日期，生成结构化元数据 JSON。v2.1 新增隐私审计维度：扫描追踪脚本与指纹采集 API。Agent 可基于此生成 AI 摘要、标签和关键实体。触发词：存档摘要、生成摘要、AI 摘要、archive summary。";

const parameters = {
  type: "object",
  properties: {
    archiveDir: { type: "string", description: "存档目录路径（含 .html 文件）" },
    outputPath: { type: "string", description: "JSON 输出路径（可选，默认 archiveDir/metadata.json）" },
    maxFiles: { type: "number", description: "最多处理文件数（默认 50）", default: 50 },
    extractText: { type: "boolean", description: "是否提取干净正文文本（默认 true）", default: true },
    maxTextLength: { type: "number", description: "单文件正文最大字符数（默认 5000）", default: 5000 },
    privacyAudit: { type: "boolean", description: "是否执行隐私审计（默认 true）", default: true },
  },
  required: ["archiveDir"],
};

// ─── 加载外部规则库 ──────────────────────────────────────
// 默认从插件 data/ 目录加载，允许运行时扩展

function loadRuleSet() {
  const rulePaths = [
    path.join(__PLUGIN_DIR, "data", "tracker-patterns.json"),
  ];
  for (const rp of rulePaths) {
    if (fs.existsSync(rp)) {
      try {
        return JSON.parse(fs.readFileSync(rp, "utf-8"));
      } catch {}
    }
  }
  return null;
}

const RULES = loadRuleSet();

// ─── 隐私审计 ──────────────────────────────────────────

function auditPrivacy(htmlContent) {
  const findings = {
    trackers: [],
    fingerprintApis: [],
    riskScore: 0,
    summary: "",
  };

  // 使用外部规则库，兜底内置规则
  const trackerRules = RULES?.trackers || [];
  const fpRules = RULES?.fingerprints || [];
  const weights = RULES?.riskWeights || { tracker: { analytics: 2, advertising: 3 }, fingerprint: { high: 4, medium: 2, low: 1 } };
  const riskThresholds = RULES?.riskLevels || { low: 0, medium: 8, high: 15 };

  // 扫描追踪脚本
  for (const tracker of trackerRules) {
    if (new RegExp(tracker.pattern, "i").test(htmlContent)) {
      const entry = { name: tracker.name, category: tracker.category, how: tracker.how, means: tracker.means, action: tracker.action };
      findings.trackers.push(entry);
      findings.riskScore += (weights.tracker[tracker.category] || 2);
    }
  }

  // 扫描指纹 API
  for (const fp of fpRules) {
    if (new RegExp(fp.pattern, "i").test(htmlContent)) {
      findings.fingerprintApis.push({ name: fp.name, severity: fp.severity, how: fp.how, means: fp.means, action: fp.action });
      findings.riskScore += (weights.fingerprint[fp.severity] || 1);
    }
  }

  // 风险评级
  let riskLevel = "低";
  if (findings.riskScore >= riskThresholds.high) riskLevel = "高";
  else if (findings.riskScore >= riskThresholds.medium) riskLevel = "中";

  findings.summary = `发现 ${findings.trackers.length} 个追踪器，${findings.fingerprintApis.length} 个指纹 API，风险等级：${riskLevel}（评分 ${findings.riskScore}）`;

  return findings;
}

// ─── 元数据提取 ──────────────────────────────────────────

function extractMetadata(htmlContent, filePath, doPrivacyAudit) {
  const result = {
    file: path.basename(filePath),
    title: "",
    url: "",
    date: "",
    text: "",
    tags: [],
    entities: [],
  };

  // 标题
  const titleMatch = htmlContent.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ||
                     htmlContent.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (titleMatch) result.title = titleMatch[1].trim().slice(0, 200);

  // 来源 URL
  const urlMatch = htmlContent.match(/<!--\s*original-url:\s*(https?:\/\/[^\s]+)\s*-->/i) ||
                   htmlContent.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i);
  if (urlMatch) result.url = urlMatch[1].trim();

  // 日期
  const dateMatch = htmlContent.match(/<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i) ||
                    htmlContent.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i);
  if (dateMatch) {
    result.date = dateMatch[1].trim().slice(0, 10);
  } else {
    try { result.date = fs.statSync(filePath).mtime.toISOString().slice(0, 10); } catch {}
  }

  // 正文
  const text = htmlContent
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 10000);
  result.text = text;

  // 简易标签
  const words = result.title.split(/[\s\-_]+/).filter(w => w.length >= 2);
  result.tags = words.slice(0, 5);

  // 隐私审计
  if (doPrivacyAudit) {
    result.privacy = auditPrivacy(htmlContent);
  }

  return result;
}

// ─── 主执行 ──────────────────────────────────────────

export async function execute(input = {}, ctx) {
  const { outputPath, maxFiles = 50, extractText = true, maxTextLength = 5000, privacyAudit = true } = input;

  // 默认 archiveDir 使用 plugin-data 目录
  const defaultDir = ctx?.dataDir || path.join(os.homedir(), ".hanako", "plugin-data", "webpage-archiver");
  const archiveDir = input.archiveDir || defaultDir;

  if (!archiveDir) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "archiveDir 必填" }, null, 2) }] };
  }

  if (!fs.existsSync(archiveDir)) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "目录不存在: " + archiveDir }, null, 2) }] };
  }

  // 收集 HTML 文件
  let htmlFiles = [];
  try {
    htmlFiles = fs.readdirSync(archiveDir)
      .filter(f => f.endsWith(".html"))
      .map(f => path.join(archiveDir, f))
      .slice(0, maxFiles);
  } catch (e) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "读取目录失败: " + e.message }, null, 2) }] };
  }

  if (htmlFiles.length === 0) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "目录中没有 .html 文件" }, null, 2) }] };
  }

  // 提取元数据
  const records = [];
  let totalTrackers = 0;
  let totalFingerprints = 0;
  let highRiskFiles = 0;

  for (const file of htmlFiles) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const meta = extractMetadata(content, file, privacyAudit);
      if (extractText) {
        meta.text = meta.text.slice(0, maxTextLength);
      } else {
        delete meta.text;
      }
      if (privacyAudit && meta.privacy) {
        totalTrackers += meta.privacy.trackers.length;
        totalFingerprints += meta.privacy.fingerprintApis.length;
        if (meta.privacy.riskScore >= 15) highRiskFiles++;
      }
      records.push(meta);
    } catch {}
  }

  // 输出 JSON
  const outPath = outputPath || path.join(archiveDir, "metadata.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const output = {
    generatedAt: new Date().toISOString(),
    archiveDir,
    totalFiles: records.length,
    privacySummary: privacyAudit ? {
      totalTrackers,
      totalFingerprints,
      highRiskFiles,
      avgRiskScore: records.length > 0
        ? Math.round(records.filter(r => r.privacy).reduce((sum, r) => sum + r.privacy.riskScore, 0) / records.length * 10) / 10
        : 0,
    } : undefined,
    files: records,
  };
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

  // 生成 Markdown 摘要清单
  const mdPath = outPath.replace(/\.json$/, "") + "-summary.md";
  let md = "# 存档摘要清单\n\n";
  md += "> 生成时间：" + output.generatedAt + "\n";
  md += "> 文件数：" + records.length + "\n";

  if (privacyAudit && output.privacySummary) {
    md += "> 隐私审计：发现 " + totalTrackers + " 个追踪器，" + totalFingerprints + " 个指纹 API，" + highRiskFiles + " 个高风险文件\n";
  }

  md += "\n";

  for (const r of records) {
    md += "## " + (r.title || r.file) + "\n\n";
    md += "- **来源**: " + (r.url || "未知") + "\n";
    md += "- **日期**: " + (r.date || "未知") + "\n";
    md += "- **标签**: " + (r.tags.length ? r.tags.join(", ") : "无") + "\n";

    if (privacyAudit && r.privacy) {
      md += "- **隐私风险**: " + r.privacy.summary + "\n";
      if (r.privacy.trackers.length) {
        md += "  - 追踪器: " + r.privacy.trackers.map(t => t.name).join(", ") + "\n";
      }
      if (r.privacy.fingerprintApis.length) {
        md += "  - 指纹 API: " + r.privacy.fingerprintApis.map(f => f.name).join(", ") + "\n";
      }
    }

    md += "\n";
    if (r.text) {
      const snippet = r.text.replace(/\n/g, " ").slice(0, 300);
      md += "> " + snippet + "...\n\n";
    }
    md += "---\n\n";
  }
  fs.writeFileSync(mdPath, md, "utf-8");

  // 构建返回
  const response = {
    ok: true,
    totalFiles: records.length,
    jsonPath: outPath,
    markdownPath: mdPath,
    message: "✅ 已生成 " + records.length + " 个存档的元数据\n📄 " + outPath + "\n📝 " + mdPath,
  };

  if (privacyAudit) {
    response.privacy = output.privacySummary;
  }

  return {
    content: [{
      type: "text",
      text: JSON.stringify(response, null, 2),
    }],
  };
}

export { name, description, parameters };
