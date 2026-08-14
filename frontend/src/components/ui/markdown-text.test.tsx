import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import rehypeSanitize from "rehype-sanitize";

import {
  MARKDOWN_SANITIZE_SCHEMA,
  MarkdownText,
  markdownRehypePlugins,
} from "./markdown-text";

// ---------------------------------------------------------------------------
// 工具：手工构造 hast 树（模拟 @uiw 管线在 sanitize 之前的真实输出形态），
// 直接跑 rehypeSanitize(MARKDOWN_SANITIZE_SCHEMA) 验证 schema 行为。
// 属性键混用裸名（class / data-code）与驼峰（className / dataCode）——
// @uiw 的 rehypeRewrite 注入裸名，mdast-util-to-hast 产驼峰，schema 两者都要过。
// ---------------------------------------------------------------------------
type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const sanitizeTree = rehypeSanitize(MARKDOWN_SANITIZE_SCHEMA) as unknown as (
  tree: HastNode,
) => HastNode;
function el(
  tagName: string,
  properties: Record<string, unknown> = {},
  children: HastNode[] = [],
): HastNode {
  return { type: "element", tagName, properties, children };
}

function text(value: string): HastNode {
  return { type: "text", value };
}

function run(children: HastNode[]): HastNode[] {
  const out = sanitizeTree({ type: "root", children });
  return (out.children ?? []) as HastNode[];
}

function findTag(nodes: HastNode[], tag: string): HastNode | undefined {
  for (const node of nodes) {
    if (node.tagName === tag) return node;
    const nested = findTag(node.children ?? [], tag);
    if (nested) return nested;
  }
  return undefined;
}

describe("MARKDOWN_SANITIZE_SCHEMA XSS 注入净化（task-13）", () => {
  it("<script>alert(1)</script>：script 节点连同子内容整体移除（defaultSchema strip）", () => {
    const out = run([el("script", {}, [text("alert(1)")])]);
    expect(out).toHaveLength(0);
    expect(findTag(out, "script")).toBeUndefined();
  });

  it("img onerror 内联事件被剥离，合法 src 保留", () => {
    const out = run([
      el("img", { src: "https://example.com/a.png", onError: "alert(1)" }),
    ]);
    const img = findTag(out, "img");
    expect(img).toBeDefined();
    expect(img?.properties?.src).toBe("https://example.com/a.png");
    expect(img?.properties?.onError).toBeUndefined();
  });

  it("a href=javascript: 协议被剥离，https 链接保留", () => {
    const out = run([
      el("a", { href: "javascript:alert(1)" }, [text("x")]),
      el("a", { href: "https://example.com" }, [text("y")]),
    ]);
    const links = out.filter((n) => n.tagName === "a");
    expect(links).toHaveLength(2);
    expect(links[0]?.properties?.href).toBeUndefined();
    expect(links[1]?.properties?.href).toBe("https://example.com");
  });

  it("iframe 未列 tagNames：内容退化为纯文本（惰性、不可执行）", () => {
    const out = run([el("iframe", { src: "https://evil.example.com" }, [text("x")])]);
    expect(findTag(out, "iframe")).toBeUndefined();
    // 非 strip 标签：子内容降为纯文本保留（同 GitHub 行为），src 属性随节点一起消失
    expect(out.some((n) => n.type === "text" && n.value === "x")).toBe(true);
  });

  it("style 标签与 on* 事件属性不放行", () => {
    const out = run([
      el("style", {}, [text("body{display:none}")]),
      el("p", { onClick: "alert(1)" }, [text("p")]),
    ]);
    expect(findTag(out, "style")).toBeUndefined();
    const p = findTag(out, "p");
    expect(p?.properties?.onClick).toBeUndefined();
  });

  it("a target=_blank / rel=noreferrer noopener 保留，其它 target 剥离", () => {
    // rel 经 property-information 解析为 space-separated 数组（真实管线产物形态）
    const out = run([
      el("a", { href: "https://example.com", target: "_blank", rel: ["noreferrer", "noopener"] }, [text("a")]),
      el("a", { href: "https://example.com", target: "_top", rel: ["noreferrer", "external"] }, [text("b")]),
    ]);
    const links = out.filter((n) => n.tagName === "a");
    expect(links[0]?.properties?.target).toBe("_blank");
    expect(links[0]?.properties?.rel).toEqual(["noreferrer", "noopener"]);
    expect(links[1]?.properties?.target).toBeUndefined();
    // rel 数组逐项匹配白名单，external 不在白名单被剔除
    expect(links[1]?.properties?.rel).toEqual(["noreferrer"]);
  });
});

