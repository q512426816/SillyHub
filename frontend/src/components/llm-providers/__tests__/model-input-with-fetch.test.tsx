/**
 * task-14：ModelInputWithFetch 组件单测（task-08 产物）。
 *
 * 覆盖三态分支（按优先级，design §6.1）：
 *   态1 fetchedModels 非空 → Input + 按 owned_by 分组的 DropdownMenu，
 *        点 DropdownMenuItem 触发 onChange(model.id)；null/空白 owned_by 归「其他」。
 *   态2 isLoading=true    → Input + Loader2 spinner（按钮 disabled）。
 *   态3 有 onFetch（无数据/非 loading）→ Input + 「获取模型列表」按钮，点击触发 onFetch。
 *   态4 无 onFetch 且无数据 → 纯 Input（无任何附加按钮）。
 *
 * Mock 说明：Radix DropdownMenuItem 的 onSelect 经 ReactDOM.flushSync + 自定义事件
 * `menu.itemSelect` 派发（react-menu MenuItem.handleSelect），在 jsdom 下不触发，无法
 * 用 fireEvent.click 稳定驱动到 onSelect。这里把 @/components/ui/dropdown-menu 替换为
 * 「内联渲染 + 点击直调 onSelect」的占位实现，隔离 Radix 内部 plumbing，聚焦被测组件契约：
 *   - 是否把 fetchedModels 按 owned_by 正确分组（DropdownMenuLabel/Item 的填充）；
 *   - DropdownMenuItem 的 onSelect 是否接到 onChange(model.id)；
 *   - 三态分支的按钮/输入渲染优先级。
 * Radix 自身的展开/portal/键盘行为不在本组件单测范围（由 Radix 负责）。
 *
 * 纯组件测，无 API/路由副作用。
 */
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// 占位 dropdown-menu：内联渲染 + 点击 menuitem 直调 onSelect，绕开 Radix jsdom 不兼容。
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="dd-content">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => (
    <div
      role="menuitem"
      onClick={() => {
        /* 对齐 Radix：点击 item 触发 select 回调 */
        onSelect?.();
      }}
    >
      {children}
    </div>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
    <div data-testid="dd-label">{children}</div>
  ),
  DropdownMenuSeparator: () => <hr data-testid="dd-sep" />,
}));

import { ModelInputWithFetch } from "@/components/llm-providers/model-input-with-fetch";

describe("ModelInputWithFetch — 态1 有 fetchedModels（下拉分组选择）", () => {
  it("渲染下拉触发钮「选择模型」；按 owned_by 分组（含「其他」兜底）", () => {
    render(
      <ModelInputWithFetch
        value=""
        onChange={vi.fn()}
        fetchedModels={[
          { id: "kimi-k2", owned_by: "moonshot" },
          { id: "claude-sonnet-5", owned_by: "anthropic" },
          { id: "claude-haiku-4-5", owned_by: "anthropic" },
          { id: "mystery-model", owned_by: null }, // null → 「其他」
          { id: "blank-vendor-model", owned_by: "   " }, // 空白 → 「其他」
        ]}
      />,
    );

    // 态1 独有：选择模型下拉触发钮（态2/态3 不会有此 aria-label）
    expect(screen.getByRole("button", { name: "选择模型" })).toBeInTheDocument();

    // 分组标题按 owned_by 出现；null/空白归「其他」
    const labels = screen.getAllByTestId("dd-label").map((el) => el.textContent);
    expect(labels).toEqual(expect.arrayContaining(["moonshot", "anthropic", "其他"]));
    // 同一 vendor 的多个模型应聚合到同一分组（anthropic 含 2 个模型）
    expect(labels.filter((l) => l === "anthropic")).toHaveLength(1);

    // 分组内的模型 id 作为 item 文本可见
    expect(screen.getByText("kimi-k2")).toBeInTheDocument();
    expect(screen.getByText("mystery-model")).toBeInTheDocument();
  });

  it("点 DropdownMenuItem → onSelect 触发 onChange(model.id)", () => {
    const onChange = vi.fn();
    render(
      <ModelInputWithFetch
        value=""
        onChange={onChange}
        fetchedModels={[
          { id: "kimi-k2", owned_by: "moonshot" },
          { id: "claude-sonnet-5", owned_by: "anthropic" },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("kimi-k2"));
    expect(onChange).toHaveBeenCalledWith("kimi-k2");

    fireEvent.click(screen.getByText("claude-sonnet-5"));
    expect(onChange).toHaveBeenCalledWith("claude-sonnet-5");
  });

  it("value/onChange 透传给内部 Input（可手输）", () => {
    const onChange = vi.fn();
    render(
      <ModelInputWithFetch
        value="preset"
        onChange={onChange}
        fetchedModels={[{ id: "kimi-k2", owned_by: "moonshot" }]}
        placeholder="手填"
      />,
    );
    const input = screen.getByPlaceholderText("手填") as HTMLInputElement;
    expect(input.value).toBe("preset");
    fireEvent.change(input, { target: { value: "manual" } });
    expect(onChange).toHaveBeenCalledWith("manual");
  });
});

describe("ModelInputWithFetch — 态2 isLoading（拉取中 spinner）", () => {
  it("渲染 disabled 的「正在获取模型列表」spinner 钮；不渲染选择钮/获取钮", () => {
    render(
      <ModelInputWithFetch
        value=""
        onChange={vi.fn()}
        isLoading
        onFetch={vi.fn()}
      />,
    );
    // 态2 独有 spinner 钮，disabled（优先级高于 onFetch）
    const spinner = screen.getByRole("button", { name: "正在获取模型列表" });
    expect(spinner).toBeDisabled();
    // 态1/态3 的按钮都不该出现
    expect(screen.queryByRole("button", { name: "选择模型" })).toBeNull();
    expect(screen.queryByRole("button", { name: "获取模型列表" })).toBeNull();
  });
});

describe("ModelInputWithFetch — 态3 有 onFetch（获取按钮）", () => {
  it("渲染「获取模型列表」按钮；点击触发 onFetch；不渲染选择钮/spinner", () => {
    const onFetch = vi.fn();
    render(
      <ModelInputWithFetch value="" onChange={vi.fn()} onFetch={onFetch} />,
    );
    const fetchBtn = screen.getByRole("button", { name: "获取模型列表" });
    expect(fetchBtn).not.toBeDisabled();
    fireEvent.click(fetchBtn);
    expect(onFetch).toHaveBeenCalledTimes(1);
    // 态1/态2 的按钮都不该出现
    expect(screen.queryByRole("button", { name: "选择模型" })).toBeNull();
    expect(screen.queryByRole("button", { name: "正在获取模型列表" })).toBeNull();
  });
});

describe("ModelInputWithFetch — 态4 无 onFetch 且无数据（纯 Input）", () => {
  it("退化为纯 Input；无任何附加按钮（无选择/获取/spinner 钮）", () => {
    render(
      <ModelInputWithFetch
        value=""
        onChange={vi.fn()}
        placeholder="手填模型名"
      />,
    );
    expect(screen.getByPlaceholderText("手填模型名")).toBeInTheDocument();
    // 不渲染任何按钮（纯 Input 分支）
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("纯 Input 仍能正常输入并触发 onChange", () => {
    const onChange = vi.fn();
    render(
      <ModelInputWithFetch
        value=""
        onChange={onChange}
        placeholder="手填模型名"
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("手填模型名"), {
      target: { value: "manual-model" },
    });
    expect(onChange).toHaveBeenCalledWith("manual-model");
  });
});
