/**
 * ql-20260827-020：SessionInputBar ＋ 功能菜单测试。
 *
 * 覆盖：菜单开合（按钮翻转 / 外点 / Esc）、四入口动作（附件走 file input、
 * 派团队回调与禁用门控、选择技能 / 关联变更插入触发字符并驱动联想浮层、
 * 词中插入自动补空格保词首）、入口禁用态（attachmentsDisabled / 无工作区）与
 * 派团队入口按 onTeamTrigger 缺省隐藏。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { SessionInputBar } from "@/components/daemon/session-input-bar";
import { useMentionSources } from "@/lib/session-mention-sources";

// 数据源隔离（对齐 session-input-bar-mention.test.tsx 先例）：菜单驱动插入会
// 挂载联想数据桥（真实 hook 走 react-query）——mock 掉，浮层渲染空态即可断言。
vi.mock("@/lib/session-mention-sources", () => ({
  useMentionSources: vi.fn(() => ({
    skills: [],
    changes: [],
    quicklogs: [],
    atEnabled: true,
  })),
}));
vi.mocked(useMentionSources);

function Harness(props: Partial<Parameters<typeof SessionInputBar>[0]> = {}) {
  const [value, setValue] = useState("");
  return (
    <SessionInputBar
      value={value}
      onChange={setValue}
      onSend={vi.fn()}
      disabled={false}
      placeholder="测试输入"
      creating={false}
      workspaceId="ws-1"
      {...props}
    />
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "更多功能" }));
}

describe("SessionInputBar ＋ 功能菜单（ql-20260827-020）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("点击 ＋ 打开菜单（附件/派团队/选择技能/关联变更四入口），再点 ＋ 关闭", () => {
    render(<Harness onTeamTrigger={vi.fn()} />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    openMenu();
    expect(screen.getByRole("menu", { name: "输入功能" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /附件/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /派团队/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /选择技能/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /关联变更 \/ 快速修复/ })).toBeInTheDocument();
    // 再点 ＋（在菜单 ref 内，外点判定不双翻）→ 收起。
    openMenu();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("onTeamTrigger 缺省 → 菜单不含派团队入口（宿主未接团队能力）", () => {
    render(<Harness />);
    openMenu();
    expect(screen.queryByRole("menuitem", { name: /派团队/ })).not.toBeInTheDocument();
  });

  /* ── 2026-10-22-session-composer-slim FR-02：续跑开关迁入 + 菜单 ───────── */

  it("autoResume 传入 → 菜单渲染勾选项；点击切换并保持菜单打开", async () => {
    const onToggle = vi.fn();
    render(<Harness autoResume={{ enabled: true, onToggle }} />);
    openMenu();
    const item = screen.getByRole("menuitemcheckbox", {
      name: /中断自动续跑（已开启）/,
    });
    expect(item).toHaveAttribute("aria-checked", "true");
    fireEvent.click(item);
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith(false));
    // 切换不关菜单（可连续观察状态）。
    expect(screen.getByRole("menu", { name: "输入功能" })).toBeInTheDocument();
  });

  it("autoResume 缺省 → 菜单不渲染续跑项（预会话/dialog 无会话级状态）", () => {
    render(<Harness />);
    openMenu();
    expect(
      screen.queryByRole("menuitemcheckbox", { name: /中断自动续跑/ }),
    ).not.toBeInTheDocument();
  });

  it("autoResume.disabled（会话结束/离线）→ 禁用且点击不触发", () => {
    const onToggle = vi.fn();
    render(
      <Harness autoResume={{ enabled: true, disabled: true, onToggle }} />,
    );
    openMenu();
    const item = screen.getByRole("menuitemcheckbox", { name: /中断自动续跑/ });
    expect(item).toBeDisabled();
    fireEvent.click(item);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("附件项 → 触发隐藏 file input 点击并关菜单", () => {
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    render(<Harness />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /附件/ }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("attachmentsDisabled → 附件项禁用 + title 承载禁用原因", () => {
    render(
      <Harness
        attachmentsDisabled
        attachmentsDisabledTitle="当前引擎不支持附件"
      />,
    );
    openMenu();
    const item = screen.getByRole("menuitem", { name: /附件/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.title).toBe("当前引擎不支持附件");
  });

  it("派团队项 → 调 onTeamTrigger 并关菜单；禁用态不调 + title 承载原因", () => {
    const onTeamTrigger = vi.fn();
    const { rerender } = render(
      <Harness onTeamTrigger={onTeamTrigger} teamTriggerDisabled={false} />,
    );
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /派团队/ }));
    expect(onTeamTrigger).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    rerender(
      <Harness onTeamTrigger={onTeamTrigger} teamTriggerDisabled teamTriggerTitle="团队需要 Claude 引擎" />,
    );
    openMenu();
    const item = screen.getByRole("menuitem", { name: /派团队/ }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.title).toBe("团队需要 Claude 引擎");
    fireEvent.click(item);
    expect(onTeamTrigger).toHaveBeenCalledTimes(1);
  });

  it("选择技能 → 插入 / 开联想浮层；关联变更 → 插入 @（word-start 补空格）", async () => {
    render(<Harness workspaceId="ws-1" />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /选择技能/ }));
    // 空输入：直接插入触发字符，浮层（listbox）随之打开。
    const textarea = screen.getByPlaceholderText("测试输入") as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe("/"));
    expect(screen.getByTestId("session-mention-popover")).toBeInTheDocument();

    // 光标在词中（value="你好"，光标置尾）→ 插入 @ 前自动补空格保证词首。
    fireEvent.change(textarea, { target: { value: "你好" } });
    textarea.setSelectionRange(2, 2);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /关联变更 \/ 快速修复/ }));
    await waitFor(() => expect(textarea.value).toBe("你好 @"));
    expect(screen.getByTestId("session-mention-popover")).toBeInTheDocument();
  });

  it("无工作区（workspaceId 空）→ 关联变更项禁用 + title 提示", () => {
    render(<Harness workspaceId={null} />);
    openMenu();
    const item = screen.getByRole("menuitem", {
      name: /关联变更 \/ 快速修复/,
    }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);
    expect(item.title).toContain("绑定工作区");
  });

  it("外点 / Esc 关闭菜单", () => {
    render(<Harness />);
    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
