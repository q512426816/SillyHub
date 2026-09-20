/**
 * EntryCardList 组件测试（task-05 / 2026-09-20-knowledge-effect-panel /
 * FR-04 / FR-06 / D-004@v2 / D-005@v1）。
 *
 * 依据：
 *   - frontend/src/components/knowledge/entry-card-list.tsx + 原型
 *     prototype-effect-panel.html 的 .entry-card / .pill / .ec-* 卡片形态；
 *   - fixture 用真实形态：手册多小节（含 backend parser.slugify_anchor 实测例
 *     标题——斜杠/括号/箭头全去的 slug 归一）/ 决策 D 条目（active + rejected +
 *     superseded 混排）/ INDEX 路由行（有 # 锚与无 # 裸文件两类）/ FR 条目
 *     （含依据决策 · 取代链 · 全文 · 场景正文多行字段）。
 *   - task-05 卡片 acceptance：三形态渲染断言；依据决策与 INDEX 路由点击回调；
 *     状态 pill 映射；rejected 置顶横幅与 superseded 折叠；条目级徽标
 *     （entryCounts 锚对齐）与文件级 useCount 徽标。
 */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  detectEntryCardForm,
  EntryCardList,
  parseDecisionEntries,
  parseEntrySections,
  parseIndexRoutes,
  slugifyAnchor,
} from "@/components/knowledge/entry-card-list";

afterEach(() => {
  cleanup();
});

// ── fixture（真实形态，脱敏自 .sillyspec/knowledge 实际文件）─────────────────

/** 手册多小节：frontmatter + H1 + 三小节（第三个标题含符号，覆盖 slug 归一）。 */
const MANUAL_CONTENT = `---
author: qinyi
created_at: 2026-06-23 02:00:00
---

# 项目约定 (Conventions)

文件头导语（不属于任何小节，不应成卡）。

## SillySpec 文档驱动开发流程

执行顺序：文档 → 读现有代码 → 写测试 → 写实现。

## 子项目构建 / 测试 / lint 命令

monorepo 根无统一命令，必须 cd 到对应子项目。

## backend 模块分层与基类/异常约定（Router/Service/Schema → BaseModel → AppError）

routerserviceschema 分层约定正文。
`;

/** 决策 D 条目：active + rejected + superseded 混排（rejected 应置顶）。 */
const DECISIONS_CONTENT = `# 决策知识 — demo

> decision-distill 幂等提炼。条目字段行为机械解析契约，勿手改。

## D-001@v1 : 活决策标题
状态：active
变更：2026-01-01-demo-change
锚点：\`backend/app/modules/demo/router.py\`
最近确认：abc1234
理由：活决策理由文本。

## D-002@v1 : 被否决的方案
状态：rejected
变更：2026-01-02-demo-change
理由：方案 B 性能断崖，已否决。

## D-003@v1 : 已被取代的决策
状态：superseded
superseded_by：D-003@v2
取代链：D-003@v1 ← D-003@v2（2026-02-demo 承接）
退役理由：旧口径改道。
最近确认：def5678

## D-004@v1 : 已实施决策
状态：implemented
锚点：\`frontend/src/demo.tsx\`
理由：已实施理由。
`;

/** FR 条目：依据决策（多 ID · 分隔）+ 取代链 + 全文 + 场景正文多行字段。 */
const FR_CONTENT = `---
author: sillyspec-fr-index
created_at: 2026-09-19T15:24:52.781Z
---

# FR 索引 — demo-domain

> fr-index 从归档变更 requirements.md 幂等提炼。

## FR-demo-domain-001 回放主体
变更：2026-09-19-demo-change
状态：superseded
superseded_by：FR-demo-domain-005
取代链：FR-demo-domain-001 ← FR-demo-domain-005（2026-09-20-demo2 承接）
退役理由：主体改为时间线直适配
摘要：纯会话打开；轮次切分
最近确认：3e703c193

## FR-demo-domain-005 回放主体按会话样式渲染
变更：2026-09-20-demo2
状态：active
摘要：默认场景；分页
场景正文：
- 场景：默认场景 — Given 会话存在；When 打开；Then 渲染对话流
- 场景：分页 — Given 超 200 段；When 打开；Then 首屏翻到最早窗口
依据决策：D-001@v1 · D-004@v1
全文：.sillyspec/changes/archive/2026-09-20-demo2/requirements.md#FR-01
最近确认：3e703c193
`;

