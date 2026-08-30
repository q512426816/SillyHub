/**
 * MessageQueueBar 单测（2026-08-21-session-message-queue task-09）。
 *
 * 依据：
 *   - changes/2026-08-21-session-message-queue/design.md §3.2（chips 栏行为：
 *     摘要 40 字截断 / 展开看全文 / 空队列 null）、D-002（满员 Tag「队列已满
 *     （N/max）」）、D-003（failed 重试+删除按钮，重试仅用户触发）、
 *     D-004（附件数展示）；
 *   - tasks/task-09.md acceptance：空队列 / pending / failed / sending 渲染 /
 *     按钮回调传正确 id / 满员 / 多条目；
 *   - .sillyspec/docs/frontend/scan/CONVENTIONS.md 代码风格第 7 条
 *     （Vitest jsdom + @testing-library/react，测试标题中文）。
 *
 * 说明：状态文案「等待中/发送中/发送失败」渲染在条目切换按钮的 aria-label
 * （非可见正文），按可访问名（getByRole name）断言；行为优先，不断言
 * destructive/brand 等颜色语义类。
 *
 * 2026-08-31-session-queue-ux task-10：新增「队列三操作」组（FR-04 拖拽换位 /
 * FR-05 ⚡ 立即发送 / FR-06 ✎ 重新编辑 / 可选门控）。jsdom 无原生 DnD 与布局——
 * dragStart/dragOver/drop 携带 dataTransfer 纯对象 mock（D-006 零新依赖），
 * 目标 chip 的 getBoundingClientRect 打元素级 spy（left=0/width=100），以
 * clientX 25/75 分别落入前/后半区驱动中线判定，断言选稳定行为面（全量有序
 * ids 上抛 / 高亮 ring-1 出现与复位），不脆断言品牌色值。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

import { MessageQueueBar } from "@/components/daemon/message-queue-bar";
import type { QueueEntry } from "@/hooks/use-message-queue";

function makeEntry(overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id: "mq-1",
    prompt: "排队消息",
    attachmentIds: [],
    displayPrompt: "排队消息",
    status: "pending",
    createdAt: 1755700000000,
    ...overrides,
  };
}

describe("MessageQueueBar（task-09 / D-002 D-003 D-004）", () => {
  afterEach(() => {
    cleanup();
  });

  it("空队列不渲染任何内容", () => {
    const { container } = render(
      <MessageQueueBar entries={[]} onRemove={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/排队消息（/)).toBeNull();
  });

  it("pending 条目：状态文案「等待中」+ 删除按钮，无重试按钮", () => {
    render(
      <MessageQueueBar
        entries={[makeEntry()]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    // 状态文案在条目按钮的可访问名中（组件实现：aria-label=「等待中，展开…」）
    expect(screen.getByRole("button", { name: /^等待中，/ })).toBeTruthy();
    expect(screen.getByText("排队消息")).toBeTruthy();
    expect(screen.getByText("排队消息（1）")).toBeTruthy();
    expect(screen.getByLabelText("从队列移除该消息")).toBeTruthy();
    expect(screen.queryByLabelText("重试发送该消息")).toBeNull();
  });

  it("failed 条目：重试+删除按钮在位，展开后显示完整失败原因（D-003）", () => {
    render(
      <MessageQueueBar
        entries={[
          makeEntry({
            id: "mq-f",
            prompt: "失败消息",
            status: "failed",
            errorMsg: "inject 500",
          }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /^发送失败，/ })).toBeTruthy();
    expect(screen.getByLabelText("重试发送该消息")).toBeTruthy();
    expect(screen.getByLabelText("从队列移除该消息")).toBeTruthy();

    // 点击条目展开：errorMsg 完整展示
    fireEvent.click(screen.getByRole("button", { name: /^发送失败，/ }));
    expect(screen.getByText("发送失败：inject 500")).toBeTruthy();
  });

  it("sending 条目：投递中无重试/删除按钮", () => {
    render(
      <MessageQueueBar
        entries={[makeEntry({ status: "sending" })]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /^发送中，/ })).toBeTruthy();
    expect(screen.queryByLabelText("从队列移除该消息")).toBeNull();
    expect(screen.queryByLabelText("重试发送该消息")).toBeNull();
  });

  it("点击删除/重试按钮：回调收到对应条目的正确 id", () => {
    const onRemove = vi.fn();
    const onRetry = vi.fn();
    render(
      <MessageQueueBar
        entries={[
          makeEntry({ id: "mq-a", prompt: "甲消息", status: "failed", errorMsg: "e1" }),
          makeEntry({ id: "mq-b", prompt: "乙消息", status: "failed", errorMsg: "e2" }),
        ]}
        onRemove={onRemove}
        onRetry={onRetry}
      />,
    );

    const retryButtons = screen.getAllByLabelText("重试发送该消息");
    const removeButtons = screen.getAllByLabelText("从队列移除该消息");
    fireEvent.click(retryButtons[0]!);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith("mq-a");

    fireEvent.click(removeButtons[1]!);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith("mq-b");
  });

  it("满员提示（D-002）：默认 max=5，5 条时显示「队列已满（5/5）」", () => {
    const five = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ id: `mq-${i}`, prompt: `满员消息${i}` }),
    );
    render(
      <MessageQueueBar entries={five} onRemove={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(screen.getByText("队列已满（5/5）")).toBeTruthy();
  });

  it("满员提示：自定义 max=3 时按「N/3」展示", () => {
    const three = Array.from({ length: 3 }, (_, i) =>
      makeEntry({ id: `mq-${i}`, prompt: `自定义消息${i}` }),
    );
    render(
      <MessageQueueBar
        entries={three}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        max={3}
      />,
    );
    expect(screen.getByText("队列已满（3/3）")).toBeTruthy();
  });

  it("未满时不显示满员提示", () => {
    render(
      <MessageQueueBar
        entries={[makeEntry({ id: "mq-1" }), makeEntry({ id: "mq-2", prompt: "第二条" })]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByText(/队列已满/)).toBeNull();
  });

  it("多条目同时展示：各条摘要与计数标签可见", () => {
    render(
      <MessageQueueBar
        entries={[
          makeEntry({ id: "mq-1", prompt: "第一条" }),
          makeEntry({ id: "mq-2", prompt: "第二条", status: "sending" }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("第一条")).toBeTruthy();
    expect(screen.getByText("第二条")).toBeTruthy();
    expect(screen.getByText("排队消息（2）")).toBeTruthy();
  });

  it("点击条目展开：长文本摘要截断，展开显示完整 displayPrompt（含附件标记行）", () => {
    const head = "前".repeat(40);
    const tailMark = "尾部唯一标记XYZ";
    const longPrompt = `${head}${tailMark}`;
    const { container } = render(
      <MessageQueueBar
        entries={[
          makeEntry({
            id: "mq-long",
            prompt: longPrompt,
            displayPrompt: `${longPrompt}\n📎 2 个附件`,
            attachmentIds: ["a", "b"],
          }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    // 折叠态：40 字摘要 + 省略号，完整尾部与附件标记行不可见
    expect(container.textContent).toContain("…");
    expect(container.textContent).not.toContain(tailMark);
    expect(container.textContent).not.toContain("📎 2 个附件");

    // 展开：displayPrompt 全文可见（含附件标记行）
    fireEvent.click(screen.getByRole("button", { name: /^等待中，/ }));
    expect(container.textContent).toContain(tailMark);
    expect(container.textContent).toContain("📎 2 个附件");

    // 再点收起：回到截断摘要
    fireEvent.click(screen.getByRole("button", { name: /^等待中，收起/ }));
    expect(container.textContent).not.toContain(tailMark);
  });

  it("附件数显示（D-004）：有附件显示「📎 N」，无附件不显示", () => {
    render(
      <MessageQueueBar
        entries={[
          makeEntry({
            id: "mq-att",
            prompt: "带附件",
            attachmentIds: ["att-1", "att-2", "att-3"],
          }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("📎 3")).toBeTruthy();

    cleanup();
    render(
      <MessageQueueBar
        entries={[makeEntry({ id: "mq-plain", prompt: "无附件" })]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByText(/📎/)).toBeNull();
  });
});

/* ── 2026-08-31-session-queue-ux task-10：队列三操作（FR-04/05/06） ────────── */

