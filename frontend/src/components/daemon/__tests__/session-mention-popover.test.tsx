// task-02（2026-08-26-session-input-mention / FR-01 / FR-02 / FR-04 / NFR-02 /
// D-002 / R-5）：输入胶囊联想浮层 SessionMentionPopover 单测（design §3.2 +
// 原型 prototype-session-input-mention.html .mention-pop）。
//
// 覆盖（对齐 task 卡 implementation + acceptance）：
//   1. / 分组渲染——「平台指令」（内置 /team 置顶 + 行内「平台指令」标注）与
//      「技能」（name + description 单行截断）；
//   2. @ 分组渲染——「变更」（title 空回退 change_key 展示 + change_key 次行）
//      与「快速修复」（ql_id + title）；
//   3. 过滤 filterMentionItems——前缀优先于包含、大小写不敏感、空 query 全量
//      原序、description/title 作包含次级命中面；组件随 query 收窄渲染；
//   4. 空态与 404 引导——items=[]（数据源缺失 / manifest 404）触发发文案，
//      items 非空但过滤空 → 无匹配文案（含 query 回显）；
//   5. 无障碍（NFR-02）——容器 role=listbox、选项 role=option + aria-selected、
//      aria-activedescendant 跟随 activeIndex；activeIndex 越界不指向不存在项；
//   6. 键盘全路径——nextMentionIndex ↑↓ 循环；handleMentionKeyDown Enter/Tab
//      选中、Esc 关闭，命中即 preventDefault + stopPropagation（事件不外溢为
//      外层发送/换行）；Shift+Enter、Ctrl/Meta/Alt 修饰、空态 Enter/Tab 放行；
//   7. 鼠标选中——onMouseDown preventDefault（不偷输入框焦点）+ onSelect 抛
//      原始实体对象（Object.is 身份透传，不读 invoke_name——回填名归 task-03）；
//   8. R-5 叠层互斥——浮层壳 absolute bottom-full z-30 与 TeamTriggerPopover
//      同锚区同层族（不越层压弹窗）；Esc 关闭不外溢到外层（弹层 Esc 不串扰）。
//
// 测试纪律：FIRST / AAA；组件纯受控零网络（数据经 props 注入，hook 组装归
// task-04，接入归 task-03），无网络层可 mock；键盘经 handleMentionKeyDown
// （task-03 将在 textarea onKeyDown 首位接线的同一入口）在 DOM harness 上驱动。

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  createEvent,
  within,
} from "@testing-library/react";

import {
  SessionMentionPopover,
  TEAM_MENTION_COMMAND,
  buildSlashMentionItems,
  buildAtMentionItems,
  filterMentionItems,
  nextMentionIndex,
  handleMentionKeyDown,
  type SessionMentionItem,
} from "../session-mention-popover";
import type { PlatformSkillSummary } from "@/lib/custom-skills";
import type { ChangeSummary } from "@/lib/changes";
import type { QuicklogEntryListItem } from "@/lib/quicklog";

/* ───────── fixture（形态对齐真实数据源：manifest skills / ChangeSummary / QuicklogEntryListItem） ───────── */

function skill(name: string, description: string): PlatformSkillSummary {
  return { name, description, file_count: 2 };
}

function change(change_key: string, title: string | null): ChangeSummary {
  return {
    id: `id-${change_key}`,
    change_key,
    title,
    status: "active",
    location: "worktree",
    change_type: null,
    affected_components: [],
    owner_id: null,
    updated_at: "2026-08-26T00:00:00Z",
  };
}

function quick(ql_id: string, title: string): QuicklogEntryListItem {
  return {
    ql_id,
    title,
    status: "completed",
    placeholder: false,
    author_raw: "qinyi",
    linked_changes: [],
    files: [],
    affected_modules: [],
    source: "file",
  };
}

const SKILLS = [
  skill("sillyspec-verify", "验证代码实现是否符合 design 和模块文档"),
  skill("deploy-to-server", "本地打包镜像→远程服务器（阿里云）部署"),
  skill("sillyspec-commit", "智能提交——自动收集变更信息，生成 commit message"),
  skill("banner-design", "Design banners for social media, ads, website heroes…"),
];