/** INDEX 路由：含 # 锚（手册）与无 # 裸文件（decisions/fr）两类 + 注释行。 */
const INDEX_CONTENT = `# Knowledge Index

> 子代理任务开始前查询此文件。

<!-- 格式：关键词1|关键词2 → 文件路径 -->
<!-- 示例：mybatis-plus|分页 → pagination.md -->

## Conventions
- 构建|测试|lint|命令 → [子项目构建/测试/lint 命令](conventions.md#子项目构建--测试--lint-命令)

- 模块卡片|标题|H1 → [模块卡片 H1 用中文名](conventions.md#模块卡片-h1-用中文名module-id)
## Known Issues
- daemon|实例|taskkill → [本机可能存在多个 daemon 实例](known-issues.md#本机可能存在多个-daemon-实例)
## Decisions
- backend|decision|决策 → [decisions/backend.md](decisions/backend.md)
`;

/** generated 单条目（H1 + 正文）。 */
const GENERATED_CONTENT = `# 自动生成知识

生成文件正文段落。
`;

// ── 解析函数单测 ────────────────────────────────────────────────────────────

describe("slugifyAnchor（backend parser.slugify_anchor 双端同规则，Grill CLK-02）", () => {
  it("小写 + 每空白一个 - 不折叠 + 去符号不截断（parser 实测例值）", () => {
    expect(slugifyAnchor("无 --reload")).toBe("无---reload");
    expect(slugifyAnchor("（Router/Service/Schema → BaseModel → AppError）")).toBe(
      "routerserviceschema--basemodel--apperror",
    );
    expect(slugifyAnchor("item_id 保留")).toBe("item_id-保留");
  });
});

describe("parseEntrySections（手册 ## 小节）", () => {
  it("剥 frontmatter/H1 导语，逐小节成卡，anchor=文件#slug", () => {
    const sections = parseEntrySections(MANUAL_CONTENT, "conventions.md");
    expect(sections.map((s) => s.title)).toEqual([
      "SillySpec 文档驱动开发流程",
      "子项目构建 / 测试 / lint 命令",
      "backend 模块分层与基类/异常约定（Router/Service/Schema → BaseModel → AppError）",
    ]);
    expect(sections[0]!.body).toContain("执行顺序：文档 → 读现有代码");
    expect(sections[1]!.anchor).toBe("conventions.md#子项目构建--测试--lint-命令");
    // 符号全去 slug（与 INDEX 路由行锚同域）。
    expect(sections[2]!.anchor).toBe(
      "conventions.md#backend-模块分层与基类异常约定routerserviceschema--basemodel--apperror",
    );
  });
});

describe("parseDecisionEntries（决策/FR 条目）", () => {
  it("D 条目：ID : 标题分离 + 字段行收集 + 状态归一（rejected/superseded/implemented）", () => {
    const entries = parseDecisionEntries(DECISIONS_CONTENT);
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ id: "D-001@v1", title: "活决策标题", status: "active" });
    expect(entries[1]).toMatchObject({ id: "D-002@v1", status: "rejected" });
    expect(entries[2]).toMatchObject({
      id: "D-003@v1",
      status: "superseded",
      reason: "旧口径改道。",
    });
    expect(entries[3]).toMatchObject({ id: "D-004@v1", status: "implemented" });
    // 字段行收集（顺序保留）。
    const keys = entries[0]!.fields.map((f) => f.key);
    expect(keys).toEqual(["状态", "变更", "锚点", "最近确认", "理由"]);
    // 理由高亮块内容来自字段。
    expect(entries[0]!.reason).toBe("活决策理由文本。");
  });

  it("FR 条目：域名多段连字符 ID 解析 + 场景正文多行并入字段 + 依据决策/全文字段", () => {
    const entries = parseDecisionEntries(FR_CONTENT);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: "FR-demo-domain-001",
      title: "回放主体",
      status: "superseded",
    });
    const active = entries[1]!;
    expect(active.id).toBe("FR-demo-domain-005");
    const scene = active.fields.find((f) => f.key === "场景正文");
    expect(scene?.value).toContain("- 场景：默认场景");
    expect(scene?.value).toContain("- 场景：分页");
    expect(active.fields.find((f) => f.key === "依据决策")?.value).toBe("D-001@v1 · D-004@v1");
    expect(active.fields.find((f) => f.key === "全文")?.value).toContain(
      "archive/2026-09-20-demo2/requirements.md#FR-01",
    );
  });
});

