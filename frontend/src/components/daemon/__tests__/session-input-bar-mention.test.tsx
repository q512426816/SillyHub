// task-03（2026-08-26-session-input-mention / FR-01 / FR-02 / FR-03 / FR-08 /
// D-002 / R-2 / R-3）：SessionInputBar 联想接入单测。
//
// 覆盖（对齐 task 卡 implementation + acceptance）：
//   1. 检测驱动开关——行首 /、@ 打开浮层并随 query 过滤；查询串含空白、非词首
//      触发字符（foo/bar、你好@世界）、输入清空（onChange 路径与受控置空路径
//      ——发送后清空/team 拦截 setInput("")）、blur 均关层；
//   2. 键盘——浮层激活 Enter/Tab 选中且 onSend 不触发、↑↓ 循环回绕、Esc 关层；
//      空态（无匹配）Enter 放行走发送；浮层激活 Shift+Enter 放行不选中；
//      浮层未激活 Enter 发送 / Shift+Enter 换行（原语义零回归）；
//   3. IME——组合期输入不弹层、Enter 不拦截选中；compositionend 后按最终文本
//      重检（拼音含 @ 非词首不误触，design §3.1 / R-3）；
//   4. 回填与光标——/ 技能回填 invoke_name ?? name（本层计算）、@ 回填
//      change_key / ql_id 均后随空格；jsdom 断言回填后 selectionStart
//      （受控 value 下延迟复位模式，design §3.3 仓库首例）；
//   5. onMentionsChange——change/quick 两槽位、同类型后选覆盖先选、/ 选中不
//      触发；workspaceId 透传 useMentionSources；
//   6. 缺陷修复（task-05 接线实测发现）：mentionsRef 跨消息陈旧槽位——发送后
//      父级受控置空（setInput("")，不经 onChange）时组件侧同步复位累计 ref，
//      下一条消息选中不携带上一条的 change/quick 槽位；同一条消息内双选累积
//      不受复位影响（value 归空才复位，过程中恒非空）。
//      缺陷修复收口（A-1）：复位升级为双向——归空 effect 复位 mentionsRef 的
//      同时以 {} 回调 onMentionsChange（父级 pendingMentions 同步归零，堵
//      「dialog 新建会话 / page 切会话」等父侧清空路径的跨上下文残留错绑）；
//      挂载即空态（无残留）不广播，且发送失败保留可重试（value 不清空 →
//      归空 effect 不触发）语义零影响。
//
// 数据源隔离：vi.mock @/lib/session-mention-sources（task-04 hook）。组件内
// MentionSourcesBridge 经 textarea 首次聚焦挂载后消费 mock 快照——无需
// QueryClientProvider 亦零网络（真实 hook 走 react-query，桥的挂载门正是为
// 裸渲染 harness 兼容而设，见组件内注释）。

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { useState } from "react";

import { SessionInputBar, type SessionInputMentions } from "../session-input-bar";
import { useMentionSources } from "@/lib/session-mention-sources";
import type { PlatformSkillSummary } from "@/lib/custom-skills";
import type { ChangeSummary } from "@/lib/changes";
import type { QuicklogEntryListItem } from "@/lib/quicklog";

vi.mock("@/lib/session-mention-sources", () => ({
  useMentionSources: vi.fn(),
}));

const sourcesMock = vi.mocked(useMentionSources);

/* ───────── fixture（形态对齐真实数据源：manifest skills / ChangeSummary / QuicklogEntryListItem） ───────── */

function skill(
  name: string,
  description: string,
  invoke_name: string | null,
): PlatformSkillSummary {
  return { name, description, file_count: 2, invoke_name };
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
  // invoke_name 缺省（null）→ 回填写目录名；非空 → 回填写冒号名。
  skill("deploy-to-server", "本地打包镜像部署", null),
  skill("sillyspec-verify", "验证代码实现", "sillyspec:verify"),
];

const CHANGES = [
  change("2026-08-26-session-input-mention", "会话输入联想"),
  change("2026-08-25-git-log", null),
];

const QUICKS = [quick("ql-20260826-013", "修复一"), quick("ql-20260826-010", "修复二")];

/** 首条变更的结构化选中载荷（onMentionsChange 断言复用）。 */
const CHANGE_1 = {
  id: "id-2026-08-26-session-input-mention",
  change_key: "2026-08-26-session-input-mention",
};

beforeEach(() => {
  sourcesMock.mockReturnValue({
    skills: SKILLS,
    changes: CHANGES,
    quicklogs: QUICKS,
    atEnabled: true,
  });
});

