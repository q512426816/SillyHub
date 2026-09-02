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
  ALL_MEMBERS_MENTION,
  buildSlashMentionItems,
  buildAtMentionItems,
  buildMemberMentionItems,
  filterMentionItems,
  nextMentionIndex,
  handleMentionKeyDown,
  type SessionMentionItem,
} from "../session-mention-popover";
import { applyMentionPick, type MentionPpmItem } from "@/lib/session-mention";
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

/** task-06：PPM 任务/问题归一条目（MentionPpmItem 形态）。 */
function ppmTask(
  id: string,
  title: string,
  projectName: string | null,
): MentionPpmItem {
  return {
    kind: "plan_task",
    id,
    title,
    projectName,
    subtitle: null,
  };
}

function ppmProblem(
  id: string,
  title: string,
  projectName: string | null,
): MentionPpmItem {
  return {
    kind: "problem",
    id,
    title,
    projectName,
    subtitle: "登录模块 · bug",
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

/** task-06：PPM 任务/问题 fixture（分组渲染与开关用例）。 */
const PPM_TASKS = [
  ppmTask("pt-1", "排行榜接口性能优化", "SillyHub 平台"),
  ppmTask("pt-2", "工时填报导出列错位修复", null),
];
const PPM_PROBLEMS = [ppmProblem("pb-1", "看板拖拽后排序偶发丢失", "SillyHub 平台")];

/** / 联想候选（task-03 组装口径：内置 /team 置顶 + 技能）。 */
const SLASH_ITEMS = buildSlashMentionItems(SKILLS);

/** @ 联想候选（task-03 组装口径：变更 + 快速修复）。 */
const AT_ITEMS = buildAtMentionItems(CHANGES, QUICKS);

/** @ 联想候选（task-06 组装口径：变更 + 快速修复 + PPM 任务/问题）。 */
const AT_PPM_ITEMS = buildAtMentionItems(CHANGES, QUICKS, PPM_TASKS, PPM_PROBLEMS);

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

/* ───────── 9. task-06（2026-08-28-session-ppm-task-binding / FR-02 / D-002@v1）：
   PPM 任务/问题分组渲染 + 分组头「切全部/仅进行中」开关 ───────── */

describe("SessionMentionPopover PPM 分组（task-06 / FR-02）", () => {
  it("分组标签与排序：变更/快速修复之后追加「PPM 任务（进行中）」「PPM 问题（进行中）」", () => {
    setup({ trigger: "@", items: AT_PPM_ITEMS, onPpmScopeChange: vi.fn() });

    expect(screen.getByText("变更（当前工作区）")).toBeInTheDocument();
    expect(screen.getByText("快速修复（当前工作区）")).toBeInTheDocument();
    expect(screen.getByText("PPM 任务（进行中）")).toBeInTheDocument();
    expect(screen.getByText("PPM 问题（进行中）")).toBeInTheDocument();
    // 2 变更 + 2 快速修复 + 2 任务 + 1 问题。
    expect(screen.getAllByRole("option")).toHaveLength(7);
  });

  it("条目形态：主行标题 + 次行项目名标注 + 行内「任务/问题」标注", () => {
    setup({ trigger: "@", items: AT_PPM_ITEMS, onPpmScopeChange: vi.fn() });

    const options = screen.getAllByRole("option");
    const task = options[4]!; // 变更 2 + 快速修复 2 之后
    expect(within(task).getByText("排行榜接口性能优化")).toBeInTheDocument();
    expect(within(task).getByText("SillyHub 平台")).toBeInTheDocument(); // 项目名标注
    expect(within(task).getByText("任务")).toBeInTheDocument(); // 行内标注
    const problem = options[6]!;
    expect(within(problem).getByText("看板拖拽后排序偶发丢失")).toBeInTheDocument();
    expect(within(problem).getByText("问题")).toBeInTheDocument();
    // 项目名空的条目：次行不渲染（无空标注）。
    const taskNoProject = options[5]!;
    expect(within(taskNoProject).getByText("工时填报导出列错位修复")).toBeInTheDocument();
    expect(within(taskNoProject).queryByText("（空）")).toBeNull();
  });

  it("buildAtMentionItems 选中抛原始实体（Object.is 身份）；缺省 PPM 参不进候选", () => {
    setup({ trigger: "@", items: AT_PPM_ITEMS, activeIndex: 6, onPpmScopeChange: vi.fn() });
    fireEvent.mouseDown(screen.getByTestId("mention-option-6"));
    expect(HANDLERS.onSelect).toHaveBeenCalledTimes(1);
    expect(HANDLERS.onSelect.mock.calls[0]![0]).toBe(PPM_PROBLEMS[0]);

    // 旧三参调用（PPM 缺省空数组）零回归——候选只含变更 + 快速修复。
    expect(buildAtMentionItems(CHANGES, QUICKS)).toHaveLength(4);
  });

  it("过滤：标题前缀命中 + 项目名/说明作次级包含命中面", () => {
    // 标题前缀命中任务。
    expect(filterMentionItems(AT_PPM_ITEMS, "排行榜").map((i) => i.kind)).toEqual([
      "ppmTask",
    ]);
    // 项目名包含命中（次级命中面）。
    expect(filterMentionItems(AT_PPM_ITEMS, "SillyHub").map((i) => i.kind)).toEqual([
      "ppmTask",
      "ppmProblem",
    ]);
    // 说明（subtitle）包含命中问题。
    expect(filterMentionItems(AT_PPM_ITEMS, "登录模块").map((i) => i.kind)).toEqual([
      "ppmProblem",
    ]);
  });

  it("未传 onPpmScopeChange：PPM 分组只渲染标签（带状态后缀）不带开关", () => {
    setup({ trigger: "@", items: AT_PPM_ITEMS });

    expect(screen.getByText("PPM 任务（进行中）")).toBeInTheDocument();
    expect(screen.queryByTestId("mention-ppm-scope-ppmTask")).toBeNull();
    expect(screen.queryByTestId("mention-ppm-scope-ppmProblem")).toBeNull();
  });

  it("分组头开关：ongoing 显「切全部」，点击回调 all 且不选中不关层（纯受控）", () => {
    const onPpmScopeChange = vi.fn();
    setup({
      trigger: "@",
      items: AT_PPM_ITEMS,
      onPpmScopeChange,
    });

    const taskToggle = screen.getByTestId("mention-ppm-scope-ppmTask");
    expect(taskToggle).toBeInTheDocument();
    expect(taskToggle.textContent).toBe("切全部");
    // mousedown preventDefault——不偷输入框焦点（与选项行同规则）。
    const evt = createEvent.mouseDown(taskToggle);
    fireEvent(taskToggle, evt);
    expect(evt.defaultPrevented).toBe(true);
    // 点击只回调换 scope，不触发选中、浮层不关（浮层开合归检测层）。
    fireEvent.click(taskToggle);
    expect(onPpmScopeChange).toHaveBeenCalledWith("all");
    expect(HANDLERS.onSelect).not.toHaveBeenCalled();
    expect(HANDLERS.onClose).not.toHaveBeenCalled();
    // 两组共用同一开关状态（两个分组头各一个入口，点击任一等价）。
    fireEvent.click(screen.getByTestId("mention-ppm-scope-ppmProblem"));
    expect(onPpmScopeChange).toHaveBeenCalledTimes(2);
  });

  it("ppmScope=all：标签后缀「（全部）」+ 开关文案「仅进行中」，点击回 ongoing", () => {
    const onPpmScopeChange = vi.fn();
    setup({
      trigger: "@",
      items: AT_PPM_ITEMS,
      ppmScope: "all",
      onPpmScopeChange,
    });

    expect(screen.getByText("PPM 任务（全部）")).toBeInTheDocument();
    expect(screen.getByText("PPM 问题（全部）")).toBeInTheDocument();
    const toggle = screen.getByTestId("mention-ppm-scope-ppmTask");
    expect(toggle.textContent).toBe("仅进行中");
    fireEvent.click(toggle);
    expect(onPpmScopeChange).toHaveBeenCalledWith("ongoing");
  });
});

/* ───────── 10. task-09（2026-09-01-session-group-chat / FR-15）：member 群成员
   @ 补全（buildMemberMentionItems / 过滤 / 分组 / 回填纯文本 / 键盘复用） ───────── */

describe("SessionMentionPopover 群成员（task-09 / FR-15）", () => {
  function groupMember(
    overrides: Partial<
      import("@/lib/daemon").GroupMemberRead
    > = {},
  ): import("@/lib/daemon").GroupMemberRead {
    return {
      id: "mem-x",
      member_type: "user",
      display_name: "某成员",
      user_id: "u-x",
      joined_at: "2026-09-01T00:00:00Z",
      shadow_status: "none",
      team_enabled: false,
      ...overrides,
    };
  }

  const MEMBER_ENTITIES = [
    groupMember({
      id: "mem-1",
      member_type: "agent",
      display_name: "小码",
      runtime_id: "rt-1",
      provider: "claude",
    }),
    groupMember({
      id: "mem-2",
      member_type: "agent",
      display_name: "小测",
      runtime_id: "rt-2",
      provider: "codex",
    }),
    groupMember({
      id: "mem-3",
      member_type: "user",
      display_name: "林一",
      user_id: "u-lin",
    }),
    // 已移除成员：不进候选。
    groupMember({
      id: "mem-4",
      member_type: "user",
      display_name: "已退出",
      user_id: "u-gone",
      removed_at: "2026-09-01T01:00:00Z",
    }),
  ];
  const MEMBER_ITEMS = buildMemberMentionItems(MEMBER_ENTITIES);
  /** member 候选昵称取值（ narrowing：本块候选全部为 member kind）。 */
  const memberName = (i: SessionMentionItem): string =>
    (i.entity as import("../session-mention-popover").SessionMemberMentionEntity)
      .displayName;

  it("buildMemberMentionItems：「@全体」置顶 + Agent 在前 / 用户在后；removed 过滤", () => {
    expect(MEMBER_ITEMS).toHaveLength(4); // 全体 + 2 agent + 1 user（已退出滤除）
    expect(MEMBER_ITEMS.map(memberName)).toEqual([
      "全体",
      "小码",
      "小测",
      "林一",
    ]);
    // @全体 常量条目形态（memberKind='all'，无成员实体）。
    expect(ALL_MEMBERS_MENTION).toEqual({
      displayName: "全体",
      memberKind: "all",
      memberId: "",
    });
    expect(MEMBER_ITEMS[0]!.entity).toBe(ALL_MEMBERS_MENTION);
  });

  it("分组渲染：单「群成员」分组标签 + 行内 Agent/用户/广播标注", () => {
    setup({ trigger: "@", items: MEMBER_ITEMS });

    expect(screen.getByText("群成员")).toBeInTheDocument();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(4);
    // @全体：主行昵称 + 广播说明次行 + 「广播」行内标注。
    expect(within(options[0]!).getByText("全体")).toBeInTheDocument();
    expect(
      within(options[0]!).getByText("@全体 通知所有 Agent 成员"),
    ).toBeInTheDocument();
    expect(within(options[0]!).getByText("广播")).toBeInTheDocument();
    // Agent 成员：Agent 标注；用户成员：用户标注。
    expect(within(options[1]!).getByText("小码")).toBeInTheDocument();
    expect(within(options[1]!).getByText("Agent")).toBeInTheDocument();
    expect(within(options[3]!).getByText("林一")).toBeInTheDocument();
    expect(within(options[3]!).getByText("用户")).toBeInTheDocument();
  });

  it("过滤：昵称前缀命中 + 「全体」命中 + 类别标签次级包含（大小写不敏感）", () => {
    // 昵称前缀命中两位 Agent。
    expect(filterMentionItems(MEMBER_ITEMS, "小").map(memberName)).toEqual([
      "小码",
      "小测",
    ]);
    // 「全体」命中广播常量条目。
    expect(filterMentionItems(MEMBER_ITEMS, "全体").map(memberName)).toEqual([
      "全体",
    ]);
    // 类别标签次级包含命中（"agent" 命中 Agent 成员，大小写不敏感）。
    expect(filterMentionItems(MEMBER_ITEMS, "agent").map(memberName)).toEqual([
      "小码",
      "小测",
    ]);
    // 无命中空。
    expect(filterMentionItems(MEMBER_ITEMS, "不存在的成员")).toEqual([]);
  });

  it("回填纯文本 @昵称：applyMentionPick 以 displayName 为插入键（无绑定字段）", () => {
    const picked = applyMentionPick("问题 @小", { trigger: "@", query: "小", start: 3 }, "小码");
    // 纯文本回填 @小码 + 尾随空格（下一次检测因空白归 null 自动关层）。
    expect(picked.value).toBe("问题 @小码 ");
    expect(picked.caret).toBe("问题 @小码 ".length);
    // @全体 同口径。
    const all = applyMentionPick("@", { trigger: "@", query: "", start: 0 }, "全体");
    expect(all.value).toBe("@全体 ");
  });

  it("选中抛原始实体（Object.is 身份透传——键盘/鼠标复用单一源）", () => {
    setup({ trigger: "@", items: MEMBER_ITEMS, activeIndex: 2 });
    fireEvent.mouseDown(screen.getByTestId("mention-option-2"));

    expect(HANDLERS.onSelect).toHaveBeenCalledTimes(1);
    expect(HANDLERS.onSelect.mock.calls[0]![0]).toBe(
      MEMBER_ITEMS[2]!.entity,
    );
  });

  it("键盘数学复用 handleMentionKeyDown 单一源（member 候选 Enter 选中拦截）", () => {
    const { handlers, result, input } = renderKeyHarness(MEMBER_ITEMS.length, 1);
    const evt = pressKey(input, "Enter");

    expect(result.handled).toBe(true);
    expect(evt.defaultPrevented).toBe(true);
    expect(handlers.onSelect).toHaveBeenCalledTimes(1);
  });

  it("既有 kind 零回归：member 候选不混入 buildAtMentionItems 输出", () => {
    // 变更/快速修复/PPM 组装口径不含 member（群成员候选由 buildMemberMentionItems
    // 单独喂参——task-08 群聊输入框接线）。
    expect(
      buildAtMentionItems(CHANGES, QUICKS, PPM_TASKS, PPM_PROBLEMS).every(
        (i) => i.kind !== "member",
      ),
    ).toBe(true);
    expect(SLASH_ITEMS.every((i) => i.kind !== "member")).toBe(true);
  });
});
