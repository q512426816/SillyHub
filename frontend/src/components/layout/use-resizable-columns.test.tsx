/**
 * useResizableColumns 单测（task-03 / design §5-4）。
 *
 * 依据：
 *   - components/layout/use-resizable-columns.ts（task-01 实现）
 *   - components/layout/data-table.tsx（task-02 接入：columns 经 hook 包装透传 Table）
 *   - design §5-4 用例矩阵 / §5-1 3px 移动阈值 / §2-2 最小 60px / R-03 拖拽与排序冲突
 *
 * 覆盖（design §5-4 五用例）：
 *   1. number width 列渲染手柄（.sh-resize-handle 挂在 th 内）
 *   2. string width / 无 width 列不渲染手柄（D-502@v2）
 *   3. mouseDown + document mouseMove(+80px) + mouseUp → 列宽实时增大，
 *      onColumnsResize 收 dataIndex 键终值（D-503）
 *   4. 排序列手柄拖拽/点击不触发 Table onChange(sorter)（R-03；antd sorter
 *      走 th onClick 冒泡触发，手柄 click stopPropagation 拦截）
 *   5. 位移 2px（< 3px 阈值）不算拖拽：列宽不变、不触发回调
 *
 * 渲染策略：真实 DataTable（走 task-02 接入链路），不 mock antd Table——
 * 验证 hook 包装 + rc-table onHeaderCell / components.header.cell 全链路。
 *
 * 坐标注入说明：jsdom 的 MouseEvent 构造器不认 pageX（pageX 为原型只读
 * getter，由 clientX+scroll 派生，直接赋值在 strict mode 下也不生效），
 * 沿用 knowledge-page.test.tsx 的 createEvent + Object.defineProperty 惯例，
 * 派发前显式补 clientX/pageX。
 *
 * 已知噪声：rc-table 挂载时 measureScrollbarSize 在 jsdom 下打
 * "Not implemented: window.getComputedStyle(elt, pseudoElt)"，不影响 DOM
 * 渲染与断言（与 antd Select/Portal 噪声同类，不 mock）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { DataTable } from "@/components/layout/data-table";

// ── 公共 fixture ──────────────────────────────────────────────────────────

interface DemoRow {
  key: string;
  name: string;
  note: string;
}

const DATA: DemoRow[] = [{ key: "row-1", name: "甲项目", note: "备注甲" }];

/** 取首个 colgroup col（rc-table 给有 width 列渲染 `<col style="width:Npx">`，与列序一致）。 */
function firstCol(container: HTMLElement): HTMLElement | null {
  return container.querySelector("colgroup col");
}

/** 取指定容器内的拖拽手柄（找不到即测试前提失效，直接抛错）。 */
function getHandle(container: HTMLElement): HTMLElement {
  const handle = container.querySelector<HTMLElement>(".sh-resize-handle");
  if (!handle) throw new Error("未找到 .sh-resize-handle");
  return handle;
}

/** jsdom MouseEvent 带不上坐标：createEvent 后用 defineProperty 显式补 clientX/pageX 再派发。 */
function fireMouse(
  el: Element | Document,
  name: "mouseDown" | "mouseMove" | "mouseUp",
  init: { button?: number; x: number },
) {
  const ev = createEvent[name](
    el as Element,
    init.button !== undefined ? { button: init.button } : {},
  );
  for (const key of ["clientX", "pageX"] as const) {
    Object.defineProperty(ev, key, { value: init.x });
  }
  fireEvent(el, ev);
}

afterEach(() => {
  cleanup();
  // hook 卸载 effect 会清拖拽类名，这里双保险防跨用例残留
  document.body.classList.remove("sh-col-resizing");
});

// ── 用例 1/2：手柄渲染 ────────────────────────────────────────────────────

describe("useResizableColumns 手柄渲染（D-502@v2：仅 number width 列可拖）", () => {
  it("number width 列在 th 内渲染拖拽手柄", () => {
    const { container } = render(
      <DataTable<DemoRow>
        columns={[{ title: "名称", dataIndex: "name", width: 120 }]}
        dataSource={DATA}
        rowKey="key"
      />,
    );
    const handle = container.querySelector(".sh-resize-handle");
    expect(handle).not.toBeNull();
    // 手柄是 th 的子元素（真子元素方案，design §5-1），且挂在对应列表头上
    const th = handle?.closest("th");
    expect(th).toBeTruthy();
    expect(th?.textContent).toContain("名称");
  });

  it("string width（width:\"20%\"）与无 width 列均不渲染手柄", () => {
    const { container } = render(
      <DataTable<DemoRow>
        columns={[
          { title: "名称", dataIndex: "name", width: "20%" },
          { title: "备注", dataIndex: "note" },
        ]}
        dataSource={DATA}
        rowKey="key"
      />,
    );
    expect(container.querySelector(".sh-resize-handle")).toBeNull();
  });
});