/* ───────── 渲染 harness ───────── */

/**
 * 受控 harness：value 经 useState 回流（受控回填与光标复位断言的前提）。
 * 挂载后 fireEvent.focus textarea——真实浏览器打字必先聚焦，聚焦即挂载联想
 * 数据桥（见组件内 MentionSourcesBridge 注释）。
 */
function setupBar(
  overrides: {
    onSend?: () => void;
    onMentionsChange?: (next: SessionInputMentions) => void;
    workspaceId?: string | null;
  } = {},
) {
  const { onSend = vi.fn(), onMentionsChange, workspaceId = "ws-1" } = overrides;
  let setValueExternal: ((v: string) => void) | null = null;
  function Bar() {
    const [value, setValue] = useState("");
    setValueExternal = setValue;
    return (
      <SessionInputBar
        value={value}
        onChange={setValue}
        onSend={onSend}
        disabled={false}
        placeholder="测试输入框"
        creating={false}
        onMentionsChange={onMentionsChange}
        workspaceId={workspaceId}
      />
    );
  }
  render(<Bar />);
  const ta = () => screen.getByPlaceholderText("测试输入框") as HTMLTextAreaElement;
  // 首次聚焦：挂载联想数据桥。
  fireEvent.focus(ta());
  /** 模拟输入（含光标位置；caret 缺省 = 文本末尾）。 */
  const type = (text: string, caret = text.length) => {
    fireEvent.change(ta(), {
      target: { value: text, selectionStart: caret, selectionEnd: caret },
    });
  };
  return { onSend, ta, type, setValueExternal: () => setValueExternal as (v: string) => void };
}

function getPopover() {
  return screen.getByTestId("session-mention-popover");
}

function queryPopover() {
  return screen.queryByTestId("session-mention-popover");
}

/* ───────── 1. 检测驱动开关 ───────── */

describe("SessionInputBar 联想：检测驱动浮层开关", () => {
  it("行首 / 打开浮层（/team 置顶 + 技能），随 query 过滤；workspaceId 透传数据源", () => {
    const { type } = setupBar();
    type("/");

    const pop = getPopover();
    expect(within(pop).getAllByRole("option")).toHaveLength(3);
    expect(within(pop).getByText("/team")).toBeInTheDocument();
    // 首次聚焦挂载的数据桥把 workspaceId 透传给 useMentionSources（task-04 契约）。
    expect(sourcesMock).toHaveBeenCalledWith("ws-1");

    type("/silly");
    const opts = within(getPopover()).getAllByRole("option");
    expect(opts).toHaveLength(1);
    expect(within(opts[0]!).getByText("sillyspec-verify")).toBeInTheDocument();
  });

  it("@ 打开变更/快速修复分组", () => {
    const { type } = setupBar();
    type("@");

    const pop = getPopover();
    expect(within(pop).getAllByRole("option")).toHaveLength(4);
    expect(within(pop).getByText("变更（当前工作区）")).toBeInTheDocument();
    expect(within(pop).getByText("快速修复（当前工作区）")).toBeInTheDocument();
  });

  it("查询串含空白 / 非词首触发字符（foo/bar、你好@世界）→ 不弹层", () => {
    const { type } = setupBar();
    type("/foo bar");
    expect(queryPopover()).not.toBeInTheDocument();
    type("foo/bar");
    expect(queryPopover()).not.toBeInTheDocument();
    type("你好@世界");
    expect(queryPopover()).not.toBeInTheDocument();
  });

  it("输入清空关层（onChange 路径与受控置空路径——发送后清空/team 拦截）", () => {
    const { type, setValueExternal } = setupBar();
    type("/");
    expect(queryPopover()).toBeInTheDocument();
    type("");
    expect(queryPopover()).not.toBeInTheDocument();

    // 受控 value 外部置空不经 onChange——由 value 归空 effect 关层
    //（design §3.1「输入被清空、发送后」）。
    type("/");
    expect(queryPopover()).toBeInTheDocument();
    act(() => setValueExternal()(""));
    expect(queryPopover()).not.toBeInTheDocument();
  });

  it("blur → 关层（浮层内 mousedown 不失焦，到达此处的均为浮层外失焦）", () => {
    const { ta, type } = setupBar();
    type("/");
    expect(queryPopover()).toBeInTheDocument();
    fireEvent.blur(ta());
    expect(queryPopover()).not.toBeInTheDocument();
  });

  it("placeholder prop 透传不变；未聚焦时零数据依赖（裸渲染不炸）", () => {
    // 既有 session-panel 系测试裸渲染（无 QueryClientProvider、无聚焦）——
    // 数据桥不挂载即零依赖，此用例固化该兼容前提。
    render(
      <SessionInputBar
        value=""
        onChange={() => {}}
        onSend={() => {}}
        disabled={false}
        placeholder="任意父级文案"
        creating={false}
      />,
    );
    expect(screen.getByPlaceholderText("任意父级文案")).toBeInTheDocument();
    expect(sourcesMock).not.toHaveBeenCalled();
  });
});

