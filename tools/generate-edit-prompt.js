/**
 * generate-edit-prompt.js
 * 网页存档器 — AI 编辑建议 Prompt 生成器 v2.1
 *
 * 分析存档的 HTML 文件（或在线 URL），提取结构、设计一致性、
 * 可访问性、性能等维度的问题信号，生成结构化的 AI 编辑 prompt，
 * 可直接粘贴给 Claude / ChatGPT / Cursor 等 AI 工具执行修改。
 *
 * 整合来源：ClickDeck — AI Edit Prompt + Review Prompt Handoff
 * 将页面视觉/结构问题自动转化为 AI 可读的修改指令。
 *
 * 触发词：编辑建议、AI编辑prompt、edit prompt、review prompt、页面改进建议
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import os from "node:os";

const name = "generate_edit_prompt";
const description = "分析存档的 HTML 文件或在线 URL，提取结构、设计一致性、可访问性、性能问题，生成结构化 AI 编辑 prompt，可直接粘贴给 AI 工具执行修改。触发词：编辑建议、AI编辑prompt、edit prompt、review prompt、页面改进建议。";

const parameters = {
  type: "object",
  properties: {
    filePath: { type: "string", description: "存档的 HTML 文件路径（与 url 二选一）" },
    url: { type: "string", description: "在线 URL（与 filePath 二选一，需 crawl4ai）" },
    focus: {
      type: "string",
      enum: ["all", "structure", "design", "accessibility", "performance"],
      default: "all",
      description: "分析重点：all（全部）、structure（结构）、design（设计一致性）、accessibility（可访问性）、performance（性能）",
    },
    maxPrompts: { type: "integer", default: 10, description: "最大生成 prompt 数量（默认 10）" },
  },
  required: [],
};

// ─── HTML 分析器 ──────────────────────────────────────────

function analyzeHtml(html) {
  const issues = [];

  // ── 结构分析 ──
  const hasDoctype = /^\s*<!doctype/i.test(html);
  if (!hasDoctype) {
    issues.push({
      category: "structure",
      severity: "medium",
      title: "缺少 DOCTYPE 声明",
      detail: "页面未声明 <!DOCTYPE html>，可能导致浏览器进入怪异模式",
      prompt: "在 HTML 文件最顶部添加 `<!DOCTYPE html>` 声明，确保浏览器以标准模式渲染。",
    });
  }

  const hasMetaViewport = /<meta[^>]+name=["']viewport["']/i.test(html);
  if (!hasMetaViewport) {
    issues.push({
      category: "structure",
      severity: "high",
      title: "缺少 viewport meta 标签",
      detail: "页面未设置 viewport，移动端会以桌面宽度渲染然后缩小",
      prompt: "在 <head> 中添加 `<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">`，确保移动端正确渲染。",
    });
  }

  const hasLangAttr = /<html[^>]+lang=/i.test(html);
  if (!hasLangAttr) {
    issues.push({
      category: "structure",
      severity: "low",
      title: "缺少 lang 属性",
      detail: "<html> 标签未设置 lang 属性，影响搜索引擎和屏幕阅读器",
      prompt: "为 <html> 标签添加 lang 属性，例如 `<html lang=\"zh-CN\">`。",
    });
  }

  const hasCharset = /<meta[^>]+charset=/i.test(html);
  if (!hasCharset) {
    issues.push({
      category: "structure",
      severity: "medium",
      title: "缺少 charset 声明",
      detail: "未声明字符编码，可能导致乱码",
      prompt: "在 <head> 最前面添加 `<meta charset=\"UTF-8\">`。",
    });
  }

  const hasTitle = /<title[^>]*>[^<]+<\/title>/i.test(html);
  if (!hasTitle) {
    issues.push({
      category: "structure",
      severity: "medium",
      title: "缺少 title 标签",
      detail: "页面无标题，影响 SEO 和用户体验",
      prompt: "在 <head> 中添加一个描述性的 <title> 标签。",
    });
  }

  const hasMetaDescription = /<meta[^>]+name=["']description["']/i.test(html);
  if (!hasMetaDescription) {
    issues.push({
      category: "structure",
      severity: "low",
      title: "缺少 meta description",
      detail: "未设置页面描述，影响搜索引擎摘要",
      prompt: "在 <head> 中添加 `<meta name=\"description\" content=\"页面描述\">`。",
    });
  }

  // ── 设计一致性分析 ──

  // 提取所有内联颜色
  const colorMatches = html.match(/(?:color|background|border-color|fill|stroke)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsla?\([^)]+\))/gi) || [];
  const colorSet = new Set(colorMatches.map(c => c.replace(/^.*:\s*/, "").toLowerCase().trim()));
  if (colorSet.size > 15) {
    const sample = Array.from(colorSet).slice(0, 10).join(", ");
    issues.push({
      category: "design",
      severity: "medium",
      title: `色彩过多（${colorSet.size} 种）`,
      detail: `页面使用了 ${colorSet.size} 种不同颜色，建议收敛到 5-8 种主色。部分颜色：${sample}`,
      prompt: `页面使用了 ${colorSet.size} 种颜色，存在色彩管理问题。请分析现有颜色，归类为主色/辅助色/中性色/语义色，将相近颜色合并，输出一套不超过 8 种的 CSS 变量配色方案（:root 中定义），并替换页面中所有内联颜色引用。`,
    });
  }

  // 提取字体族
  const fontMatches = html.match(/font-family\s*:\s*([^;}"']+)/gi) || [];
  const fontSet = new Set(fontMatches.map(f => f.replace(/font-family\s*:\s*/i, "").trim().split(",")[0].trim().replace(/['"]/g, "")));
  if (fontSet.size > 4) {
    issues.push({
      category: "design",
      severity: "medium",
      title: `字体族过多（${fontSet.size} 种）`,
      detail: `页面使用了 ${fontSet.size} 种字体族：${Array.from(fontSet).join(", ")}。建议正文一种、标题一种、等宽一种，不超过 3 种。`,
      prompt: `页面使用了 ${fontSet.size} 种字体族（${Array.from(fontSet).join(", ")}）。请统一字体系统：定义 1 种正文字体、1 种标题字体、1 种等宽字体，用 CSS 变量管理，替换所有内联 font-family 声明。`,
    });
  }

  // 提取字号
  const fontSizeMatches = html.match(/font-size\s*:\s*([^;}"']+)/gi) || [];
  const fontSizeSet = new Set(fontSizeMatches.map(f => f.replace(/font-size\s*:\s*/i, "").trim()));
  if (fontSizeSet.size > 8) {
    issues.push({
      category: "design",
      severity: "low",
      title: `字号层级过多（${fontSizeSet.size} 种）`,
      detail: `页面使用了 ${fontSizeSet.size} 种不同字号，建议建立清晰的字号阶梯（如 xs/sm/base/lg/xl/2xl/3xl）。`,
      prompt: `页面有 ${fontSizeSet.size} 种字号。请设计一套 6-8 级的字号阶梯（CSS 变量），将所有内联 font-size 映射到最近的阶梯值，消除冗余字号。`,
    });
  }

  // 提取圆角
  const radiusMatches = html.match(/border-radius\s*:\s*([^;}"']+)/gi) || [];
  const radiusSet = new Set(radiusMatches.map(r => r.replace(/border-radius\s*:\s*/i, "").trim()));
  if (radiusSet.size > 6) {
    issues.push({
      category: "design",
      severity: "low",
      title: `圆角值过多（${radiusSet.size} 种）`,
      detail: `页面使用了 ${radiusSet.size} 种不同圆角值，建议统一到 3-4 级（none/sm/md/lg/full）`,
      prompt: `页面有 ${radiusSet.size} 种圆角值。请定义 4-5 级圆角变量（如 --radius-sm/md/lg/full），将所有 border-radius 映射到最近级别。`,
    });
  }

  // 检查内联样式比例
  const inlineStyleCount = (html.match(/style="/gi) || []).length;
  const totalTags = (html.match(/<div|<span|<p|<a|<section|<article|<header|<footer|<nav|<ul|<li|<h[1-6]/gi) || []).length;
  if (totalTags > 0 && inlineStyleCount / totalTags > 0.5) {
    issues.push({
      category: "design",
      severity: "medium",
      title: `内联样式比例过高（${Math.round(inlineStyleCount / totalTags * 100)}%）`,
      detail: `${inlineStyleCount} 个内联样式 / ${totalTags} 个标签，内联样式占比过高，难以维护`,
      prompt: `页面内联样式占比 ${Math.round(inlineStyleCount / totalTags * 100)}%（${inlineStyleCount} 个 style 属性）。请将内联样式提取为 CSS class，用语义化命名，移除所有 style 属性。`,
    });
  }

  // ── 可访问性分析 ──

  const imgCount = (html.match(/<img\s/gi) || []).length;
  const imgWithAlt = (html.match(/<img[^>]+alt=/gi) || []).length;
  const imgWithoutAlt = imgCount - imgWithAlt;
  if (imgWithoutAlt > 0) {
    issues.push({
      category: "accessibility",
      severity: "medium",
      title: `${imgWithoutAlt} 个图片缺少 alt 属性`,
      detail: `${imgWithoutAlt}/${imgCount} 个 <img> 标签缺少 alt 属性，屏幕阅读器无法描述`,
      prompt: `页面有 ${imgWithoutAlt} 个图片缺少 alt 属性。请为所有 <img> 标签添加 alt 属性：装饰性图片用 alt=""，内容性图片提供描述性文本。`,
    });
  }

  const hasSkipLink = /skip.*link|skip.*nav|skip.*content/i.test(html);
  const hasNav = /<nav/i.test(html);
  if (hasNav && !hasSkipLink) {
    issues.push({
      category: "accessibility",
      severity: "low",
      title: "缺少跳转导航链接",
      detail: "页面有导航栏但无 skip-to-content 链接，键盘用户需逐个 tab 跳过导航",
      prompt: "在页面最顶部添加一个视觉隐藏的 skip 链接：`<a href=\"#main\" class=\"skip-link\">跳到主内容</a>`，并为主内容区添加 id=\"main\"。",
    });
  }

  // 检查标题层级
  const h1Count = (html.match(/<h1[\s>]/gi) || []).length;
  if (h1Count === 0) {
    issues.push({
      category: "accessibility",
      severity: "medium",
      title: "缺少 H1 标题",
      detail: "页面没有 <h1> 标签，影响 SEO 和无障碍体验",
      prompt: "页面缺少 <h1> 标签。请在主内容区添加一个描述页面主题的 <h1>。",
    });
  } else if (h1Count > 1) {
    issues.push({
      category: "accessibility",
      severity: "low",
      title: `多个 H1 标题（${h1Count} 个）`,
      detail: "页面有多个 <h1>，建议每页只有一个 <h1>",
      prompt: `页面有 ${h1Count} 个 <h1> 标签。请保留主标题为 <h1>，其余降级为 <h2> 或 <h3>。`,
    });
  }

  // 检查 button 和 a 的可访问性
  const emptyLinks = (html.match(/<a[^>]*>\s*<\/a>/gi) || []).length;
  const emptyButtons = (html.match(/<button[^>]*>\s*<\/button>/gi) || []).length;
  if (emptyLinks + emptyButtons > 0) {
    issues.push({
      category: "accessibility",
      severity: "medium",
      title: `${emptyLinks + emptyButtons} 个空链接/按钮`,
      detail: `${emptyLinks} 个空 <a> + ${emptyButtons} 个空 <button>，无文本内容，屏幕阅读器无法识别`,
      prompt: `页面有 ${emptyLinks + emptyButtons} 个空链接/按钮。请添加文本内容或 aria-label 属性。`,
    });
  }

  // 检查 ARIA roles
  const ariaLabelCount = (html.match(/aria-label=/gi) || []).length;
  const ariaLabelledbyCount = (html.match(/aria-labelledby=/gi) || []).length;
  if (ariaLabelCount === 0 && ariaLabelledbyCount === 0 && totalTags > 20) {
    issues.push({
      category: "accessibility",
      severity: "low",
      title: "未使用 ARIA 标签",
      detail: "页面未使用任何 aria-label 或 aria-labelledby，对于交互组件可能需要补充",
      prompt: "检查页面中的交互组件（按钮、菜单、对话框等），为没有可见文本的组件添加 aria-label 或 aria-labelledby 属性。",
    });
  }

  // ── 性能分析 ──

  // 检查内联大图片（data URI）
  const dataUriMatches = html.match(/data:image\/[^"'\s)]{100,}/gi) || [];
  if (dataUriMatches.length > 3) {
    const totalSize = dataUriMatches.reduce((sum, d) => sum + d.length, 0);
    const sizeKB = Math.round(totalSize / 1024);
    issues.push({
      category: "performance",
      severity: sizeKB > 500 ? "high" : "medium",
      title: `${dataUriMatches.length} 个内联图片（约 ${sizeKB}KB）`,
      detail: `页面内嵌了 ${dataUriMatches.length} 个 data URI 图片，总计约 ${sizeKB}KB，增大 HTML 体积`,
      prompt: `页面有 ${dataUriMatches.length} 个内联 data URI 图片（约 ${sizeKB}KB）。请将大图片提取为独立文件，使用 <img> 标签加载，添加 loading=\"lazy\" 属性。仅保留小图标（<4KB）为 data URI。`,
    });
  }

  // 检查外部脚本数量
  const externalScripts = (html.match(/<script[^>]+src=/gi) || []).length;
  if (externalScripts > 6) {
    issues.push({
      category: "performance",
      severity: "medium",
      title: `外部脚本过多（${externalScripts} 个）`,
      detail: `页面加载了 ${externalScripts} 个外部 JS 文件，建议合并并使用 async/defer`,
      prompt: `页面加载了 ${externalScripts} 个外部脚本。请合并可合并的脚本，为非关键脚本添加 defer 属性，评估是否可以用原生 CSS 替代部分 JS 功能。`,
    });
  }

  // 检查 CSS 块数量
  const styleBlocks = (html.match(/<style/gi) || []).length;
  if (styleBlocks > 5) {
    issues.push({
      category: "performance",
      severity: "low",
      title: `CSS 块过多（${styleBlocks} 个）`,
      detail: `页面有 ${styleBlocks} 个 <style> 块，建议合并为一个`,
      prompt: `页面有 ${styleBlocks} 个 <style> 块。请合并为单个 <style> 块，去重并整理 CSS 规则顺序。`,
    });
  }

  // 检查未优化的 CSS 选择器
  const universalSelectors = (html.match(/\*\s*\{/g) || []).length;
  if (universalSelectors > 2) {
    issues.push({
      category: "performance",
      severity: "low",
      title: `使用了通用选择器 *（${universalSelectors} 次）`,
      detail: "通用选择器 * 性能开销大，尤其在大型页面中",
      prompt: `页面使用了 ${universalSelectors} 次通用选择器 *。请替换为具体的元素选择器或 class 选择器。`,
    });
  }

  // 检查是否缺少 preload/prefetch
  const hasPreload = /rel=["']preload["']/i.test(html);
  const hasPreconnect = /rel=["']preconnect["']/i.test(html);
  const hasExternalFonts = /fonts\.googleapis|fonts\.gstatic|@font-face/i.test(html);
  if (hasExternalFonts && !hasPreconnect) {
    issues.push({
      category: "performance",
      severity: "low",
      title: "加载外部字体但未使用 preconnect",
      detail: "页面加载 Google Fonts 等外部字体，但未添加 preconnect 提示",
      prompt: "页面加载外部字体但未使用 preconnect。在 <head> 中添加 `<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">` 和 `<link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin>`。",
    });
  }

  return issues;
}

// ─── Prompt 生成器 ──────────────────────────────────────────

function generatePrompts(issues, focus, maxPrompts, sourceInfo) {
  // 按焦点过滤
  const filtered = focus === "all" ? issues : issues.filter(i => i.category === focus);
  // 按严重度排序
  const severityOrder = { high: 0, medium: 1, low: 2 };
  filtered.sort((a, b) => (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3));
  // 截断
  const selected = filtered.slice(0, maxPrompts);

  if (selected.length === 0) {
    return {
      prompts: [],
      summary: focus === "all"
        ? "未发现明显问题，页面质量良好。"
        : `${focus} 维度未发现问题。`,
    };
  }

  // 分类统计
  const byCategory = {};
  for (const issue of selected) {
    byCategory[issue.category] = (byCategory[issue.category] || 0) + 1;
  }

  // 生成结构化 prompt
  let promptText = `# 页面分析与编辑建议\n\n`;
  promptText += `**分析目标**: ${sourceInfo}\n`;
  promptText += `**发现问题**: ${selected.length} 个`;
  if (focus !== "all") promptText += `（${focus} 维度）`;
  promptText += `\n`;
  promptText += `**分类**: ${Object.entries(byCategory).map(([k, v]) => `${k}(${v})`).join(" / ")}\n\n`;
  promptText += `---\n\n`;

  // 按类别分组输出
  const categories = ["structure", "design", "accessibility", "performance"];
  const categoryLabels = {
    structure: "结构问题",
    design: "设计一致性",
    accessibility: "可访问性",
    performance: "性能优化",
  };

  for (const cat of categories) {
    const catIssues = selected.filter(i => i.category === cat);
    if (catIssues.length === 0) continue;

    promptText += `## ${categoryLabels[cat]}\n\n`;
    catIssues.forEach((issue, idx) => {
      promptText += `### ${idx + 1}. ${issue.title}\n\n`;
      promptText += `**严重度**: ${issue.severity}\n`;
      promptText += `**问题**: ${issue.detail}\n\n`;
      promptText += `**修改指令**:\n\n`;
      promptText += `> ${issue.prompt}\n\n`;
    });
  }

  // 生成可直接粘贴的 AI prompt
  promptText += `---\n\n## AI 修改指令（可直接粘贴）\n\n`;
  promptText += `\`\`\`\n`;
  promptText += `请分析并修改以下 HTML 页面，解决以下 ${selected.length} 个问题：\n\n`;
  selected.forEach((issue, idx) => {
    promptText += `${idx + 1}. [${issue.severity}] ${issue.title}\n   ${issue.prompt}\n`;
  });
  promptText += `\n请逐一修复，保持原有功能不变，输出完整的修改后 HTML。\n`;
  promptText += `\`\`\`\n`;

  return {
    prompts: selected.map(i => ({ category: i.category, severity: i.severity, title: i.title, prompt: i.prompt })),
    fullPrompt: promptText,
    summary: `发现 ${selected.length} 个问题（${Object.entries(byCategory).map(([k, v]) => `${v} ${k}`).join(", ")}）`,
    byCategory,
  };
}

// ─── 主执行 ──────────────────────────────────────────

async function execute(input = {}, ctx) {
  const { filePath, url, focus = "all", maxPrompts = 10 } = input;

  if (!filePath && !url) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: "需要提供 filePath 或 url 参数",
        }, null, 2),
      }],
    };
  }

  let html = "";
  let sourceInfo = "";

  // 从文件读取
  if (filePath) {
    if (!fs.existsSync(filePath)) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ ok: false, error: "文件不存在: " + filePath }, null, 2),
        }],
      };
    }
    html = fs.readFileSync(filePath, "utf-8");
    sourceInfo = `文件: ${path.basename(filePath)}`;
  } else {
    // 从 URL 获取（使用 crawl4ai）
    sourceInfo = `URL: ${url}`;
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `edit-prompt-fetch-${Date.now()}.py`);
    const script = `
import asyncio, json, sys
from crawl4ai import AsyncWebCrawler

class _StdoutRedirect:
    def write(self, s):
        if not s.strip(): return
        sys.__stderr__.write("[LOG] " + s)
    def flush(self): pass
    def isatty(self): return False

sys.stdout = _StdoutRedirect()

async def main():
    async with AsyncWebCrawler(verbose=False) as crawler:
        result = await crawler.arun(url=${JSON.stringify(url)}, word_count_threshold=0)
        html = result.html or ""
    sys.stdout = sys.__stdout__
    if html:
        print(json.dumps({"ok": True, "html": html}, ensure_ascii=False))
    else:
        print(json.dumps({"ok": False, "error": "未能获取页面内容"}, ensure_ascii=False))

asyncio.run(main())
`;
    fs.writeFileSync(tmpFile, script, "utf-8");
    try {
      const stdout = execFileSync("python", [tmpFile], {
        timeout: 90000,
        encoding: "utf-8",
        maxBuffer: 20 * 1024 * 1024,
      }).trim();
      const result = JSON.parse(stdout);
      if (!result.ok) {
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      html = result.html;
    } catch (e) {
      try { fs.unlinkSync(tmpFile); } catch {}
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
    }
    try { fs.unlinkSync(tmpFile); } catch {}
  }

  // 分析
  const issues = analyzeHtml(html);
  const result = generatePrompts(issues, focus, maxPrompts, sourceInfo);

  // 页面统计
  const stats = {
    htmlSize: `${(html.length / 1024).toFixed(1)}KB`,
    totalTags: (html.match(/<[a-z]/gi) || []).length,
    inlineStyles: (html.match(/style="/gi) || []).length,
    scripts: (html.match(/<script/gi) || []).length,
    styleBlocks: (html.match(/<style/gi) || []).length,
    images: (html.match(/<img/gi) || []).length,
    links: (html.match(/<a\s/gi) || []).length,
  };

  const output = {
    ok: true,
    source: sourceInfo,
    focus,
    stats,
    summary: result.summary,
    byCategory: result.byCategory,
    totalIssues: issues.length,
    selectedIssues: result.prompts.length,
    prompts: result.prompts,
  };

  return {
    content: [
      { type: "text", text: JSON.stringify(output, null, 2) },
      { type: "text", text: result.fullPrompt },
    ],
  };
}

export { name, description, parameters, execute };
