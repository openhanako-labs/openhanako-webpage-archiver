# 网页存档器 (Webpage Archiver)

HanaAgent 插件 —— 网页存档、内容提取、设计系统逆向、隐私审计、AI 编辑建议一体化工具链。

## 功能

| 工具 | 功能 |
|------|------|
| `webpage_archiver_save` | 保存网页为离线单文件 HTML（SingleFile CLI） |
| `webpage_extract_text` | 提取网页内容为干净 Markdown 文本（Crawl4AI） |
| `webpage_extract_tokens` | 从网页提取设计系统 Token，输出 CSS / Tailwind / JSON / DESIGN.md + 可视化预览 |
| `archive_summarize` | 扫描存档目录生成结构化元数据 + 隐私审计（追踪脚本 + 指纹 API 检测） |
| `generate_edit_prompt` | 分析 HTML 生成结构化 AI 编辑 prompt（结构/设计/可访问性/性能） |

## 工作流

```
URL → save-page（存档）
    → extract-text（提取正文）
    → extract-tokens（提取设计系统 → DESIGN.md + 预览）
    → archive-summarize（摘要 + 隐私审计）
    → generate-edit-prompt（生成 AI 改进指令）
```

## 依赖

- **single-file-cli**: `npm install -g single-file-cli`（网页存档）
- **crawl4ai**: `pip install crawl4ai`（内容提取 + 设计 token 提取）
- **Chrome/Chromium**: SingleFile CLI 依赖

## 安装

将本目录放入 HanaAgent 的 `plugins` 目录，重启即可加载。

## 技术栈

- HanaAgent Plugin API（manifest v1）
- Node.js ESM
- Python（Crawl4AI，通过 execFileSync 调用）
- SingleFile CLI

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
- **追踪脚本**：Google Analytics、Facebook Pixel、Hotjar、Microsoft Clarity、DoubleClick、Amazon Ads 等
- **指纹 API**：WebRTC IP 泄露、Canvas 指纹、音频指纹、硬件探测、电池 API、字体枚举等

每条发现附三段式说明：**怎么收集的 / 意味着什么 / 能做什么**

## License

MIT
