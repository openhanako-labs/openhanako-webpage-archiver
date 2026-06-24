/**
 * extract-tokens.js
 * 网页存档器 — 设计 Token 提取子模块 v2.1
 *
 * 功能：从网页 URL 提取设计系统 Token（颜色/字体/间距/圆角/阴影），
 * 输出为 CSS 变量 / Tailwind 配置 / 通用 JSON / DESIGN.md 设计系统文档。
 * 每条 Token 附带置信度与证据来源（从哪个 CSS 规则/元素提取）。
 *
 * 整合来源：
 * - web-to-design-md：DESIGN.md 输出格式 + 置信度 + 证据来源
 * - ai-website-cloner-template：侦察阶段设计 token 提取逻辑
 *
 * 触发词：提取设计Token、提取配色方案、extract design tokens、taste-skill、生成DESIGN.md
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const name = "webpage_extract_tokens";
const description = "从网页 URL 提取设计系统 Token（颜色/字体/间距/圆角/阴影），输出为 CSS 变量 / Tailwind 配置 / 通用 JSON / DESIGN.md 设计系统文档。每条 Token 附带置信度与证据来源。触发词：提取设计Token、提取配色方案、extract design tokens、taste-skill、生成DESIGN.md。";

const parameters = {
  type: "object",
  properties: {
    url: { type: "string", description: "要提取的网页 URL" },
    format: {
      type: "string",
      enum: ["css", "tailwind", "json", "design-md"],
      default: "css",
      description: "输出格式：css（CSS 变量）、tailwind（Tailwind 配置）、json（通用 JSON）、design-md（DESIGN.md 设计系统文档）",
    },
    maxColors: { type: "integer", default: 12, description: "提取的最大颜色数量（默认 12）" },
    outputDir: { type: "string", description: "输出目录（可选，用于保存 design-md 和 preview 文件）" },
  },
  required: ["url"],
};

// ─── Python 提取脚本 ──────────────────────────────────────────
// 只负责提取原始数据，不做格式化。输出 JSON 到 stdout。

function buildPythonScript(url, maxColors) {
  return `
import asyncio
import json
import sys
import re
from collections import Counter

# 重定向 stdout，crawl4ai 的日志打到 stderr
class _StdoutRedirect:
    def write(self, s):
        if not s.strip(): return
        sys.__stderr__.write("[CRAWL-LOG] " + s)
    def flush(self): pass
    def isatty(self): return False

sys.stdout = _StdoutRedirect()

url = ${JSON.stringify(url)}
max_colors = ${maxColors}

# ─── CSS 解析工具 ───

COLOR_PATTERN = re.compile(r'#[0-9a-fA-F]{3,8}\\b|rgba?\\([^)]+\\)|hsla?\\([^)]+\\)', re.I)
FONT_FAMILY_PATTERN = re.compile(r'font-family\\s*:\\s*([^;}{]+)', re.I)
FONT_SIZE_PATTERN = re.compile(r'font-size\\s*:\\s*([^;}{]+)', re.I)
BORDER_RADIUS_PATTERN = re.compile(r'border-radius\\s*:\\s*([^;}{]+)', re.I)
BOX_SHADOW_PATTERN = re.compile(r'box-shadow\\s*:\\s*([^;}{]+)', re.I)
SPACING_PATTERN = re.compile(r'(?:margin|padding)(?:-top|-bottom|-left|-right)?\\s*:\\s*([^;}{]+)', re.I)
CSS_VAR_PATTERN = re.compile(r'--[a-zA-Z0-9_-]+\\s*:\\s*([^;}{]+)')

def extract_colors(css_text, source):
    results = []
    for match in COLOR_PATTERN.finditer(css_text):
        val = match.group(0).strip()
        results.append({"value": val, "source": source, "evidence": match.group(0)})
    return results

def extract_properties(css_text, pattern, prop_name, source):
    results = []
    for match in pattern.finditer(css_text):
        val = match.group(1).strip()
        if val and val not in ("inherit", "initial", "unset"):
            results.append({"value": val, "source": source, "evidence": f"{prop_name}: {val}"})
    return results

def extract_css_vars(css_text, source):
    results = []
    for match in CSS_VAR_PATTERN.finditer(css_text):
        var_name = match.group(0).split(":")[0].strip()
        var_val = match.group(1).strip()
        results.append({"name": var_name, "value": var_val, "source": source})
    return results

async def main():
    from crawl4ai import AsyncWebCrawler

    async with AsyncWebCrawler(verbose=False) as crawler:
        result = await crawler.arun(url=url, word_count_threshold=0)

    if not result or not result.html:
        sys.stdout = sys.__stdout__
        sys.stdout.buffer.write(json.dumps({"ok": False, "error": "未能获取页面内容，页面可能被反爬或无法访问"}, ensure_ascii=False).encode('utf-8'))
        return

    html = result.html

    # 收集所有 CSS 文本
    css_chunks = []

    # 1. <style> 标签内的 CSS
    style_blocks = re.findall(r'<style[^>]*>([\\s\\S]*?)</style>', html, re.I)
    for i, block in enumerate(style_blocks):
        css_chunks.append((block, f"<style>#{i}"))

    # 2. 内联 style 属性
    inline_styles = re.findall(r'style="([^"]*)"', html, re.I)
    inline_css = "\\n".join(inline_styles)
    if inline_css.strip():
        css_chunks.append((inline_css, "inline-styles"))

    # 3. crawl4ai 可能返回的 css_properties
    if hasattr(result, 'css_properties') and result.css_properties:
        css_text_from_props = "\\n".join(f"{k}: {v}" for k, v in result.css_properties.items())
        css_chunks.append((css_text_from_props, "crawl4ai-css-properties"))

    if not css_chunks:
        sys.stdout = sys.__stdout__
        sys.stdout.buffer.write(json.dumps({"ok": False, "error": "页面中未找到 CSS 样式数据", "url": url}, ensure_ascii=False).encode('utf-8'))
        return

    # 提取各类 Token
    all_colors = []
    all_fonts = []
    all_font_sizes = []
    all_radii = []
    all_shadows = []
    all_spacings = []
    all_css_vars = []

    for css_text, source in css_chunks:
        all_colors.extend(extract_colors(css_text, source))
        all_fonts.extend(extract_properties(css_text, FONT_FAMILY_PATTERN, "font-family", source))
        all_font_sizes.extend(extract_properties(css_text, FONT_SIZE_PATTERN, "font-size", source))
        all_radii.extend(extract_properties(css_text, BORDER_RADIUS_PATTERN, "border-radius", source))
        all_shadows.extend(extract_properties(css_text, BOX_SHADOW_PATTERN, "box-shadow", source))
        all_spacings.extend(extract_properties(css_text, SPACING_PATTERN, "spacing", source))
        all_css_vars.extend(extract_css_vars(css_text, source))

    # 聚合 + 去重 + 置信度计算
    def aggregate(items, key="value", max_n=20):
        """聚合相同值，计算出现次数作为置信度"""
        counter = Counter(item[key] for item in items)
        total = sum(counter.values()) or 1
        seen = set()
        result = []
        for val, count in counter.most_common(max_n):
            if val in seen:
                continue
            seen.add(val)
            # 找到第一条证据
            evidence = next((i for i in items if i[key] == val), {})
            result.append({
                "value": val,
                "count": count,
                "confidence": round(min(count / total * 5, 1.0), 2),  # 归一化到 0-1
                "source": evidence.get("source", "unknown"),
                "evidence": evidence.get("evidence", ""),
            })
        return result

    def aggregate_fonts(items, max_n=10):
        """字体特殊处理：提取主要字体族名"""
        counter = Counter()
        evidence_map = {}
        for item in items:
            # 取第一个字体名（主字体）
            fonts = [f.strip().strip("'\\\"") for f in item["value"].split(",")]
            primary = fonts[0] if fonts else item["value"]
            counter[primary] += 1
            if primary not in evidence_map:
                evidence_map[primary] = item
        total = sum(counter.values()) or 1
        result = []
        for val, count in counter.most_common(max_n):
            ev = evidence_map.get(val, {})
            result.append({
                "value": val,
                "fullStack": ev.get("value", val),
                "count": count,
                "confidence": round(min(count / total * 3, 1.0), 2),
                "source": ev.get("source", "unknown"),
                "evidence": ev.get("evidence", ""),
            })
        return result

    def aggregate_spacings(items, max_n=15):
        """间距特殊处理：按值聚合"""
        counter = Counter(item["value"] for item in items)
        total = sum(counter.values()) or 1
        seen = set()
        result = []
        for val, count in counter.most_common(max_n):
            if val in seen:
                continue
            seen.add(val)
            evidence = next((i for i in items if i["value"] == val), {})
            result.append({
                "value": val,
                "count": count,
                "confidence": round(min(count / total * 5, 1.0), 2),
                "source": evidence.get("source", "unknown"),
                "evidence": evidence.get("evidence", ""),
            })
        return result

    tokens = {
        "colors": aggregate(all_colors, max_n=max_colors),
        "fonts": aggregate_fonts(all_fonts),
        "fontSizes": aggregate(all_font_sizes, max_n=10),
        "borderRadii": aggregate(all_radii, max_n=8),
        "boxShadows": aggregate(all_shadows, max_n=6),
        "spacings": aggregate_spacings(all_spacings),
        "cssVariables": all_css_vars[:30],
    }

    # 页面基本信息
    title_match = re.search(r'<title[^>]*>([\\s\\S]*?)</title>', html, re.I)
    title = title_match.group(1).strip() if title_match else ""

    output = {
        "ok": True,
        "url": url,
        "title": title[:200],
        "tokens": tokens,
        "stats": {
            "cssChunks": len(css_chunks),
            "totalColors": len(all_colors),
            "totalFonts": len(all_fonts),
            "totalFontSizes": len(all_font_sizes),
            "totalRadii": len(all_radii),
            "totalShadows": len(all_shadows),
            "totalSpacings": len(all_spacings),
            "totalCssVars": len(all_css_vars),
        },
    }

    sys.stdout = sys.__stdout__
    sys.stdout.buffer.write(json.dumps(output, ensure_ascii=False).encode('utf-8'))

try:
    asyncio.run(main())
except Exception as e:
    sys.stdout = sys.__stdout__
    sys.stdout.buffer.write(json.dumps({"ok": False, "error": str(e), "hint": "确认 crawl4ai 已安装: pip install crawl4ai"}, ensure_ascii=False).encode('utf-8'))
`;
}

// ─── 格式化函数 ──────────────────────────────────────────

function formatAsCss(result) {
  const t = result.tokens;
  let css = `/* Design Tokens — extracted from ${result.url} */\n`;
  css += `/* Title: ${result.title || "N/A"} */\n\n:root {\n`;

  // Colors
  if (t.colors.length) {
    css += `  /* Colors */\n`;
    t.colors.forEach((c, i) => {
      const label = c.value.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || `color${i}`;
      css += `  --color-${label}: ${c.value}; /* ×${c.count}, conf=${c.confidence} */\n`;
    });
    css += `\n`;
  }

  // Fonts
  if (t.fonts.length) {
    css += `  /* Typography */\n`;
    t.fonts.forEach((f, i) => {
      css += `  --font-${i + 1}: ${f.fullStack}; /* ×${f.count}, conf=${f.confidence} */\n`;
    });
    css += `\n`;
  }

  // Font sizes
  if (t.fontSizes.length) {
    css += `  /* Font Sizes */\n`;
    t.fontSizes.forEach((s, i) => {
      css += `  --text-${i + 1}: ${s.value}; /* ×${s.count}, conf=${s.confidence} */\n`;
    });
    css += `\n`;
  }

  // Border radii
  if (t.borderRadii.length) {
    css += `  /* Border Radius */\n`;
    t.borderRadii.forEach((r, i) => {
      css += `  --radius-${i + 1}: ${r.value}; /* ×${r.count} */\n`;
    });
    css += `\n`;
  }

  // Box shadows
  if (t.boxShadows.length) {
    css += `  /* Shadows */\n`;
    t.boxShadows.forEach((s, i) => {
      css += `  --shadow-${i + 1}: ${s.value}; /* ×${s.count} */\n`;
    });
    css += `\n`;
  }

  // Spacings
  if (t.spacings.length) {
    css += `  /* Spacings */\n`;
    t.spacings.forEach((s, i) => {
      css += `  --space-${i + 1}: ${s.value}; /* ×${s.count} */\n`;
    });
    css += `\n`;
  }

  // CSS Variables
  if (t.cssVariables.length) {
    css += `  /* CSS Custom Properties (raw) */\n`;
    t.cssVariables.forEach(v => {
      css += `  ${v.name}: ${v.value};\n`;
    });
  }

  css += `}\n`;
  return css;
}

function formatAsTailwind(result) {
  const t = result.tokens;
  let tw = `// Tailwind Config — extracted from ${result.url}\n`;
  tw += `// Source: ${result.title || "N/A"}\n\n`;
  tw += `{ theme: { extend: {\n`;

  if (t.colors.length) {
    tw += `  colors: {\n`;
    t.colors.forEach((c, i) => {
      const label = `c${i + 1}`;
      tw += `    ${label}: '${c.value}', // ×${c.count}\n`;
    });
    tw += `  },\n`;
  }

  if (t.fonts.length) {
    tw += `  fontFamily: {\n`;
    t.fonts.forEach((f, i) => {
      tw += `    f${i + 1}: '${f.fullStack}', // ×${f.count}\n`;
    });
    tw += `  },\n`;
  }

  if (t.fontSizes.length) {
    tw += `  fontSize: {\n`;
    t.fontSizes.forEach((s, i) => {
      tw += `    s${i + 1}: '${s.value}', // ×${s.count}\n`;
    });
    tw += `  },\n`;
  }

  if (t.borderRadii.length) {
    tw += `  borderRadius: {\n`;
    t.borderRadii.forEach((r, i) => {
      tw += `    r${i + 1}: '${r.value}', // ×${r.count}\n`;
    });
    tw += `  },\n`;
  }

  if (t.boxShadows.length) {
    tw += `  boxShadow: {\n`;
    t.boxShadows.forEach((s, i) => {
      tw += `    sh${i + 1}: '${s.value}', // ×${s.count}\n`;
    });
    tw += `  },\n`;
  }

  if (t.spacings.length) {
    tw += `  spacing: {\n`;
    t.spacings.forEach((s, i) => {
      tw += `    sp${i + 1}: '${s.value}', // ×${s.count}\n`;
    });
    tw += `  },\n`;
  }

  tw += `} } }\n`;
  return tw;
}