/** dataTransfer 纯对象 mock（jsdom 无原生 DnD，D-006 不引 polyfill）。 */
function makeDataTransfer() {
  return {
    effectAllowed: "none" as string,
    dropEffect: "none" as string,
    setData: vi.fn(),
  };
}

/**
 * 携带 clientX 的 dragover：jsdom 无 DragEvent，testing-library 的
 * fireEvent.dragOver 会退化成裸 Event（MouseEventInit 的 clientX 被构造器
 * 丢弃恒为 0）——按 MouseEvent 构造再由 createEvent 注入 dataTransfer。
 */
function fireDragOver(el: HTMLElement, clientX: number, dataTransfer: unknown) {
  fireEvent(
    el,
    createEvent(
      "dragover",
      el,
      { clientX, bubbles: true, cancelable: true, dataTransfer },
      { EventType: "MouseEvent" },
    ),
  );
}

/** 取第 index 个 chip（⇅ 手柄最近的 draggable 祖先即 chip 容器）。 */
function getChip(index: number): HTMLElement {
  const handles = screen.getAllByTitle("拖拽排序");
  return handles[index]!.closest('[draggable="true"]') as HTMLElement;
}

/** 目标 chip 布局 mock：left=0/width=100 → clientX 25/75 分落前/后半区。 */
function mockChipRect(chip: HTMLElement) {
  return vi.spyOn(chip, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 100,
    bottom: 20,
    width: 100,
    height: 20,
    toJSON: () => ({}),
  } as DOMRect);
}