const CHANGES = [
  change("2026-08-26-session-input-mention", "会话输入框智能联想"),
  change("2026-08-25-session-spec-binding", null), // title 空 → change_key 兜底展示
];

const QUICKS = [
  quick("ql-20260826-013", "/team 指令发送前剥离防 Unknown command"),
  quick("ql-20260826-010", "会话页 4 项 UX 修复"),
];

/** / 联想候选（task-03 组装口径：内置 /team 置顶 + 技能）。 */
const SLASH_ITEMS = buildSlashMentionItems(SKILLS);

/** @ 联想候选（task-03 组装口径：变更 + 快速修复）。 */
const AT_ITEMS = buildAtMentionItems(CHANGES, QUICKS);

/* ───────── 渲染 harness ───────── */

const HANDLERS = {
  onSelect: vi.fn(),
  onClose: vi.fn(),
};

function setup(overrides: Record<string, unknown> = {}) {
  return render(
    <SessionMentionPopover
      trigger="/"
      query=""
      items={SLASH_ITEMS}
      activeIndex={0}
      onSelect={HANDLERS.onSelect}
      onClose={HANDLERS.onClose}
      {...overrides}
    />,
  );
}

/**
 * 键盘 harness：模拟 task-03 接线形态——textarea onKeyDown 首位调
 * handleMentionKeyDown，外层 div onKeyDown 充当「外层发送 / 弹层 Esc」观察哨
 *（不外溢断言的靶子）。
 */
function renderKeyHarness(count: number, activeIndex: number) {
  const outer = vi.fn();
  const handlers = { onMove: vi.fn(), onSelect: vi.fn(), onClose: vi.fn() };
  const result = { handled: null as boolean | null };
  render(
    <div onKeyDown={outer}>
      <input
        aria-label="输入框"
        onKeyDown={(e) => {
          result.handled = handleMentionKeyDown(e, {
            count,
            activeIndex,
            ...handlers,
          });
        }}
      />
    </div>,
  );
  return { outer, handlers, result, input: screen.getByLabelText("输入框") };
}

/** 触发一次 keyDown 并返回原生事件（断言 defaultPrevented）。 */
function pressKey(input: HTMLElement, key: string, init = {}) {
  const evt = createEvent.keyDown(input, { key, ...init });
  fireEvent(input, evt);
  return evt;
}

beforeEach(() => {
  HANDLERS.onSelect.mockClear();
  HANDLERS.onClose.mockClear();
});

/* ───────── 1. / 分组渲染 ───────── */

describe("SessionMentionPopover / 分组渲染", () => {
  it("分组标签：平台指令（内置 /team）+ 技能（平台 + 我的）", () => {
    setup();

    // 「平台指令」出现两处：分组标签 + /team 行内标注（design §3.2 / task 卡）。
    expect(screen.getAllByText("平台指令")).toHaveLength(2);
    expect(screen.getByText("技能（平台 + 我的）")).toBeInTheDocument();
    // 1 条内置指令 + 4 条技能。
    expect(screen.getAllByRole("option")).toHaveLength(5);
  });

  it("/team 置顶且带「平台指令」标注，说明文案单行截断", () => {
    setup();

    const first = screen.getAllByRole("option")[0]!;
    expect(within(first).getByText("/team")).toBeInTheDocument();
    expect(within(first).getByText("平台指令")).toBeInTheDocument();

    // 技能行：name 主行 + description 次行，次行 truncate（单行截断，design §3.2）。
    const second = screen.getAllByRole("option")[1]!;
    expect(within(second).getByText("sillyspec-verify")).toBeInTheDocument();
    const desc = Array.from(second.querySelectorAll("span")).find(
      (el) => el.textContent === "验证代码实现是否符合 design 和模块文档",
    );
    expect(desc).toBeDefined();
    expect(desc!.className).toContain("truncate");
  });
});

/* ───────── 2. @ 分组渲染 ───────── */

