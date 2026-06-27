/**
 * extract-elements.js
 * 网页存档器 — 元素提取器 v1.0
 *
 * 从网页中提取指定 CSS 选择器匹配的元素。
 * 支持 html/text/json 三种输出格式。
 *
 * 触发词：提取元素、CSS选择器、element extract、extract_elements
 */

const name = "extract_elements";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";

const description = "从网页中提取指定 CSS 选择器匹配的元素。支持 html/text/json 三种输出格式。基于 Scrapling 三层抓取。触发词：提取元素、CSS选择器、element extract、extract_elements。";

const parameters = {
  type: "object",
  properties: {
    url: { type: "string", description: "目标网页 URL" },
    selector: { type: "string", description: "CSS 选择器，例如 `#pricing-table` `.video-card:first-child` `h1`" },
    format: { type: "string", enum: ["html", "text", "json"], default: "html", description: "输出格式：html=完整元素HTML, text=纯文本, json=结构化数据" },
  },
  required: ["url", "selector"],
};

async function execute(input, ctx) {
  const { url, selector, format = "html" } = input;

  if (!url || !selector) {
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: false, error: "需要提供 url 和 selector 参数" }, null, 2) }],
    };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wpa-extract-"));
  const tmpFile = path.join(tmpDir, "extract.py");
  const outFile = path.join(tmpDir, "result.json");

  const script = `
import sys, json, html as html_mod
from scrapling.fetchers import Fetcher

url = sys.argv[1]
selector = sys.argv[2]
fmt = sys.argv[3]
outfile = sys.argv[4]

page_html = None

# Tier 1: Fast HTTP
try:
    f = Fetcher()
    page = f.get(url)
    if page.status == 200 and page.html_content:
        page_html = page.html_content
except Exception:
    pass

# Tier 2: Playwright
if not page_html:
    try:
        from scrapling.fetchers import DynamicFetcher
        page = DynamicFetcher.fetch(url, headless=True, network_idle=True)
        if page.html_content:
            page_html = page.html_content
    except Exception:
        pass

# Tier 3: Stealth
if not page_html:
    try:
        from scrapling.fetchers import StealthyFetcher
        StealthyFetcher.adaptive = True
        page = StealthyFetcher.fetch(url, headless=True, network_idle=True)
        if page.html_content:
            page_html = page.html_content
    except Exception:
        pass

if not page_html:
    with open(outfile, "w", encoding="utf-8") as f:
        json.dump({"ok": False, "error": "Unable to fetch page"}, f, ensure_ascii=True)
    sys.exit(0)

# Parse and extract
from lxml import html as lxml_html
try:
    tree = lxml_html.fromstring(page_html)
    elements = tree.cssselect(selector)
except Exception as e:
    with open(outfile, "w", encoding="utf-8") as f:
        json.dump({"ok": False, "error": "CSS selector error: " + str(e)}, f, ensure_ascii=True)
    sys.exit(0)

# Format results
results = []
for el in elements:
    if fmt == "text":
        results.append(el.text_content().strip())
    elif fmt == "json":
        results.append({
            "tag": el.tag,
            "text": el.text_content().strip()[:500],
            "attributes": dict(el.attrib),
            "html": lxml_html.tostring(el, encoding="unicode", pretty_print=True)[:10000],
        })
    else:  # html
        results.append(lxml_html.tostring(el, encoding="unicode", pretty_print=True))

with open(outfile, "w", encoding="utf-8") as f:
    json.dump({"ok": True, "count": len(results), "results": results, "selector": selector, "url": url, "format": fmt}, f, ensure_ascii=True)
`;

  fs.writeFileSync(tmpFile, script, "utf-8");
  try {
    execFileSync("python", [tmpFile, url, selector, format, outFile], { timeout: 90000, windowsHide: true });
    if (!fs.existsSync(outFile)) {
      return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "No output" }, null, 2) }] };
    }
    const out = JSON.parse(fs.readFileSync(outFile, "utf-8"));
    if (!out.ok) {
      return { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] };
    }
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          url,
          selector,
          format,
          count: out.count,
          results: out.results,
        }, null, 2),
      }],
    };
  } catch (e) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message }, null, 2) }] };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

export { name, description, parameters, execute };
