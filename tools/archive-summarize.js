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

// ─── 追踪脚本指纹库 ──────────────────────────────────────

const TRACKER_PATTERNS = [
  { pattern: /google-analytics\.com|googletagmanager\.com|gtag\(|ga\(/i, name: "Google Analytics", category: "analytics",
    how: "通过页面嵌入的 JS 脚本加载 Google Analytics 追踪代码",
    means: "记录页面访问、用户行为、来源渠道、设备信息",
    action: "可使用 uBlock Origin 等广告拦截器屏蔽；浏览器隐私设置可限制追踪" },
  { pattern: /facebook\.net\/.*fbevents|fbq\(|connect\.facebook\.net/i, name: "Facebook Pixel", category: "analytics",
    how: "通过 Meta Pixel 脚本注入页面",
    means: "记录用户行为用于 Facebook 广告归因和受众画像",
    action: "广告拦截器可屏蔽；或使用 Firefox/Safari 内置追踪保护" },
  { pattern: /hotjar\.com/i, name: "Hotjar", category: "analytics",
    how: "通过 Hotjar 追踪脚本注入页面",
    means: "记录会话回放、热力图、用户行为 funnel",
    action: "广告拦截器可屏蔽" },
  { pattern: /clarity\.ms/i, name: "Microsoft Clarity", category: "analytics",
    how: "注入 Clarity 追踪脚本",
    means: "记录会话回放、热力图、用户行为",
    action: "广告拦截器可屏蔽" },
  { pattern: /doubleclick\.net|adservice\.google/i, name: "Google Ads / DoubleClick", category: "advertising",
    how: "通过 DoubleClick 广告网络加载",
    means: "跨站追踪用户用于广告投放",
    action: "广告拦截器可屏蔽；浏览器可启用隐私沙箱" },
  { pattern: /amazon-adsystem\.com|amzn\.to/i, name: "Amazon Ads", category: "advertising",
    how: "通过 Amazon 广告脚本加载",
    means: "记录用户行为用于亚马逊广告归因",
    action: "广告拦截器可屏蔽" },
  { pattern: /plausible\.io|matomo\.cloud|umami\.is/i, name: "隐私友好分析工具", category: "analytics",
    how: "加载隐私友好的分析脚本",
    means: "通常不使用 Cookie、不追踪个人身份信息",
    action: "通常无需干预，这类工具设计上尊重隐私" },
];

const FINGERPRINT_PATTERNS = [
  { pattern: /RTCPeerConnection|createDataChannel/i, name: "WebRTC IP 泄露", severity: "high",
    how: "通过 WebRTC API 创建 STUN 连接，暴露真实 IP 地址",
    means: "即使用 VPN，也可能通过 WebRTC 泄露真实 IP",
    action: "浏览器可禁用 WebRTC 或安装 WebRTC 阻止扩展" },
  { pattern: /canvas\.toDataURL|canvas\.getImageData|canvas\.measureText/i, name: "Canvas 指纹", severity: "medium",
    how: "通过 Canvas API 绘制图形并读取像素数据",
    means: "不同设备/浏览器的渲染结果略有差异，可用于唯一标识",
    action: "Brave/Firefox 会添加噪声；CanvasBlocker 等扩展可阻止" },
  { pattern: /AudioContext|OfflineAudioContext/i, name: "音频指纹", severity: "medium",
    how: "通过 AudioContext 处理音频信号",
    means: "不同硬件的音频处理结果不同，可用于指纹追踪",
    action: "Brave 浏览器会添加噪声" },
  { pattern: /navigator\.hardwareConcurrency|navigator\.deviceMemory/i, name: "硬件信息探测", severity: "low",
    how: "通过 navigator API 读取 CPU 核心数和设备内存",
    means: "结合其他信息可提高指纹唯一性",
    action: "部分浏览器会返回模糊值或限制访问" },
  { pattern: /navigator\.getBattery|battery\.level|battery\.charging/i, name: "电池状态 API", severity: "low",
    how: "通过 Battery API 读取电池电量和充电状态",
    means: "电池电量随时间变化，可用于短时间追踪",
    action: "Firefox/Safari 已限制或移除此 API" },
  { pattern: /navigator\.plugins|navigator\.mimeTypes/i, name: "插件指纹", severity: "low",
    how: "通过 navigator.plugins 读取已安装插件列表",
    means: "不同用户安装的插件组合不同，可用于指纹",
    action: "现代浏览器已限制返回值" },
  { pattern: /window\.screen\.|screen\.colorDepth|screen\.pixelDepth/i, name: "屏幕信息", severity: "low",
    how: "通过 window.screen 对象读取分辨率、色深等",
    means: "屏幕参数是指纹的常见组成部分",
    action: "部分隐私浏览器会添加随机噪声" },
  { pattern: /Intl\.DateTimeFormat|navigator\.language|navigator\.languages/i, name: "语言与时区", severity: "low",
    how: "通过 Intl API 和 navigator.language 读取语言和时区",
    means: "语言和时区组合可缩小用户地理位置范围",
    action: "Tor 浏览器会将时区统一为 UTC" },
  { pattern: /document\.font|FontFace|fonts\.check/i, name: "字体枚举", severity: "medium",
    how: "通过检测已安装字体的渲染差异枚举字体列表",
    means: "不同系统安装的字体不同，是强指纹信号",
    action: "Firefox 的 privacy.resistFingerprinting 可防御" },
  { pattern: /navigator\.clipboard|navigator\.permissions/i, name: "剪贴板/权限探测", severity: "low",
    how: "通过 Clipboard API 或 Permissions API 探测权限状态",
    means: "可用于判断用户浏览习惯和权限授予模式",
    action: "浏览器会提示用户授权" },
];

// ─── 隐私审计 ──────────────────────────────────────────

function auditPrivacy(htmlContent) {
  const findings = {
    trackers: [],
    fingerprintApis: [],
    riskScore: 0,
    summary: "",
  };

  // 扫描追踪脚本
  for (const tracker of TRACKER_PATTERNS) {
    if (tracker.pattern.test(htmlContent)) {
      const entry = {
        name: tracker.name,
        category: tracker.category,
        how: tracker.how || "通过页面嵌入的脚本加载",
        means: tracker.means || "记录用户行为数据",
        action: tracker.action || "可使用广告拦截器屏蔽",
      };
      findings.trackers.push(entry);
      findings.riskScore += tracker.category === "advertising" ? 3 : 2;
    }
  }

  // 扫描指纹 API
  for (const fp of FINGERPRINT_PATTERNS) {
    if (fp.pattern.test(htmlContent)) {
      findings.fingerprintApis.push({
        name: fp.name,
        severity: fp.severity,
        how: fp.how,
        means: fp.means,
        action: fp.action,
      });
      findings.riskScore += fp.severity === "high" ? 4 : fp.severity === "medium" ? 2 : 1;
    }
  }

  // 风险评级
  let riskLevel = "低";
  if (findings.riskScore >= 15) riskLevel = "高";
  else if (findings.riskScore >= 8) riskLevel = "中";

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
  const { archiveDir, outputPath, maxFiles = 50, extractText = true, maxTextLength = 5000, privacyAudit = true } = input;

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
