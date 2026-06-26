const name = "extract_text";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const description = "提取网页内容为干净 Markdown 文本。支持 URL 直接抓取或 archiveId 从已存档 HTML 提取。基于 Crawl4AI，自动处理 JS 渲染。触发词：提取网页、抓取网页内容、extract page、read webpage。";

const parameters = {
  type: "object",
  properties: {
    url: { type: "string", description: "要提取的网页 URL（与 archiveId 二选一）" },
    archiveId: { type: "string", description: "存档 ID（与 url 二选一，从已存档 HTML 文件提取）" },
    max_length: { type: "integer", description: "返回文本的最大字符数（可选，默认 10000）", default: 10000 },
  },
  required: [],
};

function execute(input, ctx) {
  const { url, archiveId, max_length = 10000 } = input;

  // 支持 archiveId 快捷输入
  let filePath = null;
  if (archiveId && !url) {
    const defaultDir = ctx?.dataDir || path.join(os.homedir(), ".hanako", "plugin-data", "webpage-archiver");
    const files = fs.readdirSync(defaultDir).filter(f => f.endsWith(".html"));
    const targetFile = files.find(f => {
      try {
        const content = fs.readFileSync(path.join(defaultDir, f), "utf-8");
        return content.includes(archiveId);
      } catch { return false; }
    });
    if (targetFile) filePath = path.join(defaultDir, targetFile);
  }

  if (!url && !filePath) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "需要提供 url 或 archiveId 参数" }, null, 2) }] };
  }

  // 构建 Python 脚本
  const isFileMode = !!filePath;
  const script = `
import asyncio, json, sys, os

class _StdoutRedirect:
    def write(self, s):
        if not s.strip(): return
        sys.__stderr__.write("[STDOUT-LOG] " + s)
    def flush(self): pass
    def isatty(self): return False

sys.stdout = _StdoutRedirect()
max_length = ${max_length}

async def _fetch():
    from crawl4ai import AsyncWebCrawler
    async with AsyncWebCrawler(verbose=False) as crawler:
        if ${isFileMode ? 'True' : 'False'}:
            # 从文件读取
            with open(${JSON.stringify(filePath)}, encoding="utf-8", errors="replace") as f:
                html = f.read()
            result = type('obj', (object,), {'markdown': '', 'html': html, 'success': True})()
        else:
            result = await crawler.arun(url=${JSON.stringify(url)}, word_count_threshold=10)
        return result

result = asyncio.run(_fetch())

sys.stdout = sys.__stdout__

if hasattr(result, 'markdown') and result.markdown:
    text = result.markdown.strip()
    if len(text) > max_length:
        text = text[:max_length] + "...\\n\\n（已截断）"
    print(json.dumps({"ok": True, "text": text, "length": len(text)}, ensure_ascii=True))
elif hasattr(result, 'html') and result.html:
    # 从 HTML 提取纯文本
    import re
    html = result.html
    text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.S|re.I)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.S|re.I)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'[\\s]+', ' ', text).strip()
    if len(text) > max_length:
        text = text[:max_length] + "...\\n\\n（已从 HTML 提取，已截断）"
    print(json.dumps({"ok": True, "text": text, "length": len(text)}, ensure_ascii=True))
else:
    print(json.dumps({"ok": False, "error": "未提取到内容"}, ensure_ascii=True))
`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wpa-extract-"));
  const tmpFile = path.join(tmpDir, "extract.py");
  fs.writeFileSync(tmpFile, script, "utf-8");

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
    if (e.message && (e.message.includes("crawl4ai") || e.message.includes("Import"))) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: false,
          error: "crawl4ai 未安装或未就绪",
          hint: "运行: pip install crawl4ai",
        }, null, 2) }],
      };
    }
    if (e.message && (e.message.includes("timeout") || e.message.includes("timed out"))) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          ok: false,
          error: "请求超时（>90s）",
          hint: "页面加载太慢或无法访问",
        }, null, 2) }],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify({
        ok: false,
        error: e.message,
      }, null, 2) }],
    };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

export { name, description, parameters, execute };
