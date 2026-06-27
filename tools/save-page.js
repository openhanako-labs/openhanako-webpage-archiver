const name = "save_page";
import { execSync, execFileSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { analyzeHtml, generatePrompts } from "./generate-edit-prompt.js";

const description = "保存网页为离线单文件 HTML + 自动生成结构化分析报告。基于 Scrapling 三层抓取（HTTP/Playwright/Stealth），SPA 页面支持滚动加载。触发词：保存网页、存档页面、save page、SingleFile。";

const parameters = {
  type: "object",
  properties: {
    url: { type: "string", description: "要保存的网页 URL" },
    outputDir: { type: "string", description: "输出目录（可选）" },
    filename: { type: "string", description: "文件名（可选）" },
    blockImages: { type: "boolean", description: "拦截图片（可选）" },
    keepScripts: { type: "boolean", description: "保留 JS（可选）" },
    waitUntil: { type: "string", enum: ["load", "networkIdle", "none"], description: "加载等待策略" },
    scrollDepth: { type: "integer", default: 0, description: "SPA 滚动深度（0=不滚动，1-10=滚动次数），用于触发懒加载内容" },
  },
  required: ["url"],
};

function fetchHtml(url, scrollDepth = 0) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wpa-scrapling-"));
  const tmpFile = path.join(tmpDir, "fetch.py");
  const outFile = path.join(tmpDir, "result.json");
  const script = `
import sys, json, time, math
from scrapling.fetchers import Fetcher

url = sys.argv[1]
outfile = sys.argv[2]
scroll_depth = int(sys.argv[3]) if len(sys.argv) > 3 else 0
html = None

# Tier 1: Fast HTTP with TLS fingerprint impersonation
if scroll_depth == 0:
    try:
        f = Fetcher()
        page = f.get(url)
        if page.status == 200 and page.html_content:
            html = page.html_content
    except Exception:
        pass

# Tier 2/3: Playwright for SPA/JS-rendered pages (with optional scrolling)
if not html:
    try:
        from scrapling.fetchers import DynamicFetcher
        page = DynamicFetcher.fetch(url, headless=True, network_idle=True)
        if page.html_content:
            html = page.html_content
        # Scroll to trigger lazy-loaded content
        if html and scroll_depth > 0:
            from scrapling.fetchers import StealthyFetcher
            StealthyFetcher.adaptive = True
            page = StealthyFetcher.fetch(url, headless=True, network_idle=True)
            try:
                for i in range(scroll_depth):
                    page._page.evaluate(f"window.scrollTo(0, document.body.scrollHeight * {min(i+1, scroll_depth)}/{scroll_depth})")
                    time.sleep(2)
                time.sleep(3)
                html = page.html_content
            except Exception:
                pass
    except Exception:
        pass

# Tier 3: Stealth mode for Cloudflare-protected pages (no scroll)
if not html:
    try:
        from scrapling.fetchers import StealthyFetcher
        StealthyFetcher.adaptive = True
        page = StealthyFetcher.fetch(url, headless=True, network_idle=True)
        if page.html_content:
            html = page.html_content
    except Exception:
        pass

result = {"ok": bool(html), "html": html or "", "len": len(html or "")}
if not html:
    result["error"] = "Unable to fetch page content"
with open(outfile, "w", encoding="utf-8") as f:
    json.dump(result, f, ensure_ascii=True)
`;
  fs.writeFileSync(tmpFile, script, "utf-8");
  try {
    execFileSync("python", [tmpFile, url, outFile, String(scrollDepth)], { timeout: 120000, windowsHide: true });
    const out = fs.readFileSync(outFile, "utf-8");
    const r = JSON.parse(out);
    if (!r.ok) throw new Error(r.error);
    return r.html;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

function pack(tempPath, outPath, opts) {
  const { blockImages, keepScripts, waitUntil } = opts;
  const cp = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  let cmd = `single-file "${tempPath}" "${outPath}" --browser-executable-path="${cp}" --browser-headless=true --remove-hidden-elements=true --remove-unused-styles=true`;
  if (blockImages) cmd += " --block-images=true";
  if (keepScripts) cmd += " --block-scripts=false";
  const waitStrategy = waitUntil || "load";
  execSync(cmd + ` --browser-wait-until=${waitStrategy}`, { timeout: 60000, stdio: "pipe", killSignal: "SIGKILL" });
  if (!fs.existsSync(outPath)) throw new Error("SingleFile output not generated");
}

function classify(e) {
  const c = ((e.message||"") + " " + (e.stderr?.toString()||"")).toLowerCase();
  if (/cloudflare|challenge|verify|ray id/.test(c)) return "反爬拦截";
  if (/no such|cannot find|not recognized/.test(c)) return "single-file 未安装";
  if (/timeout|timed out/.test(c)) return "超时";
  if (/chrome|browser|executable/.test(c)) return "Chrome 不可用";
  return "未知错误";
}

async function execute(input, ctx) {
  const { url, outputDir, filename, blockImages, keepScripts, waitUntil, scrollDepth = 0 } = input;
  const defaultDir = ctx?.dataDir || path.join(os.homedir(), ".hanako", "plugin-data", "webpage-archiver");
  const dir = outputDir || defaultDir;
  fs.mkdirSync(dir, { recursive: true });
  const safeName = filename || `page_${Date.now()}`;
  const outputPath = path.join(dir, `${safeName}.html`);
  const analysisPath = path.join(dir, `${safeName}-analysis.md`);
  const archiveId = url.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  const start = Date.now();

  // Fetch HTML via Scrapling for analysis (and potential fallback)
  let scrapyHtml = null;
  try {
    scrapyHtml = fetchHtml(url, scrollDepth);
  } catch (e) {
    // Scrapling failed, but SingleFile might still work
  }

  // Try SingleFile directly with the live URL (Chrome renders JS + inlines resources)
  let packed = false;
  let packError = null;
  try {
    const cp = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const waitStrategy = waitUntil || "load";
    let cmd = `single-file "${url}" "${outputPath}" --browser-executable-path="${cp}" --browser-headless=true --remove-hidden-elements=true --remove-unused-styles=true --browser-wait-until=${waitStrategy}`;
    if (blockImages !== false) cmd += " --block-images=true";
    if (keepScripts) cmd += " --block-scripts=false";
    execSync(cmd, { timeout: 120000, stdio: "pipe", killSignal: "SIGKILL" });
    packed = fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000;
  } catch (e) {
    packError = classify(e);
  }

  // Fallback: save Scrapling HTML directly (strip scripts to prevent SPA JS from overwriting)
  if (!packed && scrapyHtml) {
    const strippedHtml = scrapyHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<script[^>]*\/>/gi, "");
    fs.writeFileSync(outputPath, strippedHtml, "utf-8");
  }

  // Auto-generate analysis report (from Scrapling HTML, or from SingleFile output)
  const analysisHtml = scrapyHtml || (packed ? fs.readFileSync(outputPath, "utf-8") : "");
  if (analysisHtml) {
    try {
      const issues = analyzeHtml(analysisHtml);
      const analysisResult = generatePrompts(issues, "all", 10, `URL: ${url}`);
      const stats = {
        htmlSize: `${(analysisHtml.length / 1024).toFixed(1)}KB`,
        totalTags: (analysisHtml.match(/<[a-z]/gi) || []).length,
        inlineStyles: (analysisHtml.match(/style="/gi) || []).length,
        scripts: (analysisHtml.match(/<script/gi) || []).length,
        styleBlocks: (analysisHtml.match(/<style/gi) || []).length,
        images: (analysisHtml.match(/<img/gi) || []).length,
        links: (analysisHtml.match(/<a\s/gi) || []).length,
      };
      const analysisMd = `# ${safeName} — 页面分析报告\n\n**分析目标**: ${url}\n**页面大小**: ${stats.htmlSize}\n**标签**: ${stats.totalTags} | **内联样式**: ${stats.inlineStyles} | **脚本**: ${stats.scripts} | **图片**: ${stats.images} | **链接**: ${stats.links}\n\n---\n\n${analysisResult.fullPrompt}`;
      fs.writeFileSync(analysisPath, analysisMd, "utf-8");
    } catch (e) { /* analysis is best-effort */ }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const mode = packed ? "singlefile" : (scrapyHtml ? "raw-fallback" : "failed");

  if (!packed && !scrapyHtml) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: packError || "无法获取页面", hint: classify({ message: packError }) }, null, 2) }] };
  }

  const st = fs.statSync(outputPath);
  const warn = packed ? null : `SingleFile 打包失败（${packError}），已保存原始 HTML（无脚本）`;
  const msg = warn
    ? `⚠️ 已保存（原始模式）: ${safeName}.html (${(st.size/1024/1024).toFixed(2)}MB, ${elapsed}s) — ${warn}`
    : `✅ 已保存: ${safeName}.html (${(st.size/1024/1024).toFixed(2)}MB, ${elapsed}s)`;
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        ok: true,
        archiveId,
        filePath: outputPath,
        analysisPath,
        fileSize: `${(st.size/1024/1024).toFixed(2)}MB`,
        elapsed: `${elapsed}s`,
        url,
        mode,
        warning: warn,
        analysisSummary: analysisHtml ? "已生成" : "未生成",
        message: msg + (analysisHtml ? ` 分析报告: ${safeName}-analysis.md` : ""),
      }, null, 2),
    }],
  };
}

export { name, description, parameters, execute };
