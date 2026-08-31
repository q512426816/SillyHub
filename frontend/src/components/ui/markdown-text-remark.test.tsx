/**
 * MarkdownText remarkPlugins 透传测试（2026-08-31 变更关联审计 P3）。
 *
 * 变更文件预览经此 prop 挂变更名自动链接插件；不传时 remarkPlugins 保持
 * undefined（既有 6+ 处复用渲染行为零变化）。mock 手法与 markdown-text.test.tsx
 * 的 previewProps 捕获同款。
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

import { MarkdownText } from "./markdown-text";

const previewProps = vi.hoisted(
  () => [] as Array<{ source?: string; remarkPlugins?: unknown; rehypePlugins?: unknown }>,
);

vi.mock("@uiw/react-markdown-preview", () => ({
  __esModule: true,
  default: (props: { source?: string; remarkPlugins?: unknown; rehypePlugins?: unknown }) => {
    previewProps.push(props);
    return <div data-testid="mdp">{props.source}</div>;
  },
}));

describe("MarkdownText remarkPlugins 透传（变更关联 P3）", () => {
  it("传入的 remarkPlugins 原样透传给 MarkdownPreview", async () => {
    const fakePlugin = () => () => {};
    const plugins = [[fakePlugin, { k: 1 }]] as unknown as [];
    render(<MarkdownText content="# x" remarkPlugins={plugins} />);
    await waitFor(() => expect(screen.getByTestId("mdp")).toBeInTheDocument());
    const last = previewProps.at(-1);
    expect(last?.remarkPlugins).toBe(plugins);
    // rehype sanitize 链路不受透传影响（固定单例）
    expect(last?.rehypePlugins).toBeTruthy();
  });

  it("不传时 remarkPlugins 为 undefined（既有复用零变化）", async () => {
    render(<MarkdownText content="# y" />);
    await waitFor(() => expect(screen.getByTestId("mdp")).toBeInTheDocument());
    expect(previewProps.at(-1)?.remarkPlugins).toBeUndefined();
  });
});