/* ───────── 2. 键盘拦截与放行 ───────── */

describe("SessionInputBar 联想：键盘拦截与放行", () => {
  it("浮层激活 Enter：选中高亮项 /team，onSend 不触发，回填 + 光标复位 + 关层", () => {
    const { onSend, ta, type } = setupBar();
    type("/");
    fireEvent.keyDown(ta(), { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    expect(ta().value).toBe("/team ");
    expect(ta().selectionStart).toBe(6);
    expect(queryPopover()).not.toBeInTheDocument();
  });

  it("Tab 选中技能：回填 invoke_name ?? name（invoke_name 优先）", () => {
    const { ta, type } = setupBar();
    type("/silly");
    fireEvent.keyDown(ta(), { key: "Tab" });

    expect(ta().value).toBe("/sillyspec:verify ");
    expect(ta().selectionStart).toBe(18);
  });

  it("Enter 选中技能：invoke_name 缺省回退目录名 name", () => {
    const { ta, type } = setupBar();
    type("/deploy");
    fireEvent.keyDown(ta(), { key: "Enter" });

    expect(ta().value).toBe("/deploy-to-server ");
    expect(ta().selectionStart).toBe(18);
  });

  it("↑↓ 循环移动高亮（末尾/首项回绕）", () => {
    const { ta, type } = setupBar();
    type("/");
    const selected = () =>
      within(getPopover())
        .getAllByRole("option")
        .map((o) => o.getAttribute("aria-selected"));

    expect(selected()).toEqual(["true", "false", "false"]);
    fireEvent.keyDown(ta(), { key: "ArrowDown" });
    expect(selected()).toEqual(["false", "true", "false"]);
    fireEvent.keyDown(ta(), { key: "ArrowDown" });
    expect(selected()).toEqual(["false", "false", "true"]);
    fireEvent.keyDown(ta(), { key: "ArrowDown" }); // 末尾 ↓ 回绕回首项
    expect(selected()).toEqual(["true", "false", "false"]);
    fireEvent.keyDown(ta(), { key: "ArrowUp" }); // 首项 ↑ 回绕到末项
    expect(selected()).toEqual(["false", "false", "true"]);
  });

  it("Esc 关层且不发送", () => {
    const { onSend, ta, type } = setupBar();
    type("/");
    fireEvent.keyDown(ta(), { key: "Escape" });

    expect(queryPopover()).not.toBeInTheDocument();
    expect(onSend).not.toHaveBeenCalled();
    expect(ta().value).toBe("/");
  });

  it("浮层未激活：Enter 发送 / Shift+Enter 换行不发送（原语义零回归）", () => {
    const { onSend, ta, type } = setupBar();
    type("hello");
    fireEvent.keyDown(ta(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(ta(), { key: "Enter", shiftKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("空态（无匹配）Enter 放行：走发送、不选中、浮层保持（放行语义）", () => {
    const { onSend, ta, type } = setupBar();
    type("/zzz无匹配");
    expect(within(getPopover()).getByTestId("mention-empty")).toBeInTheDocument();

    fireEvent.keyDown(ta(), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(ta().value).toBe("/zzz无匹配");
    expect(queryPopover()).toBeInTheDocument();
  });

  it("浮层激活 Shift+Enter：放行——不选中、不发送、浮层保持", () => {
    const { onSend, ta, type } = setupBar();
    type("/");
    fireEvent.keyDown(ta(), { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
    expect(ta().value).toBe("/");
    expect(queryPopover()).toBeInTheDocument();
  });
});

/* ───────── 3. IME 组合保护（design §3.1 / R-3） ───────── */

describe("SessionInputBar 联想：IME 组合保护", () => {
  it("组合期输入不弹层；compositionend 后按最终文本重检弹层", () => {
    const { ta, type } = setupBar();
    fireEvent.compositionStart(ta());
    type("你好 /dep");
    expect(queryPopover()).not.toBeInTheDocument();

    fireEvent.compositionEnd(ta());
    const pop = getPopover();
    expect(within(pop).getAllByRole("option")).toHaveLength(1);
    expect(within(pop).getByText("deploy-to-server")).toBeInTheDocument();
  });

  it("拼音含 @ 非词首：组合期与 compositionend 重检后均不误触", () => {
    const { ta, type } = setupBar();
    fireEvent.compositionStart(ta());
    type("nih@ao");
    expect(queryPopover()).not.toBeInTheDocument();

    fireEvent.compositionEnd(ta());
    expect(queryPopover()).not.toBeInTheDocument();
  });

  it("组合期 Enter 不拦截选中：浮层保持、值不变（组合期跳过 Enter/Tab 拦截）", () => {
    const { ta, type } = setupBar();
    type("/");
    expect(queryPopover()).toBeInTheDocument();

    fireEvent.compositionStart(ta());
    fireEvent.keyDown(ta(), { key: "Enter" });
    expect(ta().value).toBe("/"); // 未回填（不选中）
    expect(queryPopover()).toBeInTheDocument();
  });
});

/* ───────── 4. 选中回填与光标（design §3.3） ───────── */

describe("SessionInputBar 联想：选中回填与光标", () => {
  it("@ 变更选中：回填 @change_key+空格、光标复位、onMentionsChange 回传 change 槽", () => {
    const onMentionsChange = vi.fn();
    const { onSend, ta, type } = setupBar({ onMentionsChange });
    type("看下 @2026");
    fireEvent.keyDown(ta(), { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
    expect(ta().value).toBe("看下 @2026-08-26-session-input-mention ");
    expect(ta().selectionStart).toBe(37); // 3（看下␣）+ @key(32)+␣(1) + 1(@) = 37
    expect(queryPopover()).not.toBeInTheDocument();
    expect(onMentionsChange).toHaveBeenCalledTimes(1);
    expect(onMentionsChange).toHaveBeenCalledWith({ change: CHANGE_1 });
  });

  it("中段回填：光标落在插入片段之后（非文本末尾的精确断言）", () => {
    const { ta, type } = setupBar();
    type("前缀 @2026 后缀", 8); // 光标停在 @2026 之后、空格之前
    fireEvent.keyDown(ta(), { key: "Enter" });

    expect(ta().value).toBe("前缀 @2026-08-26-session-input-mention  后缀");
    expect(ta().selectionStart).toBe(37);
  });

  it("鼠标 mousedown 选中（原始实体路径）：回填 + quick 槽回传 + 关层", () => {
    const onMentionsChange = vi.fn();
    const { ta, type } = setupBar({ onMentionsChange });
    type("@");
    fireEvent.mouseDown(within(getPopover()).getByTestId("mention-option-2"));

    expect(ta().value).toBe("@ql-20260826-013 ");
    expect(onMentionsChange).toHaveBeenCalledWith({ quick: { ql_id: "ql-20260826-013" } });
    expect(queryPopover()).not.toBeInTheDocument();
  });
});

/* ───────── 5. onMentionsChange 槽位语义（design §3.3） ───────── */

describe("SessionInputBar 联想：onMentionsChange 槽位语义", () => {
  it("change 与 quick 并存；同类型后选覆盖先选；/ 选中不触碰槽位", () => {
    const onMentionsChange = vi.fn();
    const { ta, type } = setupBar({ onMentionsChange });

    // 第 1 选：变更 → 仅 change 槽。
    type("@2026");
    fireEvent.keyDown(ta(), { key: "Enter" });
    expect(onMentionsChange).toHaveBeenNthCalledWith(1, { change: CHANGE_1 });
    const afterChange = ta().value; // "@2026-08-26-session-input-mention "

    // 第 2 选：快速修复 → change 槽保留、quick 槽新增。
    type(`${afterChange}@ql-20260826-013`);
    fireEvent.keyDown(ta(), { key: "Enter" });
    expect(onMentionsChange).toHaveBeenNthCalledWith(2, {
      change: CHANGE_1,
      quick: { ql_id: "ql-20260826-013" },
    });
    const afterQuick = ta().value;

    // 第 3 选：另一条快速修复 → quick 槽覆盖、change 槽仍保留。
    type(`${afterQuick}@ql-20260826-010`);
    fireEvent.keyDown(ta(), { key: "Enter" });
    expect(onMentionsChange).toHaveBeenNthCalledWith(3, {
      change: CHANGE_1,
      quick: { ql_id: "ql-20260826-010" },
    });

    // / 选中（内置指令）不触碰 mention 槽位——回调总数不变。
    type(`${ta().value}/team`);
    fireEvent.keyDown(ta(), { key: "Enter" });
    expect(onMentionsChange).toHaveBeenCalledTimes(3);
    expect(ta().value).toBe(`${afterQuick}@ql-20260826-010 /team `);
  });
});

/* ───────── 6. mentionsRef 归空复位（缺陷修复 → 双向复位收口） ───────── */

describe("SessionInputBar 联想：mentionsRef 归空复位（双向）", () => {
  it("受控 value 归空 → onMentionsChange 以 {} 回调：父级 pendingMentions 同步归零（A-1）", () => {
    const onMentionsChange = vi.fn();
    const { ta, type, setValueExternal } = setupBar({ onMentionsChange });

    // 选中 @变更 → 回传 { change }；随后父级受控置空（新建会话 / 切会话换草稿
    // 等父侧清空路径，不经 onChange）→ 组件复位 mentionsRef 的同时必须以 {}
    // 回调父级，否则父级 pendingMentions 残留 → 跨上下文静默错绑。
    type("看下 @2026");
    fireEvent.keyDown(ta(), { key: "Enter" });
    expect(onMentionsChange).toHaveBeenLastCalledWith({ change: CHANGE_1 });

    act(() => setValueExternal()(""));
    expect(ta().value).toBe("");
    expect(onMentionsChange).toHaveBeenLastCalledWith({});

    // 恰好 2 次调用（选中 1 次 + 归零 1 次）——挂载即空态不广播（无残留不
    // 回调，避免父级收到无意义的归零噪声）。
    expect(onMentionsChange).toHaveBeenCalledTimes(2);
  });

  it("发送清空（受控置空不经 onChange）后双向复位：下一条消息再选不携带陈旧 change 槽位", () => {
    const onMentionsChange = vi.fn();
    const { ta, type, setValueExternal } = setupBar({ onMentionsChange });

    // 第一条消息：选 @变更 → 回传 { change }（发送后父级清空 pendingMentions，
    // 但组件内 mentionsRef 若无复位通道仍保留该槽位——缺陷根因）。
    type("看下 @2026");
    fireEvent.keyDown(ta(), { key: "Enter" });
    expect(onMentionsChange).toHaveBeenCalledTimes(1);
    expect(onMentionsChange).toHaveBeenCalledWith({ change: CHANGE_1 });

    // 发送成功：父级 setInput("")（模拟发送清空 / team 拦截清空等不经 onChange
    // 的路径）→ 组件侧复位 mentionsRef 并以 {} 回调（双向语义：父级即使自身
    // 清空时机遗漏也同步归零）。
    act(() => setValueExternal()(""));
    expect(ta().value).toBe("");
    expect(onMentionsChange).toHaveBeenNthCalledWith(2, {});

    // 第二条消息：再选 @快速修复 → 只回传 quick，不带上一条的陈旧 change
    //（否则请求体同时带 bind_change_key（陈旧）+ bind_quick_id 错绑）。
    type("@ql-20260826-013");
    fireEvent.keyDown(ta(), { key: "Enter" });
    expect(onMentionsChange).toHaveBeenCalledTimes(3);
    expect(onMentionsChange).toHaveBeenNthCalledWith(3, {
      quick: { ql_id: "ql-20260826-013" },
    });
    expect(ta().value).toBe("@ql-20260826-013 ");
  });

  it("同一条消息内双选不受复位影响：先 @变更 再 @快速修复，第二次回传累积两槽位", () => {
    const onMentionsChange = vi.fn();
    const { ta, type } = setupBar({ onMentionsChange });

    // 双选全程 value 非空——归空复位不触发，两槽位累积回传是正确行为。
    type("@2026");
    fireEvent.keyDown(ta(), { key: "Enter" });
    expect(onMentionsChange).toHaveBeenNthCalledWith(1, { change: CHANGE_1 });
    const afterChange = ta().value; // "@2026-08-26-session-input-mention "

    type(`${afterChange}@ql-20260826-013`);
    fireEvent.keyDown(ta(), { key: "Enter" });
    expect(onMentionsChange).toHaveBeenNthCalledWith(2, {
      change: CHANGE_1,
      quick: { ql_id: "ql-20260826-013" },
    });
  });
});
