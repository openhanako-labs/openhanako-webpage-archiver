const name = "save_page";
import path from "node:path";
import { execSync, execFileSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";

const description = "保存网页为离线单文件 HTML。使用 crawl4ai 获取页面内容，再用 SingleFile CLI 打包。触发词：保存网页、存档页面、save page、SingleFile。";

const parameters = {
  type: "object",
  properties: {
    url: { type: "string", description: "要保存的网页 URL" },
    outputDir: { type: "string", description: "输出目录（可选）" },
    filename: { type: "string", description: "文件名（可选）" },
    blockImages: { type: "boolean", description: "拦截图片（可选）" },
    keepScripts: { type: "boolean", description: "保留 JS（可选）" },
    waitUntil: { type: "string", enum: ["load", "networkIdle", "none"], description: "加载等待策略" },
  },
  required: ["url"],
};

function fetchHtml(url) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wpa-scrapling-"));
  const tmpFile = path.join(tmpDir, "fetch.py");
  const outFile = path.join(tmpDir, "result.json");
  const script = `
import sys, json
from scrapling.fetchers import Fetcher

url = sys.argv[1]
outfile = sys.argv[2]
html = None

# Tier 1: Fast HTTP with TLS fingerprint impersonation
try:
    f = Fetcher()
    page = f.get(url)
    if page.status == 200 and page.html_content:
        html = page.html_content
except Exception:
    pass

# Tier 2: Playwright for JS-rendered/SPA pages
if not html:
    try:
        from scrapling.fetchers import DynamicFetcher
        page = DynamicFetcher.fetch(url, headless=True, network_idle=True)
        if page.html_content:
            html = page.html_content
    except Exception:
        pass

# Tier 3: Stealth mode for Cloudflare-protected pages
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
    execFileSync("python", [tmpFile, url, outFile], { timeout: 90000, windowsHide: true });
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
  if (waitUntil) cmd += ` --browser-wait-until=${waitUntil}`;
  execSync(cmd, { timeout: 60000, stdio: "pipe", killSignal: "SIGKILL" });
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
  const { url, outputDir, filename, blockImages, keepScripts, waitUntil } = input;
  const defaultDir = ctx?.dataDir || path.join(os.homedir(), ".hanako", "plugin-data", "webpage-archiver");
  const dir = outputDir || defaultDir;
  fs.mkdirSync(dir, { recursive: true });
  const safeName = filename || `page_${Date.now()}`;
  const outputPath = path.join(dir, `${safeName}.html`);
  const archiveId = url.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  const start = Date.now();
  let html;
  try {
    html = fetchHtml(url);
  } catch (e) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: e.message, hint: classify(e) }, null, 2) }] };
  }

  // Try SingleFile for resource inlining; fallback to raw HTML on failure
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wpa-pack-"));
  const tempPath = path.join(tmpDir, "input.html");
  fs.writeFileSync(tempPath, html, "utf-8");
  let packed = false;
  let packError = null;
  try {
    pack(tempPath, outputPath, { blockImages, keepScripts, waitUntil });
    packed = fs.existsSync(outputPath);
  } catch (e) {
    packError = classify(e);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }

  // Fallback: save raw crawl4ai HTML directly
  if (!packed) {
    fs.writeFileSync(outputPath, html, "utf-8");
  }

  const st = fs.statSync(outputPath);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const mode = packed ? "singlefile" : "raw-fallback";
  const warn = packed ? null : `SingleFile 打包失败（${packError}），已保存原始 HTML`;
  const msg = warn
    ? `⚠️ 已保存（原始模式）: ${safeName}.html (${(st.size/1024/1024).toFixed(2)}MB, ${elapsed}s) — ${warn}`
    : `✅ 已保存: ${safeName}.html (${(st.size/1024/1024).toFixed(2)}MB, ${elapsed}s)`;
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, archiveId, filePath: outputPath, fileSize: `${(st.size/1024/1024).toFixed(2)}MB`, elapsed: `${elapsed}s`, url, mode, warning: warn, message: msg }, null, 2) }] };
}

export { name, description, parameters, execute };
