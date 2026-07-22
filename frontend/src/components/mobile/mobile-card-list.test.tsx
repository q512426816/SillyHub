/**
 * task-07 · 通用移动组件库单测（design §5.5 / §7 / D-007 / D-008）。
 *
 * 覆盖 MobileCardList 核心契约：
 *  - 渲染 items 每条卡片（renderCard 输出可见）；
 *  - 空态文案；
 *  - actions：点击「⋯」→ 底部 MobileActionMenu 打开 → 点击动作触发 onPress → 自动关闭；
 *  - selectable：点击选择框 → onSelectedKeysChange 增/减 key；
 *  - pagination：上一页 / 下一页 → onChange(page ∓ 1)，首页禁用上一页、末页禁用下一页；
 *  - headerActions 渲染；
 *  - MobileBatchBar：selectedCount 显示「已选 N 项」。
 *
 * jsdom 注意：antd Drawer 经 portal 渲染到 document.body，screen 全局查询可见；
 * 动作标签用 findByText（异步）等待 open 后的 DOM。
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  MobileCardList,
  type MobileAction,
} from "@/components/mobile/mobile-card-list";
import { MobileBatchBar } from "@/components/mobile/mobile-batch-bar";

interface Row {
  id: string;
  name: string;
}

function makeRows(): Row[] {
  return [
    { id: "r1", name: "需求分析" },
    { id: "r2", name: "接口联调" },
    { id: "r3", name: "上线验收" },
  ];
}

describe("MobileCardList 渲染", () => {
  it("渲染 items 每条卡片（renderCard 输出可见）", () => {
    render(
      <MobileCardList<Row>
        items={makeRows()}
        renderCard={(r) => <div>{r.name}</div>}
      />,
    );
    expect(screen.getByText("需求分析")).toBeInTheDocument();
    expect(screen.getByText("接口联调")).toBeInTheDocument();
    expect(screen.getByText("上线验收")).toBeInTheDocument();
    // 3 个卡片项锚点
    expect(screen.getAllByTestId("mobile-card-item")).toHaveLength(3);
  });

  it("items 为空 → 渲染空态文案", () => {
    render(
      <MobileCardList<Row>
        items={[]}
        renderCard={(r) => <div>{r.name}</div>}
        emptyText="暂无任务"
      />,
    );
    expect(screen.getByText("暂无任务")).toBeInTheDocument();
    expect(screen.queryAllByTestId("mobile-card-item")).toHaveLength(0);
  });
});

describe("MobileCardList actions → MobileActionMenu", () => {
  it("点击「⋯」→ ActionSheet 打开 → 点击动作触发 onPress 并关闭", async () => {
    const onEdit = vi.fn();
    const actionsFor = (_r: Row): MobileAction[] => [
      { key: "edit", label: "编辑", onPress: onEdit },
      { key: "exec", label: "执行", onPress: vi.fn() },
    ];

    render(
      <MobileCardList<Row>
        items={makeRows()}
        renderCard={(r) => <div>{r.name}</div>}
        actions={actionsFor}
      />,
    );

    // 初始关闭：动作文案不在文档
    expect(screen.queryByText("编辑")).not.toBeInTheDocument();

    // 点击第一条卡片的「⋯」
    fireEvent.click(screen.getByTestId("mobile-card-actions-r1"));

    // ActionSheet 打开，动作可见
    expect(await screen.findByText("编辑")).toBeInTheDocument();
    expect(screen.getByText("执行")).toBeInTheDocument();

    // 点击「编辑」→ onPress 触发
    fireEvent.click(screen.getByText("编辑"));
    expect(onEdit).toHaveBeenCalledTimes(1);

    // 自动关闭：动作文案消失（Drawer 收起）
    await waitFor(() => {
      expect(screen.queryByText("执行")).not.toBeInTheDocument();
    });
  });
});

describe("MobileCardList selectable", () => {
  it("点击选择框 → onSelectedKeysChange 增 key；再点 → 移除", () => {
    const onChange = vi.fn();
    let selected: string[] = [];
    // 受控：用渲染闭包模拟 selectedKeys 随回调变化（手动驱动）。
    const { rerender } = render(
      <MobileCardList<Row>
        items={makeRows()}
        renderCard={(r) => <div>{r.name}</div>}
        selectable
        selectedKeys={selected}
        onSelectedKeysChange={(keys) => {
          selected = keys;
          onChange(keys);
        }}
      />,
    );

    const box1 = screen.getByTestId("mobile-card-select-r1");
    expect(box1).toHaveAttribute("aria-checked", "false");

    // 选中 r1
    fireEvent.click(box1);
    expect(onChange).toHaveBeenLastCalledWith(["r1"]);

    // 用新 selected 重渲染，验证 aria-checked 反映受控态
    rerender(
      <MobileCardList<Row>
        items={makeRows()}
        renderCard={(r) => <div>{r.name}</div>}
        selectable
        selectedKeys={selected}
        onSelectedKeysChange={(keys) => {
          selected = keys;
          onChange(keys);
        }}
      />,
    );
    expect(screen.getByTestId("mobile-card-select-r1")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // 再次点击 → 移除 r1
    fireEvent.click(screen.getByTestId("mobile-card-select-r1"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("选中多条 → onSelectedKeysChange 累计多 key", () => {
    const onChange = vi.fn();
    let selected: string[] = [];
    const { rerender } = render(
      <MobileCardList<Row>
        items={makeRows()}
        renderCard={(r) => <div>{r.name}</div>}
        selectable
        selectedKeys={selected}
        onSelectedKeysChange={(keys) => {
          selected = keys;
          onChange(keys);
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("mobile-card-select-r1"));
    expect(onChange).toHaveBeenLastCalledWith(["r1"]);

    rerender(
      <MobileCardList<Row>
        items={makeRows()}
        renderCard={(r) => <div>{r.name}</div>}
        selectable
        selectedKeys={selected}
        onSelectedKeysChange={(keys) => {
          selected = keys;
          onChange(keys);
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("mobile-card-select-r2"));
    // 顺序无关，断言集合相等
    const last = onChange.mock.calls.at(-1)?.[0] as string[];
    expect([...last].sort()).toEqual(["r1", "r2"]);
  });
});

describe("MobileCardList pagination", () => {
  it("点击「下一页」→ onChange(page+1)；点击「上一页」→ onChange(page-1)", () => {
    const onChange = vi.fn();
    render(
      <MobileCardList<Row>
        items={makeRows()}
        renderCard={(r) => <div>{r.name}</div>}
        pagination={{ page: 2, pageSize: 10, total: 25, onChange }}
      />,
    );

    // 共 3 页（ceil(25/10)），page=2 → 上下页均可用
    expect(screen.getByTestId("mobile-card-list-page-info").textContent).toContain(
      "第 2/3 页（共 25 条）",
    );

    fireEvent.click(screen.getByTestId("mobile-card-list-next"));
    expect(onChange).toHaveBeenLastCalledWith(3);

    fireEvent.click(screen.getByTestId("mobile-card-list-prev"));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("首页禁用「上一页」；末页禁用「下一页」", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MobileCardList<Row>
        items={makeRows()}
        renderCard={(r) => <div>{r.name}</div>}
        pagination={{ page: 1, pageSize: 10, total: 25, onChange }}
      />,
    );
    expect(screen.getByTestId("mobile-card-list-prev")).toBeDisabled();
    expect(screen.getByTestId("mobile-card-list-next")).not.toBeDisabled();

    rerender(
      <MobileCardList<Row>
        items={makeRows()}
        renderCard={(r) => <div>{r.name}</div>}
        pagination={{ page: 3, pageSize: 10, total: 25, onChange }}
      />,
    );
    expect(screen.getByTestId("mobile-card-list-prev")).not.toBeDisabled();
    expect(screen.getByTestId("mobile-card-list-next")).toBeDisabled();
  });
});

describe("MobileCardList headerActions", () => {
  it("渲染 headerActions 节点", () => {
    render(
      <MobileCardList<Row>
        items={makeRows()}
        renderCard={(r) => <div>{r.name}</div>}
        headerActions={
          <button type="button" data-testid="header-create">
            新建
          </button>
        }
      />,
    );
    expect(screen.getByTestId("header-create")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-card-list-header")).toContainElement(
      screen.getByTestId("header-create"),
    );
  });
});

describe("MobileBatchBar 选中数显示", () => {
  it("selectedCount 渲染「已选 N 项」", () => {
    const { rerender } = render(<MobileBatchBar selectedCount={0} />);
    expect(screen.getByTestId("mobile-batch-bar-count").textContent).toContain(
      "已选 0 项",
    );

    rerender(<MobileBatchBar selectedCount={3} />);
    expect(screen.getByTestId("mobile-batch-bar-count").textContent).toContain(
      "已选 3 项",
    );
  });

  it("传 onDelete → 渲染删除按钮，点击触发", () => {
    const onDelete = vi.fn();
    render(
      <MobileBatchBar selectedCount={2} onDelete={onDelete} />,
    );
    const btn = screen.getByTestId("mobile-batch-bar-delete");
    fireEvent.click(btn);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("selectedCount=0 时删除按钮 disabled", () => {
    render(
      <MobileBatchBar selectedCount={0} onDelete={() => undefined} />,
    );
    expect(screen.getByTestId("mobile-batch-bar-delete")).toBeDisabled();
  });
});