// ── 用例 3/5：拖拽交互 ────────────────────────────────────────────────────

describe("useResizableColumns 拖拽交互（design §5-1：3px 阈值 / mouseup 聚合回调）", () => {
  it("mouseDown + mouseMove 80px + mouseUp → 列宽增大且 onColumnsResize 收 dataIndex 键终值", () => {
    const onColumnsResize = vi.fn();
    const { container } = render(
      <DataTable<DemoRow>
        columns={[
          { title: "名称", dataIndex: "name", width: 120 },
          { title: "备注", dataIndex: "note" },
        ]}
        dataSource={DATA}
        rowKey="key"
        onColumnsResize={onColumnsResize}
      />,
    );
    // 拖前：首列 col 初始宽 120px
    expect(firstCol(container)?.style.width).toBe("120px");

    const handle = getHandle(container);
    fireMouse(handle, "mouseDown", { button: 0, x: 100 });
    fireMouse(document, "mouseMove", { x: 180 }); // +80px，超过 3px 阈值
    // 拖拽中：本地 widths state 驱动列宽实时更新（120 → 200）
    expect(firstCol(container)?.style.width).toBe("200px");
    // 拖拽激活期间 body 挂 sh-col-resizing（design §5-3 禁文本选中）
    expect(document.body.classList.contains("sh-col-resizing")).toBe(true);

    fireMouse(document, "mouseUp", { x: 180 });
    // mouseup 聚合回调：key = dataIndex 字符串（D-503），仅含可拖列
    expect(onColumnsResize).toHaveBeenCalledTimes(1);
    expect(onColumnsResize).toHaveBeenCalledWith({ name: 200 });
    // 收尾后移除拖拽类名
    expect(document.body.classList.contains("sh-col-resizing")).toBe(false);
  });

  it("位移 2px（< 3px 阈值）不算拖拽：列宽不变、不触发 onColumnsResize", () => {
    const onColumnsResize = vi.fn();
    const { container } = render(
      <DataTable<DemoRow>
        columns={[{ title: "名称", dataIndex: "name", width: 120 }]}
        dataSource={DATA}
        rowKey="key"
        onColumnsResize={onColumnsResize}
      />,
    );
    const handle = getHandle(container);
    fireMouse(handle, "mouseDown", { button: 0, x: 100 });
    fireMouse(document, "mouseMove", { x: 102 }); // 位移 2px < 阈值 3px
    fireMouse(document, "mouseUp", { x: 102 });

    expect(onColumnsResize).not.toHaveBeenCalled();
    expect(firstCol(container)?.style.width).toBe("120px");
    // 未激活拖拽：body 不挂拖拽类名
    expect(document.body.classList.contains("sh-col-resizing")).toBe(false);
  });
});

// ── 用例 4：排序冲突 ──────────────────────────────────────────────────────

describe("useResizableColumns 排序冲突（R-03：手柄交互不误触发表头排序）", () => {
  it("排序列手柄拖拽与点击均不触发 Table onChange(sorter)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <DataTable<DemoRow>
        columns={[
          { title: "名称", dataIndex: "name", width: 120, sorter: true },
        ]}
        dataSource={DATA}
        rowKey="key"
        onChange={onChange}
      />,
    );
    // 前置校验：点击 th 标题本身会触发排序 onChange（排除 spy 埋点失效导致假绿）
    fireEvent.click(screen.getByText("名称"));
    expect(onChange).toHaveBeenCalledTimes(1);

    const handle = getHandle(container);
    // 完整拖拽序列（antd sorter 在 th onClick 冒泡执行，手柄 mousedown/click 已拦截）
    fireMouse(handle, "mouseDown", { button: 0, x: 100 });
    fireMouse(document, "mouseMove", { x: 180 });
    fireMouse(document, "mouseUp", { x: 180 });
    // 手柄 click 不冒泡到 th（hook 内 stopPropagation）
    fireEvent.click(handle);

    expect(onChange).toHaveBeenCalledTimes(1); // 仅前置那次，手柄交互零新增
  });
});