describe("parseIndexRoutes（INDEX 分类段+路由行）", () => {
  it("路由行解析：keywords/标题/file/anchor（无 # 裸文件 anchor=null），注释行跳过", () => {
    const routes = parseIndexRoutes(INDEX_CONTENT);
    expect(routes).toHaveLength(4);
    expect(routes[0]).toMatchObject({
      category: "Conventions",
      keywords: "构建|测试|lint|命令",
      file: "conventions.md",
      anchor: "子项目构建--测试--lint-命令",
    });
    expect(routes[1]).toMatchObject({
      title: "模块卡片 H1 用中文名",
      anchor: "模块卡片-h1-用中文名module-id",
    });
    expect(routes[3]).toMatchObject({
      category: "Decisions",
      file: "decisions/backend.md",
      anchor: null,
    });
  });
});

describe("detectEntryCardForm（形态分发）", () => {
  it("INDEX.md 恒走导航；decisions/fr 走结构化；top 走手册；其余单卡", () => {
    expect(detectEntryCardForm("INDEX.md", "top")).toBe("index");
    expect(detectEntryCardForm("generated/INDEX.md", "generated")).toBe("index");
    expect(detectEntryCardForm("decisions/backend.md", "decisions")).toBe("structured");
    expect(detectEntryCardForm("fr/styles.md", "fr")).toBe("structured");
    expect(detectEntryCardForm("conventions.md", "top")).toBe("manual");
    expect(detectEntryCardForm("generated/runtime.md", "generated")).toBe("single");
    expect(detectEntryCardForm("proposed/x.md", "proposed")).toBe("single");
  });
});

// ── 渲染 ────────────────────────────────────────────────────────────────────

function renderList(p: Parameters<typeof EntryCardList>[0]) {
  return render(<EntryCardList {...p} />);
}

describe("手册形态渲染（zone=top 非 INDEX）", () => {
  it("逐小节正文卡 + 条目级 🔥 徽标（entryCounts 锚对齐）+ 头部文件级徽标", () => {
    renderList({
      filename: "conventions.md",
      zone: "top",
      content: MANUAL_CONTENT,
      useCount: 214,
      entryCounts: {
        "conventions.md#子项目构建--测试--lint-命令": 41,
      },
    });

    expect(screen.getByTestId("entry-card-list")).toHaveAttribute("data-form", "manual");
    const cards = screen.getAllByTestId("manual-section-card");
    expect(cards).toHaveLength(3);
    expect(screen.getByText("SillySpec 文档驱动开发流程")).toBeInTheDocument();
    expect(screen.getByText("monorepo 根无统一命令，必须 cd 到对应子项目。")).toBeInTheDocument();
    // 头部元信息：文件名 + 条数 + 文件级徽标 🔥 214。
    expect(screen.getByText(/📄 conventions\.md · 3 条/)).toBeInTheDocument();
    expect(screen.getAllByTestId("entry-use-badge").map((b) => b.textContent)).toContain("🔥 214");
    // 条目级徽标：仅锚对齐的小节带（41），其余两条不带。
    expect(screen.getAllByTestId("entry-use-badge").map((b) => b.textContent)).toContain("🔥 41");
    expect(screen.getAllByTestId("entry-use-badge")).toHaveLength(2);
    // 无 entryCounts 锚的标题卡不带徽标（由计数 2 断言覆盖）。
    expect(screen.queryByText("文件头导语（不属于任何小节，不应成卡）。")).not.toBeInTheDocument();
  });

  it("无 ## 小节的手册文件兜底单卡", () => {
    renderList({ filename: "empty.md", zone: "top", content: "# 只有标题\n\n正文" });
    expect(screen.getByTestId("single-entry-card")).toBeInTheDocument();
  });
});