function formatAsDesignMd(result) {
  const t = result.tokens;
  const now = new Date().toISOString().slice(0, 10);
  let md = `# DESIGN.md — 设计系统文档\n\n`;
  md += `> **来源**: ${result.url}\n`;
  md += `> **页面标题**: ${result.title || "N/A"}\n`;
  md += `> **提取时间**: ${now}\n`;
  md += `> **数据来源**: ${result.stats.cssChunks} 个 CSS 块\n\n`;
  md += `---\n\n`;

  // Colors
  md += `## 色彩系统\n\n`;
  md += `| 值 | 出现次数 | 置信度 | 来源 |\n`;
  md += `|---|---|---|---|\n`;
  t.colors.forEach(c => {
    md += `| \`${c.value}\` | ${c.count} | ${c.confidence} | ${c.source} |\n`;
  });
  md += `\n`;

  // Typography
  md += `## 字体系统\n\n`;
  md += `### 字体族\n\n`;
  md += `| 主字体 | 完整声明 | 出现次数 | 置信度 |\n`;
  md += `|---|---|---|---|\n`;
  t.fonts.forEach(f => {
    md += `| \`${f.value}\` | \`${f.fullStack}\` | ${f.count} | ${f.confidence} |\n`;
  });
  md += `\n`;

  md += `### 字号\n\n`;
  md += `| 值 | 出现次数 | 置信度 | 来源 |\n`;
  md += `|---|---|---|---|\n`;
  t.fontSizes.forEach(s => {
    md += `| \`${s.value}\` | ${s.count} | ${s.confidence} | ${s.source} |\n`;
  });
  md += `\n`;

  // Border radius
  md += `## 圆角系统\n\n`;
  md += `| 值 | 出现次数 | 置信度 | 来源 |\n`;
  md += `|---|---|---|---|\n`;
  t.borderRadii.forEach(r => {
    md += `| \`${r.value}\` | ${r.count} | ${r.confidence} | ${r.source} |\n`;
  });
  md += `\n`;

  // Shadows
  md += `## 阴影系统\n\n`;
  md += `| 值 | 出现次数 | 置信度 | 来源 |\n`;
  md += `|---|---|---|---|\n`;
  t.boxShadows.forEach(s => {
    md += `| \`${s.value}\` | ${s.count} | ${s.confidence} | ${s.source} |\n`;
  });
  md += `\n`;

  // Spacings
  md += `## 间距系统\n\n`;
  md += `| 值 | 出现次数 | 置信度 | 来源 |\n`;
  md += `|---|---|---|---|\n`;
  t.spacings.forEach(s => {
    md += `| \`${s.value}\` | ${s.count} | ${s.confidence} | ${s.source} |\n`;
  });
  md += `\n`;

  // CSS Variables
  if (t.cssVariables.length) {
    md += `## CSS 自定义属性（原始）\n\n`;
    md += `| 变量名 | 值 | 来源 |\n`;
    md += `|---|---|---|\n`;
    t.cssVariables.forEach(v => {
      md += `| \`${v.name}\` | \`${v.value}\` | ${v.source} |\n`;
    });
    md += `\n`;
  }

  // 统计
  md += `---\n\n## 统计信息\n\n`;
  md += `- 色彩: ${result.stats.totalColors} 次匹配 → ${t.colors.length} 去重\n`;
  md += `- 字体: ${result.stats.totalFonts} 次匹配 → ${t.fonts.length} 去重\n`;
  md += `- 字号: ${result.stats.totalFontSizes} 次匹配 → ${t.fontSizes.length} 去重\n`;
  md += `- 圆角: ${result.stats.totalRadii} 次匹配 → ${t.borderRadii.length} 去重\n`;
  md += `- 阴影: ${result.stats.totalShadows} 次匹配 → ${t.boxShadows.length} 去重\n`;
  md += `- 间距: ${result.stats.totalSpacings} 次匹配 → ${t.spacings.length} 去重\n`;
  md += `- CSS 变量: ${result.stats.totalCssVars} 个\n`;

  md += `\n---\n\n*由网页存档器 v2.1 自动生成*\n`;
  return md;
}