describe("SessionMentionPopover @ 分组渲染", () => {
  it("分组标签：变更（当前工作区）+ 快速修复（当前工作区）", () => {
    setup({ trigger: "@", items: AT_ITEMS });

    expect(screen.getByText("变更（当前工作区）")).toBeInTheDocument();
    expect(screen.getByText("快速修复（当前工作区）")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("变更 title 非空：主行 title + 次行 change_key", () => {
    setup({ trigger: "@", items: AT_ITEMS });

    const first = screen.getAllByRole("option")[0]!;
    expect(within(first).getByText("会话输入框智能联想")).toBeInTheDocument();
    expect(
      within(first).getByText("2026-08-26-session-input-mention"),
    ).toBeInTheDocument();
  });

  it("变更 title 空：change_key 兜底为主行（不重复展示次行）", () => {
    setup({ trigger: "@", items: AT_ITEMS });

    const second = screen.getAllByRole("option")[1]!;
    expect(
      within(second).getAllByText("2026-08-25-session-spec-binding"),
    ).toHaveLength(1);
  });

  it("快速修复：主行 ql_id + 次行 title", () => {
    setup({ trigger: "@", items: AT_ITEMS });

    const third = screen.getAllByRole("option")[2]!;
    expect(within(third).getByText("ql-20260826-013")).toBeInTheDocument();
    expect(
      within(third).getByText("/team 指令发送前剥离防 Unknown command"),
    ).toBeInTheDocument();
  });
});

/* ───────── 3. 过滤（前缀优先 / 包含次之 / 大小写不敏感） ───────── */

describe("filterMentionItems 过滤", () => {
  const ITEMS: SessionMentionItem[] = buildSlashMentionItems([
    skill("my-deploy-helper", "部署辅助"),
    skill("deploy-to-server", "本地打包镜像部署"),
  ]);

  it("前缀命中排在包含命中之前（稳定：同层保持原序）", () => {
    const out = filterMentionItems(ITEMS, "deploy");
    expect(out.map((i) => (i.entity as PlatformSkillSummary).name)).toEqual([
      "deploy-to-server", // name 前缀命中
      "my-deploy-helper", // 仅包含命中次之
    ]);
  });

  it("大小写不敏感（DEPLOY 同小写结果）", () => {
    const out = filterMentionItems(ITEMS, "DEPLOY");
    expect(out.map((i) => (i.entity as PlatformSkillSummary).name)).toEqual([
      "deploy-to-server",
      "my-deploy-helper",
    ]);
  });

  it("空 query：全量原序返回", () => {
    const out = filterMentionItems(ITEMS, "");
    expect(out).toHaveLength(3); // 内置 /team + 2 技能
    expect(out[0]!.kind).toBe("command");
  });

  it("description 作包含次级命中面", () => {
    const out = filterMentionItems(
      buildSlashMentionItems([skill("archive", "归档已验证完成的变更")]),
      "归档",
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("skill");
  });

  it("@ 条目：change_key 前缀 / title 包含均命中", () => {
    const items = buildAtMentionItems(
      [
        change("2026-08-26-session-input-mention", "会话输入框智能联想"),
        change("2026-08-25-unified-floating-session", "统一悬浮会话"),
      ],
      [quick("ql-20260826-013", "/team 指令发送前剥离")],
    );
    // change_key 前缀同时命中两条变更（同层原序）。
    expect(filterMentionItems(items, "2026-08-2")).toHaveLength(2);
    // title 包含命中（中文 title）。
    expect(filterMentionItems(items, "悬浮")).toHaveLength(1);
    // ql_id 前缀命中快速修复。
    expect(filterMentionItems(items, "ql-2026")).toHaveLength(1);
  });

  it("无命中返回空数组", () => {
    expect(filterMentionItems(ITEMS, "zzz不存在的查询")).toEqual([]);
  });
});

describe("SessionMentionPopover 随 query 过滤渲染", () => {
  it("query=sillyspec：仅剩 2 条 sillyspec 技能（/team 与其它技能被过滤）", () => {
    setup({ query: "sillyspec" });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(within(options[0]!).getByText("sillyspec-verify")).toBeInTheDocument();
    expect(within(options[1]!).getByText("sillyspec-commit")).toBeInTheDocument();
  });

  it("渲染序体现前缀优先：deploy 前缀项排在包含项之前", () => {
    setup({
      items: buildSlashMentionItems([
        skill("my-deploy-helper", "部署辅助"),
        skill("deploy-to-server", "本地打包镜像部署"),
      ]),
      query: "deploy",
    });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(within(options[0]!).getByText("deploy-to-server")).toBeInTheDocument();
  });
});

/* ───────── 4. 空态与 404 引导 ───────── */

describe("SessionMentionPopover 空态与 404 引导", () => {
  it("/ 数据源缺失（manifest 404 / 空）→ 引导文案指向「我的技能」", () => {
    setup({ items: [] });

    const guide = screen.getByTestId("mention-guide");
    expect(guide.textContent).toContain("我的技能");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("@ 数据源缺失 → 引导文案说明需挂工作区", () => {
    setup({ trigger: "@", items: [] });

    const guide = screen.getByTestId("mention-guide");
    expect(guide.textContent).toContain("工作区");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("数据在但无匹配 → 无匹配文案回显 query", () => {
    setup({ query: "zzz无匹配词" });

    const empty = screen.getByTestId("mention-empty");
    expect(empty.textContent).toContain("无匹配");
    expect(empty.textContent).toContain("zzz无匹配词");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

/* ───────── 5. 无障碍（NFR-02：listbox / option / aria-selected / aria-activedescendant） ───────── */

describe("SessionMentionPopover 无障碍", () => {
  it("容器 role=listbox；aria-activedescendant 跟随 activeIndex 高亮项", () => {
    setup({ activeIndex: 1 });

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      "mention-option-1",
    );

    const options = screen.getAllByRole("option");
    expect(options[0]!.getAttribute("aria-selected")).toBe("false");
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    // 高亮项 id 与 activedescendant 指向一致。
    expect(options[1]!.id).toBe("mention-option-1");
  });

  it("activeIndex 越界（过滤收窄后父层未同步）→ 不指向不存在项、无选中态", () => {
    setup({ query: "sillyspec", activeIndex: 9 });

    const listbox = screen.getByRole("listbox");
    expect(listbox.getAttribute("aria-activedescendant")).toBeNull();
    for (const opt of screen.getAllByRole("option")) {
      expect(opt.getAttribute("aria-selected")).toBe("false");
    }
  });
});

/* ───────── 6. 键盘全路径（↑↓ 循环 / Enter / Tab / Esc / 放行边界） ───────── */

describe("nextMentionIndex 循环移动", () => {
  it.each([
    [0, 1, 3, 1],
    [2, 1, 3, 0], // 末尾 ↓ 回绕到首
    [0, -1, 3, 2], // 首个 ↑ 回绕到末尾
    [1, -1, 3, 0],
  ] as const)("active=%s delta=%s count=%s → %s", (active, delta, count, want) => {
    expect(nextMentionIndex(active, delta, count)).toBe(want);
  });

  it("count=0 → 恒 0（空态不移动）", () => {
    expect(nextMentionIndex(5, 1, 0)).toBe(0);
    expect(nextMentionIndex(5, -1, 0)).toBe(0);
  });
});

describe("handleMentionKeyDown 键盘全路径", () => {
  it("↓：拦截 + 循环移动请求，不外溢外层", () => {
    const { outer, handlers, result, input } = renderKeyHarness(3, 0);
    const evt = pressKey(input, "ArrowDown");

    expect(result.handled).toBe(true);
    expect(evt.defaultPrevented).toBe(true);
    expect(handlers.onMove).toHaveBeenCalledWith(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("↑：末项回绕到首项（循环）", () => {
    const { handlers, input } = renderKeyHarness(3, 0);
    pressKey(input, "ArrowUp");

    expect(handlers.onMove).toHaveBeenCalledWith(2);
  });

  it("Enter：拦截 + 选中当前高亮项，不外溢外层（不触发发送）", () => {
    const { outer, handlers, result, input } = renderKeyHarness(3, 1);
    const evt = pressKey(input, "Enter");

    expect(result.handled).toBe(true);
    expect(evt.defaultPrevented).toBe(true);
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("Tab：同 Enter 选中", () => {
    const { handlers, result, input } = renderKeyHarness(3, 0);
    pressKey(input, "Tab");

    expect(result.handled).toBe(true);
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  });

  it("Esc：拦截 + 关闭，不外溢外层（弹层 Esc 不串扰）", () => {
    const { outer, handlers, result, input } = renderKeyHarness(3, 0);
    const evt = pressKey(input, "Escape");

    expect(result.handled).toBe(true);
    expect(evt.defaultPrevented).toBe(true);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("Shift+Enter：放行（换行语义归输入框），事件继续外溢", () => {
    const { outer, handlers, result, input } = renderKeyHarness(3, 0);
    const evt = pressKey(input, "Enter", { shiftKey: true });

    expect(result.handled).toBe(false);
    expect(evt.defaultPrevented).toBe(false);
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Enter", { ctrlKey: true }],
    ["Enter", { metaKey: true }],
    ["ArrowDown", { altKey: true }],
    ["Tab", { shiftKey: true }],
    ["a", {}],
  ] as const)("%s（修饰 %j）：放行不拦截", (key, init) => {
    const { outer, handlers, result, input } = renderKeyHarness(3, 0);
    pressKey(input, key, init);

    expect(result.handled).toBe(false);
    expect(handlers.onMove).not.toHaveBeenCalled();
    expect(handlers.onSelect).not.toHaveBeenCalled();
    expect(handlers.onClose).not.toHaveBeenCalled();
  });

  it("空态（count=0）：↑↓/Enter/Tab 放行（Enter 走发送），Esc 仍关闭", () => {
    const { outer, handlers, result, input } = renderKeyHarness(0, 0);

    pressKey(input, "ArrowDown");
    expect(result.handled).toBe(false);
    pressKey(input, "Enter");
    expect(result.handled).toBe(false);
    expect(outer).toHaveBeenCalledTimes(2);

    pressKey(input, "Escape");
    expect(result.handled).toBe(true);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});

/* ───────── 7. 鼠标选中（原始实体对象身份透传） ───────── */

describe("SessionMentionPopover 鼠标选中", () => {
  it("mousedown 选项 → onSelect 抛原始实体对象（Object.is 身份）", () => {
    setup({ activeIndex: 2 });

    fireEvent.mouseDown(screen.getByTestId("mention-option-2"));

    expect(HANDLERS.onSelect).toHaveBeenCalledTimes(1);
    // 原始实体对象透传（非拷贝/非包装）——task-03 由此计算回填名 invoke_name ?? name。
    expect(HANDLERS.onSelect.mock.calls[0]![0]).toBe(SLASH_ITEMS[2]!.entity);
  });

  it("mousedown preventDefault——不偷输入框焦点（blur 关层竞态）", () => {
    setup();

    const evt = createEvent.mouseDown(screen.getByTestId("mention-option-1"));
    fireEvent(screen.getByTestId("mention-option-1"), evt);

    expect(evt.defaultPrevented).toBe(true);
  });
});

/* ───────── 8. R-5 叠层互斥（同锚区 z-index 同层族 / Esc 不外溢） ───────── */

describe("SessionMentionPopover 叠层互斥（R-5）", () => {
  it("浮层壳 absolute bottom-full z-30——与 TeamTriggerPopover 同锚区同层族，不越层", () => {
    render(
      <div className="relative">
        {/* 模拟同锚区的附件降级提示条（文档流内普通元素，不与浮层抢层） */}
        <div className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
          当前供应商不支持图片直读：图片将以文件形式落盘。
        </div>
        <SessionMentionPopover
          trigger="/"
          query=""
          items={SLASH_ITEMS}
          activeIndex={0}
          onSelect={HANDLERS.onSelect}
          onClose={HANDLERS.onClose}
        />
      </div>,
    );

    const shell = screen.getByTestId("session-mention-popover");
    // TeamTriggerPopover 同款锚区与层级（absolute bottom-full left-0 z-30）。
    expect(shell.className).toContain("absolute");
    expect(shell.className).toContain("bottom-full");
    expect(shell.className).toContain("z-30");
    // 降级提示条同锚区共存渲染互不排斥（互斥开关归父层，浮层只保证不越层）。
    expect(
      screen.getByText(/当前供应商不支持图片直读/),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(5);
  });

  it("Esc 关闭只触达 onClose，不外溢到外层 keydown（team popover / 弹层 Esc 语义不串扰）", () => {
    const { handlers, input } = renderKeyHarness(3, 0);
    pressKey(input, "Escape");

    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it("内置 /team 常量：kind=command 且 name 固定 team（task-03 组装置顶项）", () => {
    expect(TEAM_MENTION_COMMAND).toEqual({
      kind: "command",
      name: "team",
      description: expect.stringContaining("派团队"),
    });
  });
});
