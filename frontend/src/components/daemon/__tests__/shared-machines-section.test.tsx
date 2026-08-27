/**
 * 2026-08-28-daemon-agent-share task-09：SharedMachinesSection「共享给我的」区块单测。
 *
 * 覆盖（task-09 acceptance / FR-01 / FR-03，task-13 契约修复）：
 *   1. 渲染：区块标题 + 卡片（机器名 / 共享「共享」Tag / 在线·离线 Badge /
 *      共享人显示名 / 来源工作区名）；
 *   2. FR-03 红线：操作**仅「会话」**——别名/可写目录/升级/禁用/移除等修改类
 *      按钮一律不渲染（queryByRole 断言不存在）；
 *   3. 交互：在线卡（有在线 runtime）「会话」可点 → onOpenSession(machine)；
 *      离线卡禁用（不回调）；task-13：机器在线但无在线 runtime 同样禁用；
 *   4. 空数据：machines=[] → 整块不渲染（acceptance：无共享数据渲染与现状一致）。
 *
 * 纯展示组件（props 驱动，无网络/路由依赖），断言用 data-testid / role / 文本，
 * 避开样式细节（测试纪律同 machine-card.test）。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { SharedMachinesSection } from "../shared-machines-section";
import type { SharedMachineView } from "@/lib/daemon";

const ONLINE_MACHINE: SharedMachineView = {
  machine_id: "sm-1",
  display_name: "林工的笔记本",
  lender_display_name: "林工",
  source_workspace_id: "ws-1",
  online: true,
  // task-13：行携带 runtime 明细——在线机含在线 runtime（会话可用）。
  runtimes: [
    { runtime_id: "rt-1", provider: "claude", online: true },
    { runtime_id: "rt-2", provider: "codex", online: false },
  ],
};

const OFFLINE_MACHINE: SharedMachineView = {
  machine_id: "sm-2",
  display_name: "测试机-02",
  lender_display_name: "陈晨",
  source_workspace_id: "ws-1",
  online: false,
  runtimes: [{ runtime_id: "rt-3", provider: "claude", online: false }],
};

function makeProps() {
  return {
    machines: [ONLINE_MACHINE, OFFLINE_MACHINE],
    workspaceNames: new Map([["ws-1", "multi-agent-platform"]]),
    onOpenSession: vi.fn(),
  };
}

/** 修改类操作按钮文案全集（FR-03：仅所有者机器卡可渲染，共享卡一律不出现）。 */
const MUTATION_BUTTON_LABELS = ["别名", "可写目录", "升级", "禁用", "移除", "移出", "清理"];

describe("SharedMachinesSection（task-09 / FR-01 / FR-03）", () => {
  it("渲染共享卡：机器名 + 共享 Tag + 在线/离线 Badge + 共享人 + 来源工作区名", () => {
    render(<SharedMachinesSection {...makeProps()} />);

    // 区块标题 + 说明
    expect(screen.getByText("共享给我的")).toBeInTheDocument();
    // 两张卡各带「共享」Tag
    expect(screen.getAllByText("共享")).toHaveLength(2);
    // 机器名
    expect(screen.getByText("林工的笔记本")).toBeInTheDocument();
    expect(screen.getByText("测试机-02")).toBeInTheDocument();
    // 共享人显示名 + 来源工作区名（map 解析）
    expect(screen.getByText(/共享人：林工/)).toBeInTheDocument();
    expect(screen.getByText(/共享人：陈晨/)).toBeInTheDocument();
    expect(screen.getAllByText(/multi-agent-platform/).length).toBeGreaterThan(0);
    // 在线/离线 Badge 文本
    expect(screen.getByText("在线")).toBeInTheDocument();
    expect(screen.getByText("离线")).toBeInTheDocument();
  });

  it("FR-03：操作仅「会话」——修改类按钮（别名/可写目录/升级/禁用/移除等）不渲染", () => {
    render(<SharedMachinesSection {...makeProps()} />);
    const section = screen.getByTestId("shared-machines-section");

    // 仅「会话」按钮，每卡一个
    const sessionButtons = within(section).getAllByRole("button", { name: /会\s*话/ });
    expect(sessionButtons).toHaveLength(2);
    for (const label of MUTATION_BUTTON_LABELS) {
      expect(
        within(section).queryByRole("button", { name: new RegExp(label.split("").join("\s*")) }),
        `共享卡不应渲染「${label}」按钮`,
      ).toBeNull();
    }
  });

  it("在线卡「会话」可点 → onOpenSession(machine)；离线卡禁用不回调", () => {
    const props = makeProps();
    render(<SharedMachinesSection {...props} />);

    const onlineCard = screen.getByTestId("shared-machine-card-sm-1");
    const onlineBtn = within(onlineCard).getByRole("button", { name: /会\s*话/ });
    expect(onlineBtn).not.toBeDisabled();
    fireEvent.click(onlineBtn);
    expect(props.onOpenSession).toHaveBeenCalledTimes(1);
    expect(props.onOpenSession).toHaveBeenCalledWith(ONLINE_MACHINE);

    const offlineCard = screen.getByTestId("shared-machine-card-sm-2");
    const offlineBtn = within(offlineCard).getByRole("button", { name: /会\s*话/ });
    expect(offlineBtn).toBeDisabled();
    fireEvent.click(offlineBtn);
    expect(props.onOpenSession).toHaveBeenCalledTimes(1);
  });

  it("task-13：机器在线但无在线 runtime（全离线/空明细）→「会话」禁用不回调", () => {
    const onOpenSession = vi.fn();
    render(
      <SharedMachinesSection
        machines={[
          {
            machine_id: "sm-4",
            display_name: "无引擎机",
            lender_display_name: "林工",
            source_workspace_id: "ws-1",
            online: true,
            runtimes: [{ runtime_id: "rt-4", provider: "claude", online: false }],
          },
          {
            machine_id: "sm-5",
            display_name: "零明细机",
            lender_display_name: "林工",
            source_workspace_id: "ws-1",
            online: true,
            runtimes: [],
          },
        ]}
        onOpenSession={onOpenSession}
      />,
    );

    for (const id of ["sm-4", "sm-5"]) {
      const card = screen.getByTestId(`shared-machine-card-${id}`);
      const btn = within(card).getByRole("button", { name: /会\s*话/ });
      expect(btn).toBeDisabled();
      fireEvent.click(btn);
    }
    expect(onOpenSession).not.toHaveBeenCalled();
    // 提示文案区分「无在线引擎」与「机器离线」（两张卡同为无在线引擎文案）。
    expect(screen.getAllByTitle("该机器暂无在线引擎，不可发起会话")).toHaveLength(2);
  });

  it("空数据不渲染整块（acceptance：无共享数据页面与现状一致）", () => {
    const { container } = render(
      <SharedMachinesSection machines={[]} onOpenSession={vi.fn()} />,
    );
    expect(screen.queryByTestId("shared-machines-section")).toBeNull();
    expect(screen.queryByText("共享给我的")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("来源工作区 id 未命中 map / 字段缺省 → 回退「—」（契约五字段可空）", () => {
    render(
      <SharedMachinesSection
        machines={[
          {
            machine_id: "sm-3",
            display_name: "无名机",
            lender_display_name: null,
            source_workspace_id: null,
            online: true,
          },
        ]}
        workspaceNames={new Map()}
        onOpenSession={vi.fn()}
      />,
    );
    expect(screen.getByText(/共享人：—/)).toBeInTheDocument();
    expect(screen.getByText(/来自工作区：—/)).toBeInTheDocument();
  });
});