// ─── 主执行函数 ──────────────────────────────────────────

async function execute(input = {}, ctx) {
  const { url, format = "css", maxColors = 12 } = input;
  let { outputDir } = input;

  if (!url) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ ok: false, error: "需要提供 url 参数" }, null, 2),
      }],
    };
  }

  const os = await import("node:os");
  const defaultDir = ctx?.dataDir || path.join(os.homedir(), ".hanako", "plugin-data", "webpage-archiver");

  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `extract-tokens-${Date.now()}.py`);

  // 生成 Python 脚本
  const script = buildPythonScript(url, maxColors);
  fs.writeFileSync(tmpFile, script, "utf-8");

  try {
    const stdout = execFileSync("python", [tmpFile], {
      timeout: 120000,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    }).trim();

    const result = JSON.parse(stdout);

    if (!result.ok) {
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 根据格式输出
    let formatted = "";
    let savedFiles = [];

    switch (format) {
      case "css":
        formatted = formatAsCss(result);
        break;
      case "tailwind":
        formatted = formatAsTailwind(result);
        break;
      case "json":
        formatted = JSON.stringify(result, null, 2);
        break;
      case "design-md":
        formatted = formatAsDesignMd(result);
        // 如果有输出目录，保存 DESIGN.md
        // 确保 outputDir 有值
        if (!outputDir && ctx?.dataDir) {
          outputDir = ctx.dataDir;
        }
        if (outputDir) {
          fs.mkdirSync(outputDir, { recursive: true });
          const mdPath = path.join(outputDir, "DESIGN.md");
          fs.writeFileSync(mdPath, formatted, "utf-8");
          savedFiles.push(mdPath);

          // 同时保存 JSON 原始数据
          const jsonPath = path.join(outputDir, "design-tokens.json");
          fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2), "utf-8");
          savedFiles.push(jsonPath);

          // 生成 design-preview.html
          const previewHtml = generatePreviewHtml(result);
          const previewPath = path.join(outputDir, "design-preview.html");
          fs.writeFileSync(previewPath, previewHtml, "utf-8");
          savedFiles.push(previewPath);
        }
        break;
    }

    // 构建返回
    const output = {
      ok: true,
      url: result.url,
      title: result.title,
      format,
      stats: result.stats,
      tokenCount: {
        colors: result.tokens.colors.length,
        fonts: result.tokens.fonts.length,
        fontSizes: result.tokens.fontSizes.length,
        borderRadii: result.tokens.borderRadii.length,
        boxShadows: result.tokens.boxShadows.length,
        spacings: result.tokens.spacings.length,
        cssVariables: result.tokens.cssVariables.length,
      },
    };

    if (savedFiles.length) {
      output.savedFiles = savedFiles;
    }

    // 格式化内容（截断太长的输出）
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
  } catch (e) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: e.message,
          hint: "确认 crawl4ai 已安装: pip install crawl4ai",
        }, null, 2),
      }],
    };
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ─── design-preview.html 生成 ──────────────────────────────

