import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const name = "webpage_extract_text";
const description = "提取网页内容为干净 Markdown 文本。基于 Crawl4AI，自动处理 JS 渲染。适用于需要阅读网页正文的场景。触发词：提取网页、抓取网页内容、extract page、read webpage。";

const parameters = {
  type: "object",
  properties: {
    url: { type: "string", description: "要提取的网页 URL" },
    max_length: { type: "integer", description: "返回文本的最大字符数（可选，默认 10000）", default: 10000 },
  },
  required: ["url"],
};

function execute(input) {
  const { url, max_length = 10000 } = input;

  // 脚本中用 sys.stdout.reconfigure 只输出 JSON，其他日志打 stderr
  const script = `
import asyncio
from crawl4ai import AsyncWebCrawler
import json
import sys

url = ${JSON.stringify(url)}
max_length = ${max_length}

# 重定向 stdout 用于输出 JSON，stderr 用于 Crawl4AI 日志
class _StdoutRedirect:
    def write(self, s):
        if not s.strip():
            return
        sys.__stderr__.write("[STDOUT-LOG] " + s)
    def flush(self):
        pass
    def isatty(self):
        return False

stdout_save = sys.stdout
sys.stdout = _StdoutRedirect()

async def _fetch():
    async with AsyncWebCrawler(verbose=False) as crawler:
        result = await crawler.arun(url=url, word_count_threshold=10)
        return result

result = asyncio.run(_fetch())

# 恢复 stdout 输出 JSON
sys.stdout = stdout_save

if result.markdown:
    text = result.markdown.strip()
    if len(text) > max_length:
        text = text[:max_length] + "...\\n\\n（已截断）"
    print(json.dumps({"ok": True, "text": text, "length": len(text)}, ensure_ascii=False))
else:
    print(json.dumps({"ok": False, "error": "未提取到内容，页面可能被反爬或为空"}, ensure_ascii=False))
`;

  const tmpDir = os.tmpdir();
  const tmpFile = path.join(tmpDir, `crawl4ai_extract_${Date.now()}.py`);
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
    try { fs.unlinkSync(tmpFile); } catch {}

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
  }
}

export { name, description, parameters, execute };
