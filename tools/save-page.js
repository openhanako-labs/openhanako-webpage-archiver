const name = "webpage_archiver_save";
import path from "node:path";
import { execSync } from "node:child_process";

const description = "保存网页为离线单文件 HTML。使用 SingleFile CLI 将完整网页（含图片、CSS、字体、可选 JS）打包为单个 HTML 文件。设置 keepScripts=true 可保留 JavaScript 实现可交互存档（文件更大）。触发词：保存网页、存档页面、save page、SingleFile。";

const parameters = {
  type: "object",
  properties: {
    url: { type: "string", description: "要保存的网页 URL" },
    outputDir: { type: "string", description: "输出目录（可选，默认临时目录）" },
    filename: { type: "string", description: "文件名（可选，不含扩展名，默认自动生成）" },
    blockImages: { type: "boolean", description: "拦截图片以减小体积（可选，默认 false）" },
    keepScripts: { type: "boolean", description: "保留 JavaScript 实现可交互存档（可选，默认 false。开启后文件更大但页面可交互）" },
    waitUntil: { type: "string", enum: ["load", "networkIdle", "none"], description: "页面加载等待策略（可选，默认 networkIdle）" },
  },
  required: ["url"],
};

async function execute(input, ctx) {
  try {
    const { url, outputDir, filename, blockImages, keepScripts, waitUntil } = input;

    // 构建输出路径 — 默认使用 plugin-data 目录
    const os = await import("node:os");
    const fs = await import("node:fs");
    const crypto = await import("node:crypto");
    const defaultDir = ctx?.dataDir || path.join(os.homedir(), ".hanako", "plugin-data", "webpage-archiver");
    const dir = outputDir || defaultDir;
    fs.mkdirSync(dir, { recursive: true });

    const safeName = filename || `page_${Date.now()}`;
    const outputPath = path.join(dir, `${safeName}.html`);

    // 构建命令参数
    const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
    const args = [url, outputPath, `--browser-executable-path="${chromePath}"`];
    if (blockImages) args.push("--block-images=true");
    if (keepScripts) args.push("--block-scripts=false");
    if (waitUntil) args.push(`--browser-wait-until=${waitUntil}`);
    args.push("--browser-headless=true");
    args.push("--remove-hidden-elements=true");
    args.push("--remove-unused-styles=true");

    // 执行
    const cmd = `single-file ${args.join(" ")}`;
    const startTime = Date.now();
    execSync(cmd, { timeout: 120000, stdio: "pipe" });

    // 检查输出
    if (!fs.existsSync(outputPath)) {
      throw new Error("输出文件未生成");
    }

    const stat = fs.statSync(outputPath);
    const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: true,
          filePath: outputPath,
          fileSize: `${sizeMB}MB`,
          elapsed: `${elapsed}s`,
          message: `✅ 网页已保存: ${safeName}.html (${sizeMB}MB, ${elapsed}s)`,
        }, null, 2),
      }],
    };
  } catch (e) {
    const stderr = e.stderr?.toString() || "";
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: e.message,
          detail: stderr.slice(0, 500),
          hint: "确认 single-file 已安装 (npm install -g single-file-cli)，且 Chrome/Chromium 可用",
        }, null, 2),
      }],
    };
  }
}

export { name, description, parameters, execute };