describe("决策形态渲染（zone=decisions）", () => {
  it("rejected 置顶 + 防复潮横幅；active/implemented 保持原文序；状态 pill 映射", () => {
    renderList({
      filename: "decisions/demo.md",
      zone: "decisions",
      content: DECISIONS_CONTENT,
    });

    // 横幅（zone=decisions 且存在 rejected）。
    expect(screen.getByTestId("rejected-banner")).toHaveTextContent("防复潮");

    const cards = screen.getAllByTestId("decision-entry-card");
    expect(cards).toHaveLength(4);
    // rejected 置顶（DOM 首位）。
    expect(cards[0]).toHaveAttribute("data-status", "rejected");
    expect(cards[1]).toHaveAttribute("data-status", "active");
    expect(cards[2]).toHaveAttribute("data-status", "superseded");
    expect(cards[3]).toHaveAttribute("data-status", "implemented");

    // 状态 pill 映射（文案 + data-status 供样式定位）。
    const pills = screen.getAllByTestId("status-pill");
    expect(pills.map((p) => p.textContent)).toEqual([
      "rejected",
      "active",
      "superseded",
      "implemented",
    ]);
    // pill 配色类（原型 .pill-* 语义：rejected 红 / active 绿 / superseded 灰 /
    // implemented brand）。
    expect(pills[0]!.className).toContain("destructive");
    expect(pills[1]!.className).toContain("success");
    expect(pills[2]!.className).toContain("muted");
    expect(pills[3]!.className).toContain("brand");

    // 字段行网格（值文本可见——锚点值原样含反引号，superseded 折叠不参与）
    // 与理由高亮块。
    expect(screen.getByText("2026-01-01-demo-change")).toBeInTheDocument();
    expect(screen.getByText("`backend/app/modules/demo/router.py`")).toBeInTheDocument();
    expect(screen.getByText("活决策理由文本。")).toBeInTheDocument();
  });

  it("superseded 折叠置灰：字段隐藏 + 可展开；取代链条带恒可见", () => {
    renderList({
      filename: "decisions/demo.md",
      zone: "decisions",
      content: DECISIONS_CONTENT,
    });

    const supersededCard = screen
      .getAllByTestId("decision-entry-card")
      .find((c) => c.getAttribute("data-status") === "superseded")!;
    // 折叠态：理由/字段行不渲染；取代链条带保留。
    expect(within(supersededCard).queryByText("旧口径改道。")).not.toBeInTheDocument();
    expect(within(supersededCard).getByText(/D-003@v1 ← D-003@v2/)).toBeInTheDocument();

    // 展开 → 理由出现。
    const toggle = within(supersededCard).getByTestId("superseded-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(within(supersededCard).getByText("旧口径改道。")).toBeInTheDocument();
    // 再收起。
    fireEvent.click(within(supersededCard).getByTestId("superseded-toggle"));
    expect(within(supersededCard).queryByText("旧口径改道。")).not.toBeInTheDocument();
  });

  it("fr zone 即使存在 rejected 也不渲染防复潮横幅（横幅仅 decisions zone）", () => {
    const rejectedFr = `${FR_CONTENT}
## FR-demo-domain-009 被否决的规则
变更：2026-09-20-demo3
状态：rejected
理由：需求方向已否决。
`;
    renderList({
      filename: "fr/demo-domain.md",
      zone: "fr",
      content: rejectedFr,
    });
    // rejected 仍置顶成卡，但 fr zone 不挂 decisions 专属的防复潮横幅。
    expect(screen.getAllByTestId("decision-entry-card")[0]).toHaveAttribute("data-status", "rejected");
    expect(screen.queryByTestId("rejected-banner")).not.toBeInTheDocument();
  });
});

describe("FR 形态：依据决策点击 + 全文链接 + 文件级条目徽标", () => {
  it("依据决策 ID 可点击 → onJumpToEntry(decisions/<域>.md)；全文路径文本链点击复制", () => {
    const onJumpToEntry = vi.fn();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    renderList({
      filename: "fr/demo-domain.md",
      zone: "fr",
      content: FR_CONTENT,
      onJumpToEntry,
    });

    // 依据决策（active 条目内，superseded 折叠态不含）。
    const links = screen.getAllByTestId("based-on-decision-link");
    expect(links.map((l) => l.textContent)).toEqual(["D-001@v1", "D-004@v1"]);
    fireEvent.click(links[0]!);
    expect(onJumpToEntry).toHaveBeenCalledWith("decisions/demo-domain.md");

    // 全文路径：文本链可见 + 点击复制路径。
    const fulltext = screen.getByTestId("fulltext-link");
    expect(fulltext).toHaveTextContent(
      "全文 ↗ .sillyspec/changes/archive/2026-09-20-demo2/requirements.md#FR-01",
    );
    fireEvent.click(fulltext);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      ".sillyspec/changes/archive/2026-09-20-demo2/requirements.md#FR-01",
    );
  });

  it("decisions/fr 条目徽标走裸文件名锚（文件级口径）", () => {
    renderList({
      filename: "fr/demo-domain.md",
      zone: "fr",
      content: FR_CONTENT,
      entryCounts: { "fr/demo-domain.md": 18 },
    });
    // 头部文件级 useCount 徽标为 18（entryCounts 裸文件名锚 + 条目卡同源计数）。
    expect(screen.getAllByTestId("entry-use-badge").map((b) => b.textContent)).toContain("🔥 18");
  });
});

