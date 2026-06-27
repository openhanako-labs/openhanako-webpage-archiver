# 网页存档器 (Webpage Archiver)

HanaAgent 插件 —— 网页存档、内容提取、设计系统逆向、隐私审计、AI 编辑建议一体化工具链。

## 功能

| 工具 | 功能 |
|------|------|
| `webpage_archiver_save` | 保存网页为离线单文件 HTML（Scrapling 三层抓取 + SingleFile 打包） |
| `webpage_extract_text` | 提取网页内容为干净 Markdown 文本（支持 URL/archiveId） |
| `webpage_extract_tokens_core` | 提取设计 Token 原始数据（URL/文件/archiveId 输入） |
| `webpage_extract_tokens` | Token 格式化输出（CSS/Tailwind/JSON/DESIGN.md + preview） |
| `archive_summarize` | 扫描存档目录生成结构化元数据 + 隐私审计 |
| `generate_edit_prompt` | 分析 HTML 生成结构化 AI 编辑 prompt |

## 工作流

```
URL → save-page（存档，返回 archiveId + 文件路径）
    → extract-text（通过 url 或 archiveId 提取正文）
    → extract-tokens-core（提取原始 token）
    → extract-tokens（格式化输出 CSS/Tailwind/JSON/DESIGN.md + preview）
    → archive-summarize（摘要 + 隐私审计）
    → generate-edit-prompt（生成 AI 改进指令）
```

## 工具间契约

- `save-page` 返回 `archiveId`（URL 的 MD5 前 8 位）和 `filePath`
- `extract-*` 系列工具支持 `archiveId` 参数，自动从 plugin-data 目录查找已存档文件
- 所有工具默认输出目录为 `~/.hanako/plugin-data/webpage-archiver/`（可通过 `ctx.dataDir` 覆盖）

## 依赖

- **Scrapling**: `pip install scrapling[all]`（三层抓取：HTTP/Playwright/Stealth 反检测）
- **Playwright**: `playwright install chromium`（DynamicFetcher/StealthyFetcher 需要）
- **single-file-cli**: `npm install -g single-file-cli`（单文件打包，可选）
- **Chrome/Chromium**: SingleFile CLI 依赖

## 技术栈

- HanaAgent Plugin API（manifest v1）
- Node.js ESM
- Python（Scrapling，通过 mkdtemp 临时目录隔离执行）
- SingleFile CLI（仅用于打包，不再负责获取）

## 设计 token 提取

从网页 CSS 中提取颜色、字体、字号、圆角、阴影、间距、CSS 变量，每条 token 附带：
- **出现次数** + **置信度**（归一化到 0-1）
- **证据来源**（从哪个 CSS 块提取）

输出格式：
- `css` — CSS 自定义属性（`:root {}`）
- `tailwind` — Tailwind 配置对象
- `json` — 通用 JSON
- `design-md` — DESIGN.md 设计系统文档 + design-preview.html 可视化预览

## 隐私审计

扫描存档 HTML 中的：
- **追踪脚本**：规则库位于 `data/tracker-patterns.json`，支持外部扩展
- **指纹 API**：WebRTC IP 泄露、Canvas 指纹、音频指纹、硬件探测、电池 API、字体枚举等

每条发现附三段式说明：**怎么收集的 / 意味着什么 / 能做什么**

## 优化记录

- v2.3: 迁移到 Scrapling 三层抓取引擎（HTTP Fetcher / DynamicFetcher / StealthyFetcher），性能提升约 2x，支持 Cloudflare 绕过
- v2.1: 隐私审计维度，extract-tokens 拆分

## License

MIT
