/**
 * extract-tokens.js
 * 网页存档器 — 设计 Token 格式化输出层 v2.1
 *
 * 调用 extract-tokens-core.js 获取原始 token 数据，
 * 然后格式化为 CSS / Tailwind / JSON / DESIGN.md + preview。
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const name = "extract_tokens";
const description = "从网页 URL 提取设计系统 Token，输出为 CSS 变量 / Tailwind 配置 / 通用 JSON / DESIGN.md 设计系统文档 + 可视化预览。底层使用 crawl4ai 提取。触发词：提取设计Token、提取配色方案、extract design tokens。";

const parameters = {
  type: "object",
  properties: {
    url: { type: "string", description: "要提取的网页 URL" },
    format: {
      type: "string",
      enum: ["css", "tailwind", "json", "design-md"],
      default: "css",
      description: "输出格式",
    },
    maxColors: { type: "integer", default: 12, description: "最大颜色数量（默认 12）" },
    outputDir: { type: "string", description: "输出目录（可选，design-md 格式需要）" },
  },
  required: ["url"],
};

// ─── 调用 core 获取原始数据 ─────────────────────────────

async function fetchTokensCore(url, maxColors) {
  const coreModule = await import("./extract-tokens-core.js");
  const result = await coreModule.execute({ url, maxColors });
  return JSON.parse(result.content[0].text);
}

// ─── 格式化函数 ──────────────────────────────────────────

function formatAsCss(result) {
  const t = result.tokens;
  let css = `/* Design Tokens — ${result.source || "N/A"} */\n`;
  if (result.title) css += `/* Title: ${result.title} */\n\n`;
  css += `:root {\n`;

  if (t.colors.length) {
    css += `  /* Colors */\n`;
    t.colors.forEach((c, i) => {
      const label = c.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || `color${i}`;
      css += `  --color-${label}: ${c.value}; /* ×${c.count}, conf=${c.confidence} */\n`;
    });
    css += "\n";
  }

  if (t.fonts.length) {
    css += `  /* Typography */\n`;
    t.fonts.forEach((f, i) => {
      css += `  --font-${i + 1}: ${f.fullStack}; /* ×${f.count}, conf=${f.confidence} */\n`;
    });
    css += "\n";
  }

  if (t.fontSizes.length) {
    css += `  /* Font Sizes */\n`;
    t.fontSizes.forEach((s, i) => {
      css += `  --text-${i + 1}: ${s.value}; /* ×${s.count}, conf=${s.confidence} */\n`;
    });
    css += "\n";
  }

  if (t.borderRadii.length) {
    css += `  /* Border Radius */\n`;
    t.borderRadii.forEach((r, i) => {
      css += `  --radius-${i + 1}: ${r.value}; /* ×${r.count} */\n`;
    });
    css += "\n";
  }

  if (t.boxShadows.length) {
    css += `  /* Shadows */\n`;
    t.boxShadows.forEach((s, i) => {
      css += `  --shadow-${i + 1}: ${s.value}; /* ×${s.count} */\n`;
    });
    css += "\n";
  }

  if (t.spacings.length) {
    css += `  /* Spacings */\n`;
    t.spacings.forEach((s, i) => {
      css += `  --space-${i + 1}: ${s.value}; /* ×${s.count} */\n`;
    });
    css += "\n";
  }

  if (t.cssVariables.length) {
    css += `  /* CSS Custom Properties (raw) */\n`;
    t.cssVariables.forEach(v => {
      css += `  ${v.name}: ${v.value};\n`;
    });
  }

  css += "}\n";
  return css;
}

function formatAsTailwind(result) {
  const t = result.tokens;
  let tw = `// Tailwind Config — ${result.source || "N/A"}\n`;
  if (result.title) tw += `// Title: ${result.title}\n\n`;
  tw += `{ theme: { extend: {\n`;

  if (t.colors.length) {
    tw += `  colors: {\n`;
    t.colors.forEach((c, i) => {
      tw += `    c${i + 1}: '${c.value}', // ×${c.count}\n`;
    });
    tw += "  },\n";
  }

  if (t.fonts.length) {
    tw += `  fontFamily: {\n`;
    t.fonts.forEach((f, i) => {
      tw += `    f${i + 1}: '${f.fullStack}', // ×${f.count}\n`;
    });
    tw += "  },\n";
  }

  if (t.fontSizes.length) {
    tw += `  fontSize: {\n`;
    t.fontSizes.forEach((s, i) => {
      tw += `    s${i + 1}: '${s.value}', // ×${s.count}\n`;
    });
    tw += "  },\n";
  }

  if (t.borderRadii.length) {
    tw += `  borderRadius: {\n`;
    t.borderRadii.forEach((r, i) => {
      tw += `    r${i + 1}: '${r.value}', // ×${r.count}\n`;
    });
    tw += "  },\n";
  }

  if (t.boxShadows.length) {
    tw += `  boxShadow: {\n`;
    t.boxShadows.forEach((s, i) => {
      tw += `    sh${i + 1}: '${s.value.replace(/'/g, "\\'")}', // ×${s.count}\n`;
    });
    tw += "  },\n";
  }

  if (t.spacings.length) {
    tw += `  spacing: {\n`;
    t.spacings.forEach((s, i) => {
      tw += `    sp${i + 1}: '${s.value}', // ×${s.count}\n`;
    });
    tw += "  },\n";
  }

  tw += "}\n}\n";
  return tw;
}