describe("MARKDOWN_SANITIZE_SCHEMA 平台 markdown 产物保真（task-13）", () => {
  it("GFM 表格 thead/tbody/tr/th/td 完整保留", () => {
    const out = run([
      el("table", {}, [
        el("thead", {}, [el("tr", {}, [el("th", { align: "left" }, [text("H")])])]),
        el("tbody", {}, [el("tr", {}, [el("td", {}, [text("D")])])]),
      ]),
    ]);
    for (const tag of ["table", "thead", "tbody", "tr", "th", "td"]) {
      expect(findTag(out, tag), `${tag} 应保留`).toBeDefined();
    }
  });

  it("fenced code 的 language-* className 与 data-meta 保留（rehype-prism-plus 依赖）", () => {
    const out = run([
      el("pre", {}, [
        el("code", { className: ["language-ts"], "data-meta": "copy" }, [text("const a = 1;")]),
      ]),
    ]);
    const code = findTag(out, "code");
    expect(code?.properties?.className).toEqual(["language-ts"]);
    expect(code?.properties?.["data-meta"]).toBe("copy");
  });

  it("GFM 任务列表 input[type=checkbox] 保留", () => {
    const out = run([
      el("ul", { className: ["contains-task-list"] }, [
        el("li", { className: ["task-list-item"] }, [
          el("input", { type: "checkbox", checked: true }),
          text("todo"),
        ]),
      ]),
    ]);
    const input = findTag(out, "input");
    expect(input?.properties?.type).toBe("checkbox");
    expect(input?.properties?.checked).toBe(true);
    expect(input?.properties?.disabled).toBe(true); // required 强制注入
  });

  it("@uiw 代码块复制按钮（div.copied[data-code] + svg/path 图标）保留", () => {
    // 复刻 rehypeRewrite 注入的节点形态：裸属性名 class / data-code
    const out = run([
      el("pre", {}, [
        el("code", { className: ["language-ts"] }, [text("let x;")]),
        el("div", { class: "copied", "data-code": "let x;" }, [
          el("svg", {
            className: ["octicon-copy"],
            ariaHidden: "true",
            viewBox: "0 0 16 16",
            fill: "currentColor",
            height: 12,
            width: 12,
          }, [
            el("path", { fillRule: "evenodd", d: "M0 6.75C0 5.784.784 5 1.75 5h1.5z" }),
          ]),
        ]),
      ]),
    ]);
    const copied = findTag(out, "div");
    expect(copied?.properties?.class).toBe("copied");
    expect(copied?.properties?.["data-code"]).toBe("let x;");
    const svg = findTag(out, "svg");
    expect(svg?.properties?.className).toEqual(["octicon-copy"]);
    expect(svg?.properties?.ariaHidden).toBe("true");
    expect(svg?.properties?.viewBox).toBe("0 0 16 16");
    const path = findTag(out, "path");
    expect(path?.properties?.d).toBe("M0 6.75C0 5.784.784 5 1.75 5h1.5z");
    expect(path?.properties?.fillRule).toBe("evenodd");
  });

  it("标题锚点（h1 id 前缀化 + a.anchor ariaHidden + svg）保留", () => {
    const out = run([
      el("h1", { id: "title" }, [
        text("标题"),
        el("a", { class: "anchor", href: "#title", ariaHidden: "true" }, [
          el("svg", { className: ["octicon", "octicon-link"], viewBox: "0 0 16 16", version: "1.1", width: "16", height: "16", ariaHidden: "true" }, [
            el("path", { fillRule: "evenodd", d: "M7.775 3.275z" }),
          ]),
        ]),
      ]),
    ]);
    const h1 = findTag(out, "h1");
    expect(h1?.properties?.id).toBe("user-content-title"); // clobber 防护前缀，防 id 伪造
    const anchor = findTag(out, "a");
    expect(anchor?.properties?.class).toBe("anchor");
    expect(anchor?.properties?.href).toBe("#title");
    expect(anchor?.properties?.ariaHidden).toBe("true");
    expect(findTag(out, "svg")).toBeDefined();
    expect(findTag(out, "path")).toBeDefined();
  });

  it("图片与相对链接保留", () => {
    const out = run([
      el("img", { src: "https://example.com/a.png", alt: "图" }),
      el("a", { href: "relative/doc.md" }, [text("rel")]),
    ]);
    expect(findTag(out, "img")?.properties?.src).toBe("https://example.com/a.png");
    expect(findTag(out, "a")?.properties?.href).toBe("relative/doc.md");
  });
});

// ---------------------------------------------------------------------------
// MarkdownText 组件透传：mock @uiw/react-markdown-preview（jsdom 已知坑，见
// change-file-tree.test.tsx 同款降级），捕获 rehypePlugins 传参断言。
// ---------------------------------------------------------------------------
const previewProps = vi.hoisted(
  () => [] as Array<{ source?: string; rehypePlugins?: unknown }>,
);

vi.mock("@uiw/react-markdown-preview", () => ({
  __esModule: true,
  default: (props: { source?: string; rehypePlugins?: unknown }) => {
    previewProps.push(props);
    return <div data-testid="mdp">{props.source}</div>;
  },
}));

describe("MarkdownText 透传 rehype-sanitize（task-13）", () => {
  it("渲染时挂载 [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA] 插件", async () => {
    render(<MarkdownText content="# 标题" />);
    await waitFor(() => expect(screen.getByTestId("mdp")).toBeInTheDocument());
    const last = previewProps.at(-1);
    expect(last?.source).toBe("# 标题");
    expect(last?.rehypePlugins).toBe(markdownRehypePlugins);
    const entry = (last?.rehypePlugins as [unknown, unknown][])[0];
    expect(entry?.[0]).toBe(rehypeSanitize);
    expect(entry?.[1]).toBe(MARKDOWN_SANITIZE_SCHEMA);
  });
});