function generatePreviewHtml(result) {
  const t = result.tokens;
  const now = new Date().toISOString().slice(0, 10);
  const title = result.title || result.url;
  const escapeHtml = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // ── 色彩卡片 ──
  const colorCards = t.colors.map(c => {
    const isLight = /^(#fff|#ffffff|rgba\(255)/i.test(c.value);
    return `<div class="color-card">
      <div class="color-swatch" style="background:${c.value};border-color:${isLight ? '#e0e0e0' : 'transparent'}"></div>
      <div class="color-info">
        <code class="color-value">${escapeHtml(c.value)}</code>
        <span class="color-meta">×${c.count} · 置信度 ${c.confidence}</span>
        <span class="color-source">${escapeHtml(c.source)}</span>
      </div>
    </div>`;
  }).join("");

  // ── 字体样例 ──
  const fontCards = t.fonts.map(f => `
    <div class="font-card">
      <div class="font-sample" style="font-family:${escapeHtml(f.fullStack)};">
        永和九年岁在癸丑暮春之初 — ${escapeHtml(f.value)}
      </div>
      <div class="font-detail">
        <code>${escapeHtml(f.fullStack)}</code>
        <span class="meta">×${f.count} · 置信度 ${f.confidence}</span>
      </div>
    </div>`
  ).join("");

  // ── 字号阶梯 ──
  const fontSizeRows = t.fontSizes.map(s => `
    <div class="size-row">
      <span class="size-sample" style="font-size:${escapeHtml(s.value)};line-height:1.5;">Aa 永</span>
      <code class="size-value">${escapeHtml(s.value)}</code>
      <span class="size-meta">×${s.count} · ${escapeHtml(s.source)}</span>
    </div>`
  ).join("");

  // ── 圆角展示 ──
  const radiusCards = t.borderRadii.map(r => `
    <div class="radius-card">
      <div class="radius-shape" style="border-radius:${escapeHtml(r.value)};"></div>
      <code>${escapeHtml(r.value)}</code>
      <span class="meta">×${r.count}</span>
    </div>`
  ).join("");

  // ── 阴影展示 ──
  const shadowCards = t.boxShadows.map(s => `
    <div class="shadow-card">
      <div class="shadow-box" style="box-shadow:${escapeHtml(s.value)};"></div>
      <code class="shadow-value">${escapeHtml(s.value)}</code>
      <span class="meta">×${s.count}</span>
    </div>`
  ).join("");

  // ── 间距展示 ──
  const spacingBars = t.spacings.slice(0, 12).map(s => {
    const num = parseFloat(s.value) || 0;
    const isNeg = num < 0;
    const barWidth = Math.min(Math.abs(num), 120);
    return `
    <div class="spacing-row">
      <div class="spacing-bar" style="width:${barWidth}px;margin-left:${isNeg ? Math.abs(num) : 0}px;"></div>
      <code>${escapeHtml(s.value)}</code>
      <span class="meta">×${s.count}</span>
    </div>`;
  }).join("");

  // ── CSS 变量 ──
  const cssVarRows = t.cssVariables.length ? t.cssVariables.map(v => `
    <div class="var-row">
      <code class="var-name">${escapeHtml(v.name)}</code>
      <code class="var-value">${escapeHtml(v.value)}</code>
      <span class="meta">${escapeHtml(v.source)}</span>
    </div>`
  ).join("") : '<p class="empty">无 CSS 自定义属性</p>';

  // ── 统计信息 ──
  const stats = result.stats;
  const statItems = [
    { label: "CSS 块", value: stats.cssChunks },
    { label: "色彩", value: `${stats.totalColors} → ${t.colors.length}` },
    { label: "字体", value: `${stats.totalFonts} → ${t.fonts.length}` },
    { label: "字号", value: `${stats.totalFontSizes} → ${t.fontSizes.length}` },
    { label: "圆角", value: `${stats.totalRadii} → ${t.borderRadii.length}` },
    { label: "阴影", value: `${stats.totalShadows} → ${t.boxShadows.length}` },
    { label: "间距", value: `${stats.totalSpacings} → ${t.spacings.length}` },
    { label: "CSS 变量", value: stats.totalCssVars },
  ];
  const statCards = statItems.map(s => `
    <div class="stat-card">
      <div class="stat-value">${s.value}</div>
      <div class="stat-label">${s.label}</div>
    </div>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>设计系统文档 — ${escapeHtml(title)}</title>
<style>
  :root {
    --bg: #0f0f10;
    --surface: #1a1a1c;
    --surface2: #242427;
    --border: #2e2e32;
    --text: #e8e8ea;
    --text2: #a0a0a8;
    --text3: #6a6a72;
    --accent: #6c8ebf;
    --accent2: #9673a6;
    --radius: 10px;
    --mono: 'SF Mono', 'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace;
    --sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: var(--sans); background: var(--bg); color: var(--text); line-height: 1.6; }
  .container { max-width: 960px; margin: 0 auto; padding: 48px 24px 80px; }

  /* Header */
  .header { margin-bottom: 48px; }
  .header h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
  .header .subtitle { font-size: 14px; color: var(--text2); margin-top: 8px; }
  .header .url { font-family: var(--mono); font-size: 12px; color: var(--accent); word-break: break-all; margin-top: 6px; }
  .header .date { font-size: 12px; color: var(--text3); margin-top: 4px; }

  /* Stats */
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 48px; }
  .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; text-align: center; }
  .stat-value { font-size: 18px; font-weight: 600; font-family: var(--mono); color: var(--accent); }
  .stat-label { font-size: 11px; color: var(--text3); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }

  /* Sections */
  .section { margin-bottom: 40px; }
  .section-title { font-size: 14px; font-weight: 600; color: var(--text2); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
  .section-title .count { color: var(--text3); font-weight: 400; margin-left: 8px; }

  /* Colors */
  .color-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
  .color-card { display: flex; align-items: center; gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
  .color-swatch { width: 40px; height: 40px; border-radius: 8px; border: 1px solid var(--border); flex-shrink: 0; }
  .color-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .color-value { font-family: var(--mono); font-size: 13px; color: var(--text); }
  .color-meta { font-size: 11px; color: var(--text3); }
  .color-source { font-size: 10px; color: var(--text3); opacity: 0.6; }

  /* Fonts */
  .font-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 24px; margin-bottom: 12px; }
  .font-sample { font-size: 22px; color: var(--text); margin-bottom: 8px; }
  .font-detail { display: flex; align-items: center; gap: 12px; }
  .font-detail code { font-family: var(--mono); font-size: 12px; color: var(--accent); }
  .font-detail .meta { font-size: 11px; color: var(--text3); }

  /* Font sizes */
  .size-row { display: flex; align-items: baseline; gap: 16px; padding: 8px 16px; border-radius: 6px; }
  .size-row:hover { background: var(--surface); }
  .size-sample { color: var(--text); white-space: nowrap; }
  .size-value { font-family: var(--mono); font-size: 13px; color: var(--accent); min-width: 80px; }
  .size-meta { font-size: 11px; color: var(--text3); }

  /* Radius */
  .radius-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; }
  .radius-card { display: flex; flex-direction: column; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .radius-shape { width: 48px; height: 48px; background: linear-gradient(135deg, var(--accent), var(--accent2)); }
  .radius-card code { font-family: var(--mono); font-size: 12px; color: var(--text2); }
  .radius-card .meta { font-size: 10px; color: var(--text3); }

  /* Shadows */
  .shadow-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
  .shadow-card { display: flex; flex-direction: column; align-items: center; gap: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
  .shadow-box { width: 64px; height: 44px; background: var(--surface2); border-radius: 6px; }
  .shadow-value { font-family: var(--mono); font-size: 11px; color: var(--text2); word-break: break-all; text-align: center; }
  .shadow-card .meta { font-size: 10px; color: var(--text3); }

  /* Spacings */
  .spacing-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
  .spacing-bar { height: 12px; background: linear-gradient(90deg, var(--accent2), var(--accent)); border-radius: 2px; min-width: 4px; }
  .spacing-row code { font-family: var(--mono); font-size: 12px; color: var(--accent); min-width: 60px; }
  .spacing-row .meta { font-size: 11px; color: var(--text3); }

  /* CSS Vars */
  .var-row { display: grid; grid-template-columns: 200px 1fr auto; gap: 12px; padding: 8px 16px; border-radius: 6px; align-items: center; }
  .var-row:hover { background: var(--surface); }
  .var-name { font-family: var(--mono); font-size: 12px; color: var(--accent2); }
  .var-value { font-family: var(--mono); font-size: 12px; color: var(--text2); }
  .var-row .meta { font-size: 10px; color: var(--text3); }

  .empty { color: var(--text3); font-size: 13px; padding: 16px; }

  /* Footer */
  .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--border); font-size: 12px; color: var(--text3); display: flex; justify-content: space-between; }

  @media (max-width: 640px) {
    .stats { grid-template-columns: repeat(2, 1fr); }
    .color-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>设计系统文档</h1>
    <div class="subtitle">${escapeHtml(title)}</div>
    <div class="url">${escapeHtml(result.url)}</div>
    <div class="date">提取时间 ${now} · 网页存档器 v2.1</div>
  </div>

  <div class="stats">${statCards}</div>

  <div class="section">
    <div class="section-title">色彩系统 <span class="count">${t.colors.length} 种</span></div>
    <div class="color-grid">${colorCards || '<p class="empty">无数据</p>'}</div>
  </div>

  <div class="section">
    <div class="section-title">字体族 <span class="count">${t.fonts.length} 种</span></div>
    ${fontCards || '<p class="empty">无数据</p>'}
  </div>

  <div class="section">
    <div class="section-title">字号阶梯 <span class="count">${t.fontSizes.length} 级</span></div>
    ${fontSizeRows || '<p class="empty">无数据</p>'}
  </div>

  <div class="section">
    <div class="section-title">圆角系统 <span class="count">${t.borderRadii.length} 种</span></div>
    <div class="radius-grid">${radiusCards || '<p class="empty">无数据</p>'}</div>
  </div>

  <div class="section">
    <div class="section-title">阴影系统 <span class="count">${t.boxShadows.length} 种</span></div>
    <div class="shadow-grid">${shadowCards || '<p class="empty">无数据</p>'}</div>
  </div>

  <div class="section">
    <div class="section-title">间距系统 <span class="count">${t.spacings.length} 种</span></div>
    ${spacingBars || '<p class="empty">无数据</p>'}
  </div>

  <div class="section">
    <div class="section-title">CSS 自定义属性 <span class="count">${t.cssVariables.length} 个</span></div>
    ${cssVarRows}
  </div>

  <div class="footer">
    <span>由网页存档器 v2.1 自动生成</span>
    <span>CSS 块 ${stats.cssChunks} · 数据源 crawl4ai</span>
  </div>
</div>
</body>
</html>`;
}

export { name, description, parameters, execute };