describe("MessageQueueBar 队列三操作（task-10 / FR-04 FR-05 FR-06）", () => {
  afterEach(() => {
    cleanup();
  });

  it("拖拽换位（FR-04）：目标后半区松手 → onReorder 收到全量有序 ids（D-003 禁部分上传），预览即时换位、高亮随 dragend 复位", () => {
    const onReorder = vi.fn();
    render(
      <MessageQueueBar
        entries={[
          makeEntry({ id: "mq-a", prompt: "甲消息" }),
          makeEntry({ id: "mq-b", prompt: "乙消息" }),
          makeEntry({ id: "mq-c", prompt: "丙消息" }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        onReorder={onReorder}
      />,
    );
    const chipA = getChip(0);
    const chipB = getChip(1);
    mockChipRect(chipB);

    const dt = makeDataTransfer();
    fireEvent.dragStart(chipA, { dataTransfer: dt });
    // clientX=75 落目标后半区 → mq-a 移到 mq-b 之后（本地序预览先换位）。
    fireDragOver(chipB, 75, dt);
    expect(getChip(1).textContent).toContain("甲消息");
    // 拖过期间目标条高亮（drop-target 态）。
    expect(chipB.className).toContain("ring-1");

    // drop 冒泡至 chips 行容器落定：全量 3 条按换位后顺序上抛。
    fireEvent.drop(chipB, { dataTransfer: dt });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(["mq-b", "mq-a", "mq-c"]);

    // dragend：高亮复位（态清理幂等，无残留）。
    fireEvent.dragEnd(chipA);
    expect(chipB.className).not.toContain("ring-1");
  });

  it("拖拽换位（FR-04）：目标前半区松手 → 被拖条插到目标之前", () => {
    const onReorder = vi.fn();
    render(
      <MessageQueueBar
        entries={[
          makeEntry({ id: "mq-a", prompt: "甲消息" }),
          makeEntry({ id: "mq-b", prompt: "乙消息" }),
          makeEntry({ id: "mq-c", prompt: "丙消息" }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        onReorder={onReorder}
      />,
    );
    const chipC = getChip(2);
    const chipB = getChip(1);
    mockChipRect(chipB);

    const dt = makeDataTransfer();
    fireEvent.dragStart(chipC, { dataTransfer: dt });
    // clientX=25 落目标前半区 → mq-c 插到 mq-b 之前。
    fireDragOver(chipB, 25, dt);
    fireEvent.drop(chipB, { dataTransfer: dt });
    expect(onReorder).toHaveBeenCalledTimes(1);
    expect(onReorder).toHaveBeenCalledWith(["mq-a", "mq-c", "mq-b"]);
  });

  it("拖拽原位松手（落定序与原序相同）/ 未经过有效 dragover 的 drop：不回调（D-003）", () => {
    const onReorder = vi.fn();
    const { container } = render(
      <MessageQueueBar
        entries={[
          makeEntry({ id: "mq-a", prompt: "甲消息" }),
          makeEntry({ id: "mq-b", prompt: "乙消息" }),
          makeEntry({ id: "mq-c", prompt: "丙消息" }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        onReorder={onReorder}
      />,
    );
    const chipA = getChip(0);
    const chipB = getChip(1);
    mockChipRect(chipB);

    // mq-a 拖到 mq-b 前半区：mq-a 本就在 mq-b 前 → 序不变 → 不回调。
    const dt = makeDataTransfer();
    fireEvent.dragStart(chipA, { dataTransfer: dt });
    fireDragOver(chipB, 25, dt);
    fireEvent.drop(chipB, { dataTransfer: dt });
    expect(onReorder).not.toHaveBeenCalled();
    fireEvent.dragEnd(chipA);

    // 仅 dragStart 未经过有效 dragover：本地序 override 未建立，drop 短路不回调。
    const dt2 = makeDataTransfer();
    fireEvent.dragStart(chipA, { dataTransfer: dt2 });
    fireEvent.drop(container.firstElementChild!.firstElementChild!, {
      dataTransfer: dt2,
    });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("⚡ 立即发送（FR-05）：pending 与 failed 均渲染（title 两态）且点击回调 onDispatchNow(id)；sending 不渲染", () => {
    const onDispatchNow = vi.fn();
    render(
      <MessageQueueBar
        entries={[
          makeEntry({ id: "mq-p", prompt: "等待消息" }),
          makeEntry({ id: "mq-f", prompt: "失败消息", status: "failed", errorMsg: "e" }),
          makeEntry({ id: "mq-s", prompt: "投递消息", status: "sending" }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        onDispatchNow={onDispatchNow}
      />,
    );

    // 两态 title 语义：pending=打断当前轮优先派发（D-001），failed=直接派发。
    fireEvent.click(screen.getByLabelText("打断当前轮，立即发送这条"));
    expect(onDispatchNow).toHaveBeenCalledTimes(1);
    expect(onDispatchNow).toHaveBeenCalledWith("mq-p");

    fireEvent.click(screen.getByLabelText("立即发送这条"));
    expect(onDispatchNow).toHaveBeenCalledTimes(2);
    expect(onDispatchNow).toHaveBeenCalledWith("mq-f");

    // sending 投递中不可操作：⚡ 仅 2 个（pending + failed），sending 条目没有。
    expect(screen.getAllByLabelText(/立即发送这条/)).toHaveLength(2);
  });

  it("✎ 重新编辑（FR-06）：textarea 预填原文；空白不可保存；取消不回调；保存回调 onEdit(id, 新文本)", () => {
    const onEdit = vi.fn();
    render(
      <MessageQueueBar
        entries={[makeEntry({ id: "mq-e", prompt: "原文内容" })]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        onEdit={onEdit}
      />,
    );

    // 打开浮层：textarea 初值 = entry.prompt。
    fireEvent.click(screen.getByLabelText("重新编辑该消息"));
    const textarea = screen.getByLabelText(
      "重新编辑排队消息文本",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("原文内容");

    // trim 非空门控：纯空白文本时保存按钮禁用（antd 对两字中文自动插空格，按可
    // 访问名正则匹配「保 存」）。
    fireEvent.change(textarea, { target: { value: "   " } });
    expect(
      (screen.getByRole("button", { name: /保\s*存/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    // 取消：丢弃草稿关浮层，不回调。
    fireEvent.change(textarea, { target: { value: "草稿内容" } });
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("重新编辑排队消息文本")).toBeNull();

    // 重开浮层改文本保存：回调带 id 与新文本，浮层关闭。
    fireEvent.click(screen.getByLabelText("重新编辑该消息"));
    fireEvent.change(screen.getByLabelText("重新编辑排队消息文本"), {
      target: { value: "改后内容" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith("mq-e", "改后内容");
    expect(screen.queryByLabelText("重新编辑排队消息文本")).toBeNull();
  });

  it("TASK_WAKEUP 系统通知条目不渲染 ✎（D-009）；failed 条目浮层说明含转等待中提示", () => {
    const onEdit = vi.fn();
    render(
      <MessageQueueBar
        entries={[
          makeEntry({ id: "mq-wake", prompt: "[后台任务通知] 后台任务已完成" }),
          makeEntry({
            id: "mq-fail",
            prompt: "失败消息",
            status: "failed",
            errorMsg: "e",
          }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
        onEdit={onEdit}
      />,
    );

    // 仅普通条目有 ✎；系统通知条目（后端 409 双保险的前端侧）不开放编辑。
    expect(screen.getAllByLabelText("重新编辑该消息")).toHaveLength(1);

    // 打开 failed 条目浮层：说明行含「保存后转为等待中并尝试派发」。
    fireEvent.click(screen.getByLabelText("重新编辑该消息"));
    expect(screen.getByText(/失败条目保存后转为等待中并尝试派发/)).toBeTruthy();
  });

  it("未传三回调（可选门控显式断言）：不渲染 ⇅ 手柄/⚡/✎，chip 不可拖", () => {
    const { container } = render(
      <MessageQueueBar
        entries={[
          makeEntry({ id: "mq-p", prompt: "等待消息" }),
          makeEntry({ id: "mq-f", prompt: "失败消息", status: "failed", errorMsg: "e" }),
        ]}
        onRemove={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByTitle("拖拽排序")).toBeNull();
    expect(screen.queryByLabelText(/立即发送这条/)).toBeNull();
    expect(screen.queryByLabelText("重新编辑该消息")).toBeNull();
    expect(container.querySelector('[draggable="true"]')).toBeNull();
  });
});