describe("INDEX 导航形态渲染（zone=top INDEX.md）", () => {
  it("分类分组 + 路由行可点击（带锚/无锚两态）", () => {
    const onJumpToEntry = vi.fn();
    renderList({
      filename: "INDEX.md",
      zone: "top",
      content: INDEX_CONTENT,
      onJumpToEntry,
    });

    expect(screen.getByTestId("entry-card-list")).toHaveAttribute("data-form", "index");
    // 分类分组（保序）。
    const cats = screen.getAllByTestId("index-category");
    expect(cats.map((c) => c.getAttribute("data-category"))).toEqual([
      "Conventions",
      "Known Issues",
      "Decisions",
    ]);

    // 路由行：标题可点 + 目标文件/锚提示；带锚路由 → onJumpToEntry(file, anchor)。
    const rows = screen.getAllByTestId("index-route-row");
    expect(rows).toHaveLength(4);
    fireEvent.click(screen.getByText("子项目构建/测试/lint 命令"));
    expect(onJumpToEntry).toHaveBeenCalledWith(
      "conventions.md",
      "子项目构建--测试--lint-命令",
    );
    // 无 # 裸文件路由（decisions，标题与目标同名——按行点击）→ anchor 参数 undefined。
    fireEvent.click(rows[3]!);
    expect(onJumpToEntry).toHaveBeenCalledWith("decisions/backend.md", undefined);
  });
});

describe("generated 单条目形态（兜底）", () => {
  it("H1 标题 + 正文单卡", () => {
    renderList({
      filename: "generated/runtime.md",
      zone: "generated",
      content: GENERATED_CONTENT,
    });
    expect(screen.getByTestId("entry-card-list")).toHaveAttribute("data-form", "single");
    const card = screen.getByTestId("single-entry-card");
    expect(within(card).getByText("自动生成知识")).toBeInTheDocument();
    expect(within(card).getByText("生成文件正文段落。")).toBeInTheDocument();
  });
});