function formatAsJson(result) {
  return JSON.stringify(result, null, 2);
}

function generatePreviewHtml(result) {
  const t = result.tokens;
  const now = new Date().toISOString().slice(0, 10);
  const title = result.title || result.source || "N/A";
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const colorCards = t.colors.map(c => {
    const isLight = /^(#fff|#ffffff|rgba\(255)/i.test(c.value);
    return `<div class="cc"><div class="swatch" style="background:${esc(c.value)};border-color:${isLight ? '#e0e0e0' : 'transparent'}"></div>
      <div class="ci"><code>${esc(c.value)}</code><span class="meta">×${c.count} · conf ${c.confidence}</span></div></div>`;
  }).join("");

  const fontCards = t.fonts.map(f =>
    `<div class="fc"><div class="fs" style="font-family:${esc(f.fullStack)};">永和九年岁在癸丑 — ${esc(f.value)}</div>
      <div class="fd"><code>${esc(f.fullStack)}</code><span class="meta">×${f.count}</span></div></div>`
  ).join("");

  const sizeRows = t.fontSizes.map(s =>
    `<div class="sr"><span class="ss" style="font-size:${esc(s.value)};">Aa 永</span>
      <code>${esc(s.value)}</code><span class="meta">×${s.count}</span></div>`
  ).join("");

  const radiusCards = t.borderRadii.map(r =>
    `<div class="rc"><div class="rs" style="border-radius:${esc(r.value)};"></div>
      <code>${esc(r.value)}</code><span class="meta">×${r.count}</span></div>`
  ).join("");

  const shadowCards = t.boxShadows.map(s =>
    `<div class="sc"><div class="sb" style="box-shadow:${esc(s.value)};"></div>
      <code>${esc(s.value)}</code><span class="meta">×${s.count}</span></div>`
  ).join("");

  const spacingBars = t.spacings.slice(0, 12).map(s => {
    const num = parseFloat(s.value) || 0;
    const barW = Math.min(Math.abs(num), 120);
    return `<div class="spar"><div class="sbar" style="width:${barW}px;"></div>
      <code>${esc(s.value)}</code><span class="meta">×${s.count}</span></div>`;
  }).join("");

  const cssVarRows = t.cssVariables.length ? t.cssVariables.map(v =>
    `<div class="vr"><code>${esc(v.name)}</code><code>${esc(v.value)}</code><span class="meta">${esc(v.source)}</span></div>`
  ).join("") : '<p class="empty">无 CSS 自定义属性</p>';

  const statItems = [
    { label: "CSS 块", value: result.stats.cssChunks },
    { label: "色彩", value: `${result.stats.totalColors} → ${t.colors.length}` },
    { label: "字体", value: `${result.stats.totalFonts} → ${t.fonts.length}` },
    { label: "字号", value: `${result.stats.totalFontSizes} → ${t.fontSizes.length}` },
    { label: "圆角", value: `${result.stats.totalRadii} → ${t.borderRadii.length}` },
    { label: "阴影", value: `${result.stats.totalShadows} → ${t.boxShadows.length}` },
    { label: "间距", value: `${result.stats.totalSpacings} → ${t.spacings.length}` },
    { label: "CSS 变量", value: result.stats.totalCssVars },
  ];
  const statCards = statItems.map(s =>
    `<div class="stc"><div class="stv">${s.value}</div><div class="stl">${s.label}</div></div>`
  ).join("");

  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>设计系统 — ${esc(title)}</title>
<style>
:root{--bg:#0f0f10;--sf:#1a1a1c;--sf2:#242427;--bd:#2e2e32;--tx:#e8e8ea;--tx2:#a0a0a8;--tx3:#6a6a72;--ac:#6c8ebf;--ac2:#9673a6;--mono:'SF Mono','JetBrains Mono','Consolas',monospace;--sans:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--sans);background:var(--bg);color:var(--tx);line-height:1.6}
.c{max-width:960px;margin:0 auto;padding:48px 24px 80px}
.h{margin-bottom:48px}.h h1{font-size:28px;font-weight:700}.h .sub{font-size:14px;color:var(--tx2);margin-top:8px}.h .url{font-family:var(--mono);font-size:12px;color:var(--ac);word-break:break-all;margin-top:6px}.h .date{font-size:12px;color:var(--tx3);margin-top:4px}
.st{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:48px}
.stc{background:var(--sf);border:1px solid var(--bd);border-radius:10px;padding:16px;text-align:center}
.stv{font-size:18px;font-weight:600;font-family:var(--mono);color:var(--ac)}
.stl{font-size:11px;color:var(--tx3);margin-top:4px;text-transform:uppercase;letter-spacing:.05em}
.sec{margin-bottom:40px}.sec-t{font-size:14px;font-weight:600;color:var(--tx2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px;padding-bottom:8px;border-bottom:1px solid var(--bd)}
.cg{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.cc{display:flex;align-items:center;gap:12px;background:var(--sf);border:1px solid var(--bd);border-radius:8px;padding:12px}
.swatch{width:40px;height:40px;border-radius:8px;border:1px solid var(--bd);flex-shrink:0}
.ci{display:flex;flex-direction:column;gap:2px;min-width:0}.ci code{font-family:var(--mono);font-size:13px}.ci .meta{font-size:11px;color:var(--tx3)}
.fc{background:var(--sf);border:1px solid var(--bd);border-radius:10px;padding:20px 24px;margin-bottom:12px}
.fs{font-size:22px;margin-bottom:8px}.fd{display:flex;align-items:center;gap:12px}.fd code{font-family:var(--mono);font-size:12px;color:var(--ac)}.fd .meta{font-size:11px;color:var(--tx3)}
.sr{display:flex;align-items:baseline;gap:16px;padding:8px 16px;border-radius:6px}.sr:hover{background:var(--sf)}.ss{white-space:nowrap}.sr code{font-family:var(--mono);font-size:13px;color:var(--ac);min-width:80px}.sr .meta{font-size:11px;color:var(--tx3)}
.rg{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px}
.rc{display:flex;flex-direction:column;align-items:center;gap:8px;background:var(--sf);border:1px solid var(--bd);border-radius:8px;padding:16px}
.rs{width:48px;height:48px;background:linear-gradient(135deg,var(--ac),var(--ac2))}
.rc code{font-family:var(--mono);font-size:12px;color:var(--tx2)}.rc .meta{font-size:10px;color:var(--tx3)}
.sg{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}
.sc{display:flex;flex-direction:column;align-items:center;gap:10px;background:var(--sf);border:1px solid var(--bd);border-radius:8px;padding:20px}
.sb{width:64px;height:44px;background:var(--sf2);border-radius:6px}
.sc code{font-family:var(--mono);font-size:11px;color:var(--tx2);word-break:break-all;text-align:center}
.sc .meta{font-size:10px;color:var(--tx3)}
.spar{display:flex;align-items:center;gap:12px;padding:6px 0}
.sbar{height:12px;background:linear-gradient(90deg,var(--ac2),var(--ac));border-radius:2px;min-width:4px}
.spar code{font-family:var(--mono);font-size:12px;color:var(--ac);min-width:60px}
.spar .meta{font-size:11px;color:var(--tx3)}
.vr{display:grid;grid-template-columns:200px 1fr auto;gap:12px;padding:8px 16px;border-radius:6px;align-items:center}
.vr:hover{background:var(--sf)}.vr code{font-family:var(--mono);font-size:12px;color:var(--tx2)}
.vr .vn{color:var(--ac2)!important}
.vr .meta{font-size:10px;color:var(--tx3)}
.empty{color:var(--tx3);font-size:13px;padding:16px}
.ft{margin-top:48px;padding-top:24px;border-top:1px solid var(--bd);font-size:12px;color:var(--tx3);display:flex;justify-content:space-between}
@media(max-width:640px){.st{grid-template-columns:repeat(2,1fr)}.cg{grid-template-columns:1fr}}
</style></head><body><div class="c">
<div class="h"><h1>设计系统文档</h1><div class="sub">${esc(title)}</div><div class="url">${esc(result.source || "")}</div><div class="date">提取时间 ${now} · 网页存档器 v2.1</div></div>
<div class="st">${statCards}</div>
<div class="sec"><div class="sec-t">色彩系统 <span style="color:var(--tx3)">${t.colors.length} 种</span></div><div class="cg">${colorCards || '<p class="empty">无数据</p>'}</div></div>
<div class="sec"><div class="sec-t">字体族 <span style="color:var(--tx3)">${t.fonts.length} 种</span></div>${fontCards || '<p class="empty">无数据</p>'}</div>
<div class="sec"><div class="sec-t">字号阶梯 <span style="color:var(--tx3)">${t.fontSizes.length} 级</span></div>${sizeRows || '<p class="empty">无数据</p>'}</div>
<div class="sec"><div class="sec-t">圆角系统 <span style="color:var(--tx3)">${t.borderRadii.length} 种</span></div><div class="rg">${radiusCards || '<p class="empty">无数据</p>'}</div></div>
<div class="sec"><div class="sec-t">阴影系统 <span style="color:var(--tx3)">${t.boxShadows.length} 种</span></div><div class="sg">${shadowCards || '<p class="empty">无数据</p>'}</div></div>
<div class="sec"><div class="sec-t">间距系统 <span style="color:var(--tx3)">${t.spacings.length} 种</span></div>${spacingBars || '<p class="empty">无数据</p>'}</div>
<div class="sec"><div class="sec-t">CSS 自定义属性 <span style="color:var(--tx3)">${t.cssVariables.length} 个</span></div>${cssVarRows}</div>
<div class="ft"><span>由网页存档器 v2.1 自动生成</span><span>CSS 块 ${result.stats.cssChunks} · 数据源 crawl4ai</span></div>
</div></body></html>`;
}

// ─── DESIGN.md 格式化 ────────────────────────────────────

function formatAsDesignMd(result) {
  const t = result.tokens;
  let md = `# 设计系统文档\n\n`;
  md += `## 来源\n\n`;
  md += `- **URL**: ${result.source}\n`;
  md += `- **标题**: ${result.title || "N/A"}\n`;
  md += `- **提取时间**: ${new Date().toISOString()}\n\n`;

  md += `## 统计\n\n`;
  md += `| 类型 | 原始 | 去重后 |\n|------|------|--------|\n`;
  const s = result.stats;
  md += `| 色彩 | ${s.totalColors} | ${t.colors.length} |\n`;
  md += `| 字体 | ${s.totalFonts} | ${t.fonts.length} |\n`;
  md += `| 字号 | ${s.totalFontSizes} | ${t.fontSizes.length} |\n`;
  md += `| 圆角 | ${s.totalRadii} | ${t.borderRadii.length} |\n`;
  md += `| 阴影 | ${s.totalShadows} | ${t.boxShadows.length} |\n`;
  md += `| 间距 | ${s.totalSpacings} | ${t.spacings.length} |\n`;
  md += `| CSS 变量 | — | ${t.cssVariables.length} |\n\n`;

  if (t.colors.length) {
    md += `## 色彩\n\n`;
    t.colors.forEach(c => {
      md += `- \`${c.value}\` (×${c.count}, conf ${c.confidence})\n`;
    });
    md += "\n";
  }

  if (t.fonts.length) {
    md += `## 字体\n\n`;
    t.fonts.forEach(f => {
      md += `- **${f.value}** — \`${f.fullStack}\` (×${f.count})\n`;
    });
    md += "\n";
  }

  if (t.fontSizes.length) {
    md += `## 字号\n\n`;
    t.fontSizes.forEach(s => {
      md += `- \`${s.value}\` (×${s.count})\n`;
    });
    md += "\n";
  }

  if (t.borderRadii.length) {
    md += `## 圆角\n\n`;
    t.borderRadii.forEach(r => {
      md += `- \`${r.value}\` (×${r.count})\n`;
    });
    md += "\n";
  }

  if (t.boxShadows.length) {
    md += `## 阴影\n\n`;
    t.boxShadows.forEach(sh => {
      md += `- \`${sh.value}\` (×${sh.count})\n`;
    });
    md += "\n";
  }

  if (t.spacings.length) {
    md += `## 间距\n\n`;
    t.spacings.forEach(sp => {
      md += `- \`${sp.value}\` (×${sp.count})\n`;
    });
    md += "\n";
  }

  if (t.cssVariables.length) {
    md += `## CSS 自定义属性\n\n`;
    t.cssVariables.slice(0, 20).forEach(v => {
      md += `- \`${v.name}\`: \`${v.value}\` (${v.source})\n`;
    });
    md += "\n";
  }

  return md;
}

// ─── 主执行 ──────────────────────────────────────────────

async function execute(input, ctx) {
  const { url, format = "css", maxColors = 12, outputDir } = input;

  if (!url) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "需要提供 url 参数" }, null, 2) }] };
  }

  // 1. 调用 core 获取原始数据
  let coreResult;
  try {
    coreResult = await fetchTokensCore(url, maxColors);
  } catch (e) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message }, null, 2) }] };
  }

  if (!coreResult || !coreResult.ok) {
    return { content: [{ type: "text", text: JSON.stringify(coreResult || { ok: false, error: "core 提取失败" }, null, 2) }] };
  }

  // 2. 格式化
  let formatted = "";
  switch (format) {
    case "css": formatted = formatAsCss(coreResult); break;
    case "tailwind": formatted = formatAsTailwind(coreResult); break;
    case "json": formatted = formatAsJson(coreResult); break;
    case "design-md": formatted = formatAsDesignMd(coreResult); break;
    default: formatted = formatAsCss(coreResult);
  }

  // 3. 写入文件
  const savedFiles = [];
  const dir = outputDir || (ctx?.dataDir || path.join(os.homedir(), ".hanako", "plugin-data", "webpage-archiver"));
  fs.mkdirSync(dir, { recursive: true });

  const extMap = { css: ".css", tailwind: ".js", json: ".json", "design-md": ".md" };
  const fileExt = extMap[format] || ".css";
  const fileName = `tokens_${format}_${Date.now()}${fileExt}`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, formatted, "utf-8");
  savedFiles.push({ path: filePath, format });

  // design-md 额外生成 preview
  if (format === "design-md") {
    const previewHtml = generatePreviewHtml(coreResult);
    const previewPath = path.join(dir, `design-preview.html`);
    fs.writeFileSync(previewPath, previewHtml, "utf-8");
    savedFiles.push({ path: previewPath, format: "preview-html" });
  }

  const output = {
    ok: true,
    format,
    source: coreResult.source,
    title: coreResult.title,
    savedFiles,
    tokens: {
      colors: coreResult.tokens.colors.length,
      fonts: coreResult.tokens.fonts.length,
      fontSizes: coreResult.tokens.fontSizes.length,
      borderRadii: coreResult.tokens.borderRadii.length,
      boxShadows: coreResult.tokens.boxShadows.length,
      spacings: coreResult.tokens.spacings.length,
      cssVariables: coreResult.tokens.cssVariables.length,
    },
  };

  const maxLen = 8000;
  const displayFormatted = formatted.length > maxLen
    ? formatted.slice(0, maxLen) + "\n\n...（已截断，完整内容见文件）"
    : formatted;

  return {
    content: [
      { type: "text", text: JSON.stringify(output, null, 2) },
      { type: "text", text: displayFormatted },
    ],
  };
}

export { name, description, parameters, execute };
