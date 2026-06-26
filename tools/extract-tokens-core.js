/**
 * extract-tokens-core.js
 * 网页存档器 — 设计 Token 提取核心
 * 只负责从 HTML 中提取原始 token 数据，不做格式化。
 * 输出结构化 JSON 到 stdout。
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const name = "extract_tokens_core";
const description = "从网页 HTML 中提取设计系统 Token（颜色/字体/字号/圆角/阴影/间距/CSS变量）。输入可以是 URL 或 HTML 文件路径。输出结构化 JSON。";

const parameters = {
  type: "object",
  properties: {
    url: { type: "string", description: "网页 URL（与 filePath 二选一）" },
    filePath: { type: "string", description: "本地 HTML 文件路径（与 url 二选一）" },
    archiveId: { type: "string", description: "存档 ID（与 url 二选一，通过 archiveId 查找已存档的 HTML 文件）" },
    maxColors: { type: "integer", default: 12, description: "提取的最大颜色数量（默认 12）" },
  },
  required: [],
};

function buildPythonScript(sourceType, sourceValue, maxColors) {
  // sourceType: "url" | "file"
  const srcConfig = sourceType === "url"
    ? { type: "url", value: sourceValue }
    : { type: "file", value: sourceValue };

  return `
import asyncio, json, sys, re, os
from collections import Counter

# ── 重定向 stdout ──
class _StdoutRedirect:
    def write(self, s):
        if not s.strip(): return
        sys.__stderr__.write("[TOKEN-EXTRACT] " + s)
    def flush(self): pass
    def isatty(self): return False

sys.stdout = _StdoutRedirect()

MAX_COLORS = ${maxColors}

# ── CSS 正则 ──
COLOR_RE = re.compile(r'#[0-9a-fA-F]{3,8}\\b|rgba?\\([^)]+\\)|hsla?\\([^)]+\\)', re.I)
FONT_FAM_RE = re.compile(r'font-family\\s*:\\s*([^;}{]+)', re.I)
FONT_SZ_RE = re.compile(r'font-size\\s*:\\s*([^;}{]+)', re.I)
RADIUS_RE = re.compile(r'border-radius\\s*:\\s*([^;}{]+)', re.I)
SHADOW_RE = re.compile(r'box-shadow\\s*:\\s*([^;}{]+)', re.I)
SPACING_RE = re.compile(r'(?:margin|padding)(?:-top|-bottom|-left|-right)?\\s*:\\s*([^;}{]+)', re.I)
CSS_VAR_RE = re.compile(r'--[a-zA-Z0-9_-]+\\s*:\\s*([^;}{]+)')

SRC_TYPE = ${JSON.stringify(srcConfig.type)}
SRC_VALUE = ${JSON.stringify(srcConfig.value)}

def get_css_chunks():
    chunks = []
    if SRC_TYPE == "url":
        from crawl4ai import AsyncWebCrawler
        async def _fetch():
            async with AsyncWebCrawler(verbose=False) as c:
                r = await c.arun(url=SRC_VALUE, word_count_threshold=0)
            return r
        result = asyncio.run(_fetch())
        if not result or not result.html:
            sys.stdout = sys.__stdout__
            print(json.dumps({"ok":False,"error":"未获取到页面内容"}))
            return None
        html = result.html
    else:
        if not os.path.exists(SRC_VALUE):
            sys.stdout = sys.__stdout__
            print(json.dumps({"ok":False,"error":"文件不存在: "+SRC_VALUE}))
            return None
        html = open(SRC_VALUE, encoding="utf-8", errors="replace").read()

    # <style> 标签
    for i, block in enumerate(re.findall(r'<style[^>]*>([\\s\\S]*?)</style>', html, re.I)):
        chunks.append((block, f"<style>#{i}"))

    # 内联 style
    inline = "\\n".join(re.findall(r'style="([^"]*)"', html, re.I))
    if inline.strip():
        chunks.append((inline, "inline-styles"))

    # crawl4ai css_properties（如果有）
    if SRC_TYPE == "url" and hasattr(result, 'css_properties') and result.css_properties:
        chunks.append(("\\n".join(f"{k}: {v}" for k,v in result.css_properties.items()), "crawl4ai-css"))

    return chunks

def extract_colors(css, source):
    return [{"value": m.group(0).strip(), "source": source, "evidence": m.group(0)} for m in COLOR_RE.finditer(css)]

def extract_prop(css, pattern, name, source):
    results = []
    for m in pattern.finditer(css):
        val = m.group(1).strip()
        if val and val not in ("inherit", "initial", "unset"):
            results.append({"value": val, "source": source, "evidence": f"{name}: {val}"})
    return results

def extract_css_vars(css, source):
    return [{"name": m.group(0).split(":")[0].strip(), "value": m.group(1).strip(), "source": source}
            for m in CSS_VAR_RE.finditer(css)]

def aggregate(items, key="value", max_n=20):
    counter = Counter(item[key] for item in items)
    total = sum(counter.values()) or 1
    seen = set()
    result = []
    for val, count in counter.most_common(max_n):
        if val in seen: continue
        seen.add(val)
        ev = next((i for i in items if i[key] == val), {})
        result.append({"value": val, "count": count,
                       "confidence": round(min(count / total * 5, 1.0), 2),
                       "source": ev.get("source", "unknown"), "evidence": ev.get("evidence", "")})
    return result

def aggregate_fonts(items, max_n=10):
    counter = Counter()
    ev_map = {}
    for item in items:
        fonts = [f.strip().strip("'\\\"") for f in item["value"].split(",")]
        primary = fonts[0] if fonts else item["value"]
        counter[primary] += 1
        if primary not in ev_map: ev_map[primary] = item
    total = sum(counter.values()) or 1
    result = []
    for val, count in counter.most_common(max_n):
        ev = ev_map.get(val, {})
        result.append({"value": val, "fullStack": ev.get("value", val), "count": count,
                       "confidence": round(min(count / total * 3, 1.0), 2),
                       "source": ev.get("source", "unknown"), "evidence": ev.get("evidence", "")})
    return result

def aggregate_spacings(items, max_n=15):
    counter = Counter(item["value"] for item in items)
    total = sum(counter.values()) or 1
    seen = set()
    result = []
    for val, count in counter.most_common(max_n):
        if val in seen: continue
        seen.add(val)
        ev = next((i for i in items if i["value"] == val), {})
        result.append({"value": val, "count": count,
                       "confidence": round(min(count / total * 5, 1.0), 2),
                       "source": ev.get("source", "unknown"), "evidence": ev.get("evidence", "")})
    return result

# ── 主流程 ──
chunks = get_css_chunks()
if not chunks:
    sys.stdout = sys.__stdout__
    print(json.dumps({"ok":False,"error":"未找到 CSS 样式数据"}))
    sys.exit(0)

all_colors, all_fonts, all_font_sizes, all_radii, all_shadows, all_spacings, all_css_vars = [], [], [], [], [], [], []
for css, source in chunks:
    all_colors.extend(extract_colors(css, source))
    all_fonts.extend(extract_prop(css, FONT_FAM_RE, "font-family", source))
    all_font_sizes.extend(extract_prop(css, FONT_SZ_RE, "font-size", source))
    all_radii.extend(extract_prop(css, RADIUS_RE, "border-radius", source))
    all_shadows.extend(extract_prop(css, SHADOW_RE, "box-shadow", source))
    all_spacings.extend(extract_prop(css, SPACING_RE, "spacing", source))
    all_css_vars.extend(extract_css_vars(css, source))

# 页面标题
title = ""
if SRC_TYPE == "url":
    title_m = re.search(r'<title[^>]*>([\\s\\S]*?)</title>', chunks[0][0] if chunks else "")
    if title_m: title = title_m.group(1).strip()
else:
    try:
        html_raw = open(SRC_VALUE, encoding="utf-8", errors="replace").read()
        tm = re.search(r'<title[^>]*>([\\s\\S]*?)</title>', html_raw, re.I)
        if tm: title = tm.group(1).strip()
    except: pass

tokens = {
    "colors": aggregate(all_colors, max_n=MAX_COLORS),
    "fonts": aggregate_fonts(all_fonts),
    "fontSizes": aggregate(all_font_sizes, max_n=10),
    "borderRadii": aggregate(all_radii, max_n=8),
    "boxShadows": aggregate(all_shadows, max_n=6),
    "spacings": aggregate_spacings(all_spacings),
    "cssVariables": all_css_vars[:30],
}

output = {
    "ok": True,
    "source": SRC_VALUE,
    "title": title[:200],
    "tokens": tokens,
    "stats": {
        "cssChunks": len(chunks),
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
`;
}

function execute(input, ctx) {
  const { url, filePath, archiveId, maxColors = 12 } = input;

  // 支持 archiveId 快捷输入——通过 URL hash 匹配已存档文件
  let resolvedFilePath = filePath;
  if (archiveId && !filePath) {
    const defaultDir = ctx?.dataDir || path.join(os.homedir(), ".hanako", "plugin-data", "webpage-archiver");
    const files = fs.readdirSync(defaultDir).filter(f => f.startsWith("page_") && f.endsWith(".html"));
    // 简单匹配：archiveId 是 URL 的 MD5 前 8 位，尝试从文件名或文件内容中查找
    const targetFile = files.find(f => {
      const fpath = path.join(defaultDir, f);
      try {
        const content = fs.readFileSync(fpath, "utf-8");
        return content.includes(archiveId) || content.includes(`"${url}"`);
      } catch { return false; }
    });
    if (targetFile) resolvedFilePath = path.join(defaultDir, targetFile);
  }

  if (!url && !resolvedFilePath) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "需要提供 url 或 filePath 参数" }, null, 2) }] };
  }

  const sourceType = url ? "url" : "file";
  const sourceValue = url || resolvedFilePath;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wpa-tokens-"));
  const tmpFile = path.join(tmpDir, "extract.py");
  fs.writeFileSync(tmpFile, buildPythonScript(sourceType, sourceValue, maxColors), "utf-8");

  try {
    const stdout = execFileSync("python", [tmpFile], {
      timeout: 90000,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    }).trim();

    const result = JSON.parse(stdout);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (e) {
    if (e.message && e.message.includes("crawl4ai")) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "crawl4ai 未安装", hint: "pip install crawl4ai" }, null, 2) }] };
    }
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message }, null, 2) }] };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

export { name, description, parameters, execute };
