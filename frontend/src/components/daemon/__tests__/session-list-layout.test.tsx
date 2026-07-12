/**
 * 2026-07-11-unify-runtime-session-dialog / FR-01 / D-001 / task-09:
 * SessionListLayout 公共组件测试。
 *
 * 覆盖：列表渲染（title + shortId 回退）/ 选中高亮 / onSelect 回调 /
 * onDelete 回调（传入时渲染删除按钮，不传时无）/ 空态 / 错误重试 / 新建按钮。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SessionListLayout, type SessionListEntry } from "../session-list-layout";

const items: SessionListEntry[] = [
  {
    id: "s1",
    title: "你好",
    statusBadge: "active",
    secondaryText: "Claude · 1 轮",
    lastActiveAt: "2026-07-11T22:00:00+08:00",
  },
  {
    id: "s2",
    title: null,
    statusBadge: "ended",
    secondaryText: "Codex · 2 轮",
    lastActiveAt: null,
  },
];

function renderLayout(overrides: Partial<React.ComponentProps<typeof SessionListLayout>> = {}) {
  const props: React.ComponentProps<typeof SessionListLayout> = {
    items,
    loading: false,
    error: null,
    selectedId: null,
    onSelect: vi.fn(),
    onNewSession: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  render(<SessionListLayout {...props} />);
  return props;
}

describe("SessionListLayout", () => {
  it("渲染 title；title 为空时回退 shortId", () => {
    renderLayout();
    expect(screen.getByText("你好")).toBeInTheDocument();
    // s2 title=null → shortId("s2") = "s2"（<12 字符原样）
    expect(screen.getByText("s2")).toBeInTheDocument();
  });

  it("选中项高亮（蓝色左边框）", () => {
    renderLayout({ selectedId: "s1" });
    const btn = screen.getByText("你好").closest("button");
    expect(btn?.className).toContain("border-blue-600");
  });

  it("点击列表项触发 onSelect(id)", () => {
    const onSelect = vi.fn();
    renderLayout({ onSelect });
    fireEvent.click(screen.getByText("你好"));
    expect(onSelect).toHaveBeenCalledWith("s1");
  });

  it("传入 onDelete 时渲染删除按钮并触发回调", () => {
    const onDelete = vi.fn();
    renderLayout({ onDelete });
    fireEvent.click(screen.getByLabelText("删除会话 s1"));
    expect(onDelete).toHaveBeenCalledWith("s1");
  });

  it("未传 onDelete 时不渲染删除按钮", () => {
    renderLayout();
    expect(screen.queryByLabelText(/删除会话/)).not.toBeInTheDocument();
  });

  it("无项目时显示空态", () => {
    renderLayout({ items: [] });
    expect(screen.getByText("暂无会话，新建一个开始提问")).toBeInTheDocument();
  });

  it("loading 时显示加载中", () => {
    renderLayout({ items: [], loading: true });
    expect(screen.getByText("加载中…")).toBeInTheDocument();
  });

  it("error 时显示错误文案 + 重试回调", () => {
    const onRetry = vi.fn();
    renderLayout({ items: [], error: "加载失败", onRetry });
    expect(screen.getByText("加载失败")).toBeInTheDocument();
    fireEvent.click(screen.getByText("重试"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("点击新建按钮触发 onNewSession", () => {
    const onNewSession = vi.fn();
    renderLayout({ onNewSession });
    fireEvent.click(screen.getByText("新建会话"));
    expect(onNewSession).toHaveBeenCalled();
  });
});
