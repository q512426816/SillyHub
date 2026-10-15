/**
 * prototype-as-code 演示视图 —— 变更详情 v2（四 tab 分区 + 状态自适应）。
 *
 * 变更：2026-10-15-change-detail-redesign（决策 D-001~D-011）
 * 依据：.sillyspec/changes/2026-10-15-change-detail-redesign/decisions.md
 *
 * 素材来源声明（真码五要素之「高保真必带声明」）：
 *   - 组件来源：`../primer` 真实生产组件（PageHead / UnderlineNav + Counter /
 *     StateLabel / StateIcon / StatGrid / IssueRow + IssueRowHeader / Timeline +
 *     TimelineItem / MetaPanel + MetaPanelSection / EmptyState）——桶导出
 *     frontend/src/components/primer/index.ts。
 *   - token 来源：frontend/src/styles/themes.ts（经 tailwind `brand-*` / `*-foreground`
 *     语义阶与 globals.css CSS 变量引入；本文件零硬编码 hex，取色一律
 *     `hsl(var(--*))` / `var(--color-brand-*)`）。
 *   - 版式与状态分叉来源：本变更 decisions.md D-001/D-002/D-003/D-004/D-005/D-006/D-007。
 *   - 数据：fixture（假数据），接线时逐 tab 换真实 hooks（见 design.md 接线表）。
 *   - 声明式替代（本产物不可直接编译的原件，接线时替换，非遗漏）：
 *       ① 阶段条：production `change-stage-header.tsx` 内部经 `@/components/primer`
 *          别名导入，原型编译链只支持相对导入——此处以真 StateIcon + 同款
 *          tailwind 类复现其渲染；接线时替换为该组件本体（props 同形）。
 *       ② 知识图谱画布：production `knowledge/graph-canvas.tsx` 依赖 `@/lib` +
 *          `@/stores` + canvas 运行时（SSR 静态产物为空画布）——此处以声明式
 *          示意图占位（同色系点阵，仅示意布局与尺寸）；接线时替换为 GraphCanvas。
 *       ③ 「展开详情」等 React 交互在离线产物中点击无效（既有管线的交互边界：
 *          产物仅内嵌主题切换与 tab 切换），时间线末附展开态示意块。
 */
import * as React from "react";

import {
  Counter,
  IssueRow,
  IssueRowHeader,
  MetaPanel,
  MetaPanelSection,
  PageHead,
  StatGrid,
  StateIcon,
  StateLabel,
  Timeline,
  TimelineItem,
  UnderlineNav,
} from "../primer";
import { DemoBar } from "./demo-chrome";

// ── fixture ────────────────────────────────────────────────────────────────

const CHANGE = {
  key: "2026-10-15-change-detail-redesign",
  title: "变更详情页信息架构重设计",
  type: "完整流程",
  createdAt: "2026-10-15 20:12",
  owner: "qinyi",
  affected: "frontend",
  description:
    "把变更详情页从「卡片堆叠」改为顶部四 tab 分区 + 状态自适应，合并两条重叠时间线，图谱独立成区。",
};

/** 在途态：verify 阶段 + 待人工测试（首屏待办卡有内容可展示）。 */
const STAGES_ACTIVE = [
  { key: "brainstorm", label: "需求分析", state: "done", at: "10-15 21:08" },
  { key: "plan", label: "规划", state: "done", at: "10-15 22:04" },
  { key: "execute", label: "执行", state: "done", at: "10-16 01:37" },
  { key: "verify", label: "验证", state: "current", at: "10-16 01:52" },
  { key: "archive", label: "归档", state: "pending", at: "" },
] as const;

const STAGES_ARCHIVED = STAGES_ACTIVE.map((s) => ({ ...s, state: "done" as const }));

const USAGE = [
  { k: "耗时", v: "5.4 小时" },
  { k: "轮次", v: "38" },
  { k: "输入", v: "1,284,301" },
  { k: "输出", v: "96,442" },
  { k: "缓存读取", v: "9,120,553" },
  { k: "请求次数", v: "412" },
  { k: "缓存命中率", v: "87%" },
];

const SESSIONS = [
  { id: "sess-ff095390", status: "进行中", at: "3 分钟前" },
  { id: "sess-a4c1b220", status: "已结束", at: "2 小时前" },
];

/** 统一时间线 fixture：steps 与留痕两源合流后的行（行带来源标签，D-014）。 */
const TIMELINE_ROWS = [
  {
    at: "10-15 20:12",
    stage: "—",
    src: "锚点",
    tone: "default" as const,
    icon: "clock" as const,
    title: "变更诞生",
    meta: "requirements.md frontmatter created_at",
    commit: "",
    detail: "",
  },
  {
    at: "10-15 21:08",
    stage: "需求分析",
    src: "步骤",
    tone: "success" as const,
    icon: "check" as const,
    title: "需求分析完成",
    meta: "D-001~D-011 落盘 · 8 问两轮",
    commit: "",
    detail:
      "> 产出：decisions.md（11 条 accepted + 2 条 rejected）\n> 原型：prototype-change-detail-v2.html 待批准",
  },
  {
    at: "10-15 22:04",
    stage: "规划",
    src: "步骤",
    tone: "success" as const,
    icon: "check" as const,
    title: "规划完成 · 4 Wave 链式计划",
    meta: "task-01~task-11 · 审查 8/9 pass",
    commit: "",
    detail: "> 依赖链：W1 骨架 → W2 产出 → W3 过程 → W4 文件与对账",
  },
  {
    at: "10-16 01:37",
    stage: "执行",
    src: "步骤",
    tone: "success" as const,
    icon: "check" as const,
    title: "执行 · task-06 完成（tab 骨架接线）",
    meta: "改动 6 文件",
    commit: "a1b2c3d 变更详情页改四 tab 骨架",
    detail:
      "> 修改 page.tsx / 新增 change-tabs.tsx 等 6 文件\n> 测试 148 passed · tsc 0 · eslint 0",
  },
  {
    at: "10-16 01:52",
    stage: "执行",
    src: "步骤",
    tone: "current" as const,
    icon: "openCircle" as const,
    title: "执行 · task-07 进行中（合并时间线算法）",
    meta: "已 12 分钟",
    commit: "",
    detail: "> 去重键 = 源 + 稳定键；同名不同源不合并",
  },
  {
    at: "10-16 01:58",
    stage: "执行",
    src: "事件",
    tone: "default" as const,
    icon: "clock" as const,
    title: "文件变更 change-step-timeline.tsx",
    meta: "watcher 观测（事件源独有）",
    commit: "",
    detail: "",
  },
  {
    at: "10-16 02:02",
    stage: "执行",
    src: "事件",
    tone: "default" as const,
    icon: "openCircle" as const,
    title: "负责人 变更 qinyi → admin",
    meta: "事件源独有",
    commit: "",
    detail: "",
  },
  {
    at: "—",
    stage: "验证",
    src: "步骤",
    tone: "default" as const,
    icon: "clock" as const,
    title: "验证（等待执行完成）",
    meta: "无时间戳的 pending 步骤置底",
    commit: "",
    detail: "",
  },
];

/** 任务进度清单 fixture（tasks.md 勾选态；勾选时刻由 task-done 事件推断，≈ 表推断值）。 */
const TASK_ROWS = [
  { id: "task-01", desc: "tab 骨架与 URL 驱动", checked: true, at: "≈10-16 00:41", sha: "b7c1d20" },
  { id: "task-02", desc: "概览面板 + 右信息栏", checked: true, at: "≈10-16 01:02", sha: "9e4f8a1" },
  { id: "task-03", desc: "产出面板 + 图谱独立分区", checked: true, at: "≈10-16 01:19", sha: "" },
  { id: "task-06", desc: "接线 tab 骨架", checked: true, at: "≈10-16 01:37", sha: "a1b2c3d" },
  { id: "task-07", desc: "统一时间线合并算法", checked: false, at: "", sha: "" },
  { id: "task-08", desc: "归档态收窄与空态清理", checked: false, at: "", sha: "" },
];

/** 概览用「最近动态」行（轻量预览，倒序；筛选器与合并口径只在过程 tab 出现）。 */
const RECENT_ROWS = [
  { at: "10-16 02:02", stage: "执行", tone: "default" as const, icon: "openCircle" as const, title: "负责人 变更 qinyi → admin" },
  { at: "10-16 01:58", stage: "执行", tone: "default" as const, icon: "clock" as const, title: "文件变更 change-step-timeline.tsx" },
  { at: "10-16 01:52", stage: "执行", tone: "current" as const, icon: "openCircle" as const, title: "执行 · task-07 进行中（合并时间线算法）" },
  { at: "10-16 01:37", stage: "执行", tone: "success" as const, icon: "check" as const, title: "执行 · task-06 完成（tab 骨架接线）" },
  { at: "10-15 22:04", stage: "规划", tone: "success" as const, icon: "check" as const, title: "规划完成 · 4 Wave 链式计划" },
];

/** 归档态概览用「最终动态」（倒序，含归档与提交）。 */
const FINAL_ROWS = [
  { at: "10-16 03:20", stage: "归档", tone: "success" as const, icon: "check" as const, title: "归档完成 · 建议 1 条已记入沉淀资产" },
  { at: "10-16 03:02", stage: "验证", tone: "success" as const, icon: "check" as const, title: "验证通过 · 7/7 PASS WITH NOTES" },
  { at: "10-16 01:37", stage: "执行", tone: "success" as const, icon: "check" as const, title: "执行 · task-06 完成（tab 骨架接线）" },
  { at: "10-15 22:04", stage: "规划", tone: "success" as const, icon: "check" as const, title: "规划完成 · 4 Wave 链式计划" },
];

const ASSET_GROUPS = [
  {
    title: "需求规则（FR 索引）",
    source: "knowledge/fr",
    total: 8,
    rows: [
      { id: "FR-01", title: "首屏内容按变更状态（在途/归档）分叉渲染" },
      { id: "FR-02", title: "详情页主体为四 tab，首屏默认概览" },
      { id: "FR-03", title: "知识图谱不再内嵌资产卡，独立成区" },
      { id: "FR-04", title: "范围对账不再侧栏常驻，下沉至文件与对账" },
      { id: "FR-05", title: "两条时间线合并为一条，逻辑事件只出现一次" },
      { id: "FR-06", title: "执行用量与会话入口置概览右侧信息栏" },
      { id: "FR-07", title: "归档态隐藏文件与对账 tab" },
      { id: "FR-08", title: "实现前产出可双击原型并通过批准" },
    ],
  },
  {
    title: "决策蒸馏",
    source: "knowledge/decisions",
    total: 13,
    rows: [
      { id: "D-002@v1", title: "页面骨架 = 顶部四 Tab 分区（取代左主右辅）" },
      { id: "D-005@v1", title: "两条时间线合并为一条统一时间线" },
      { id: "D-006@v1", title: "执行用量与会话入口 = 概览右侧信息栏" },
      { id: "D-007@v1", title: "归档态 tab 集自适应收窄" },
      { id: "D-008@v1", title: "实现路径 = 原型驱动全量重写" },
      { id: "D-009@v1", title: "与本次冲突的活需求显式取代并落盘" },
    ],
  },
  {
    title: "知识触达",
    source: "执行期 CLI 注入命中留痕",
    total: 24,
    rows: [
      { id: "modules/frontend.md", title: "变更详情页组件族与 page.tsx 编排边界" },
      { id: "modules/frontend_components.md", title: "detail/ 子目录 — 变更详情展示组件族" },
      { id: "scan/FRONTEND_PAGE_STYLE.md", title: "§13 primer 组件库与消费纪律" },
      { id: "scan/PROTOTYPE.md", title: "原型即实现管线（页面类/流程类/规则类）" },
      { id: "modules/sillyspec.md", title: "活需求索引与取代链语义" },
    ],
  },
  {
    title: "测试绑定",
    source: "test-trace",
    total: 5,
    rows: [
      { id: "变更内 task-02", title: "change-tabs.test.tsx" },
      { id: "变更内 task-04", title: "merge-timeline.test.tsx" },
      { id: "变更内 task-05", title: "overview-sidebar.test.tsx" },
      { id: "变更内 task-07", title: "archived-tabs.test.tsx" },
    ],
  },
  {
    title: "模块触达",
    source: "3 个模块",
    total: 3,
    rows: [
      { id: "frontend", title: "frontend · multi-agent-platform" },
      { id: "docs", title: "docs · multi-agent-platform" },
      { id: "sillyspec", title: "sillyspec · multi-agent-platform" },
    ],
  },
];

const ARCHIVE_LEDGER = {
  patch: "26 文件 +1820 / −430",
  delta: "Before 6,412 行 / Delta 1,260 行",
  files: [
    "frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx",
    "frontend/src/components/changes/detail/change-tabs.tsx",
    "frontend/src/components/changes/detail/change-overview-panel.tsx",
    "frontend/src/components/changes/detail/change-unified-timeline.tsx",
  ],
};

const SCOPE_AUDIT = {
  planned: 12,
  unplanned: 1,
  untouched: 2,
  repos: [
    { name: "主仓", anchor: "a1b2c3d", planned: 10, unplanned: 1, untouched: 1, diff: "16 文件 +1,204 / −318" },
    { name: "docs", anchor: "7f8e9a0", planned: 2, unplanned: 0, untouched: 1, diff: "4 文件 +96 / −12" },
  ],
};

const QUICKLOG_ROWS = [
  { status: "已完成", title: "变更详情页头部描述单行截断", at: "10/14 18:22" },
  { status: "已完成", title: "沉淀资产卡图谱分区高度自适应", at: "10/15 09:41" },
  { status: "进行中", title: "变更详情页 tab 与深链对齐", at: "10/15 23:10" },
];

const FILE_TREE = [
  { depth: 0, name: "frontend/src/components/changes/detail", kind: "dir" },
  { depth: 1, name: "change-tabs.tsx", kind: "add", stat: "+182" },
  { depth: 1, name: "change-unified-timeline.tsx", kind: "add", stat: "+264" },
  { depth: 1, name: "change-overview-panel.tsx", kind: "add", stat: "+198" },
  { depth: 1, name: "change-assets-card.tsx", kind: "mod", stat: "+64 / −312" },
  { depth: 1, name: "change-step-timeline.tsx", kind: "del", stat: "−322" },
  { depth: 1, name: "change-timeline-card.tsx", kind: "del", stat: "−296" },
];

const GRAPH_NODES = [
  { x: 170, y: 128, r: 18, type: 0, label: "变更" },
  { x: 348, y: 82, r: 12, type: 1, label: "FR-02" },
  { x: 392, y: 208, r: 12, type: 1, label: "FR-05" },
  { x: 112, y: 250, r: 12, type: 2, label: "D-002" },
  { x: 262, y: 272, r: 10, type: 3, label: "frontend" },
  { x: 486, y: 138, r: 10, type: 3, label: "docs" },
  { x: 508, y: 258, r: 9, type: 4, label: "测试" },
] as const;

const GRAPH_EDGES = [
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [2, 6],
] as const;

const GRAPH_NEIGHBORS = [
  { kind: "FR", dir: "出", label: "FR-02 详情页主体为四 tab" },
  { kind: "FR", dir: "出", label: "FR-05 两条时间线合并" },
  { kind: "决策", dir: "出", label: "D-002@v1 顶部四 Tab 分区" },
  { kind: "模块", dir: "入", label: "frontend 模块触达" },
  { kind: "文档", dir: "入", label: "scan/PROTOTYPE.md" },
];

// ── 原子件 ─────────────────────────────────────────────────────────────────

function Card({
  title,
  extra,
  children,
  className,
}: {
  title?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border bg-card ${className ?? ""}`}
      style={{ borderColor: "hsl(var(--border))" }}
    >
      {title ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 border-b px-3.5 py-2.5"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <h2 className="text-sm font-semibold">{title}</h2>
          {extra}
        </div>
      ) : null}
      <div className="px-3.5 py-3">{children}</div>
    </section>
  );
}

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "brand" }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] ${tone === "brand" ? "border-brand-300 bg-brand-500/10 text-brand-600" : "text-muted-foreground"}`}
      style={tone === "brand" ? undefined : { borderColor: "hsl(var(--border))" }}
    >
      {children}
    </span>
  );
}

function MetaRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className="min-w-0 truncate text-right font-mono">{v}</span>
    </div>
  );
}

function GhostButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className="h-7 rounded-md border px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      {children}
    </button>
  );
}

/** 阶段条（声明式替代 production change-stage-header.tsx，见文件头声明①）。 */
function StageBar({ archived }: { archived: boolean }) {
  const stages = archived ? STAGES_ARCHIVED : STAGES_ACTIVE;
  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-1 rounded-lg border bg-card px-3.5 py-2.5"
      style={{ borderColor: "hsl(var(--border))" }}
    >
      {stages.map((s, i) => (
        <React.Fragment key={s.key}>
          {i > 0 ? (
            <span
              aria-hidden="true"
              className="mx-1.5 h-px w-5"
              style={{ backgroundColor: "hsl(var(--border))" }}
            />
          ) : null}
          <span className="flex items-center gap-1.5 text-sm">
            {s.state === "done" ? (
              <StateIcon name="check" size={14} className="text-success" />
            ) : s.state === "current" ? (
              <StateIcon name="openCircle" size={14} className="text-brand-600" />
            ) : (
              <StateIcon name="clock" size={14} className="text-muted-foreground" />
            )}
            <span className={s.state === "current" ? "font-semibold" : "text-muted-foreground"}>
              {s.label}
            </span>
            {s.state === "current" ? <span className="text-xs text-muted-foreground">进行中</span> : null}
          </span>
        </React.Fragment>
      ))}
      <span className="ml-auto text-[11px] text-muted-foreground">
        当前阶段: {archived ? "10-16 03:20" : "10-16 01:52"}
      </span>
    </div>
  );
}

/** 首屏待办卡（在途态、且当前有待办时渲染；无待办则整卡不渲染）。 */
function TodoCard() {
  return (
    <Card title="现在需要你">
      <div className="flex flex-col gap-2">
        <p className="text-sm">自动验证通过，请人工测试</p>
        <p className="text-xs text-muted-foreground">
          绑定会话：<span className="font-mono">sess-ff095390</span> · 进行中 · 最近活跃 3 分钟前
        </p>
        <textarea
          rows={2}
          placeholder="审核意见（可选）"
          className="w-full rounded-md border bg-background px-2.5 py-1.5 text-xs outline-none"
          style={{ borderColor: "hsl(var(--border))" }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
          >
            通过并通知绑定会话
          </button>
          <button
            type="button"
            className="h-8 rounded-md border px-3 text-sm"
            style={{ borderColor: "hsl(var(--destructive))", color: "hsl(var(--destructive))" }}
          >
            打回并通知绑定会话
          </button>
        </div>
      </div>
    </Card>
  );
}

/** 概览右侧信息栏（D-006：用量/会话/对账/产出计数压缩为元信息）。 */
function OverviewSide({ archived }: { archived: boolean }) {
  return (
    <MetaPanel className="w-full">
      <MetaPanelSection title="基本信息">
        <MetaRow k="变更 key" v={<span className="text-[10px]">{CHANGE.key}</span>} />
        <MetaRow k="类型" v={CHANGE.type} />
        <MetaRow k="创建" v={CHANGE.createdAt} />
        <MetaRow k="负责人" v={CHANGE.owner} />
      </MetaPanelSection>
      <MetaPanelSection title={archived ? "执行用量（合计）" : "执行用量"}>
        {USAGE.map((u) => (
          <MetaRow key={u.k} k={u.k} v={u.v} />
        ))}
        {archived ? null : (
          <div className="pt-1">
            <button type="button" className="text-xs text-muted-foreground hover:underline">
              按模型明细 ▾
            </button>
          </div>
        )}
      </MetaPanelSection>
      <MetaPanelSection title="会话">
        {SESSIONS.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
            <a href="#sessions" className="truncate font-mono text-primary hover:underline">
              {s.id}
            </a>
            <span className="shrink-0 text-muted-foreground">
              {s.status} · {s.at}
            </span>
          </div>
        ))}
        <div className="pt-1">
          <a href="#sessions" className="text-xs text-primary hover:underline">
            打开会话工作台 →
          </a>
        </div>
      </MetaPanelSection>
      <MetaPanelSection title="范围对账">
        <MetaRow k="计划内" v={SCOPE_AUDIT.planned} />
        <MetaRow k="计划外" v={SCOPE_AUDIT.unplanned} />
        <MetaRow k="计划未动" v={SCOPE_AUDIT.untouched} />
        <div className="pt-1">
          {/* 归档态「文件与对账」tab 不渲染（D-007）——入口改指「产出 · 归档留档」，不留悬空链接 */}
          {archived ? (
            <a href="#assets" className="text-xs text-primary hover:underline">
              真实改动面见 产出 · 归档留档 →
            </a>
          ) : (
            <a href="#files" className="text-xs text-primary hover:underline">
              查看明细 →
            </a>
          )}
        </div>
      </MetaPanelSection>
      <MetaPanelSection title="产出速览">
        <MetaRow k="需求规则" v="8" />
        <MetaRow k="决策蒸馏" v="13" />
        <MetaRow k="知识触达" v="24" />
        <MetaRow k="改动文件" v="26" />
        <div className="pt-1">
          <a href="#assets" className="text-xs text-primary hover:underline">
            查看产出 →
          </a>
        </div>
      </MetaPanelSection>
    </MetaPanel>
  );
}

/** 概览用最近动态（轻量行，倒序；不复制过程 tab 的筛选器与合并口径）。 */
function RecentRows({ rows }: { rows: typeof RECENT_ROWS }) {
  return (
    <div className="flex flex-col">
      {rows.map((r, i) => (
        <div
          key={`${r.at}-${i}`}
          className="flex items-center gap-2 border-b py-1.5 last:border-b-0"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          {r.icon === "check" ? (
            <StateIcon name="check" size={14} className="text-success" />
          ) : r.icon === "openCircle" ? (
            <StateIcon name="openCircle" size={14} className="text-brand-600" />
          ) : (
            <StateIcon name="clock" size={14} className="text-muted-foreground" />
          )}
          <span className="min-w-0 truncate text-xs">{r.title}</span>
          <Chip>{r.stage}</Chip>
          <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{r.at}</span>
        </div>
      ))}
    </div>
  );
}

/** 统一过程时间线（D-005：两源合并为一行一事件）。 */
function UnifiedTimeline({ rows }: { rows: typeof TIMELINE_ROWS }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tone="brand">全部 12</Chip>
        <Chip>需求分析 2</Chip>
        <Chip>规划 3</Chip>
        <Chip>执行 6</Chip>
        <Chip>验证 1</Chip>
        <Chip>归档 0</Chip>
        <span className="ml-auto text-[11px] text-muted-foreground">
          点击阶段可筛选；与上方阶段条联动
        </span>
      </div>
      <Timeline>
        {rows.map((r, i) => (
          <TimelineItem
            key={`${r.at}-${i}`}
            icon={
              r.icon === "check" ? (
                <StateIcon name="check" size={14} />
              ) : r.icon === "openCircle" ? (
                <StateIcon name="openCircle" size={14} />
              ) : (
                <StateIcon name="clock" size={14} />
              )
            }
            tone={r.tone}
            title={
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{r.title}</span>
                <Chip>{r.stage}</Chip>
                <Chip>{r.src}</Chip>
                {r.commit ? (
                  <span className="font-mono text-[11px] text-brand-600">{r.commit}</span>
                ) : null}
              </span>
            }
            time={r.at}
          >
            {r.detail ? r.detail : undefined}
          </TimelineItem>
        ))}
      </Timeline>
      <p className="text-[11px] text-muted-foreground">
        合并口径：源内按稳定键去重（步骤=阶段+序位、事件=时间+类型+文本）；task-done 事件不单独成行——
        任务行的勾选时刻本就由该事件推断而来（同一份数据），任务面统一由下方「任务进度」清单承载；
        步骤行与任务行**不做合并**（二者粒度不同，合并需名称/时间近似匹配，属脆弱启发式）；两源独有字段（步骤侧：阶段分组、等待原因、输出全文；事件侧：提交哈希与标题、文件变更/配置变更事件、墙钟）全保留。
      </p>
    </div>
  );
}

/** 任务进度清单（tasks.md 勾选态 + 推断勾选时刻 + 提交锚）。 */
function TaskChecklist() {
  const total = TASK_ROWS.length;
  const checked = TASK_ROWS.filter((t) => t.checked).length;
  return (
    <Card
      title="任务进度"
      extra={
        <span className="text-[11px] text-muted-foreground">
          勾选 {checked}/{total} · 勾选时间 ≈ 为推断值
        </span>
      }
    >
      <div className="flex flex-col">
        {TASK_ROWS.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2 border-b py-1.5 last:border-b-0"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            <span className="w-4 shrink-0 text-center text-xs">{t.checked ? "☑" : "☐"}</span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{t.id}</span>
            <span className="min-w-0 truncate text-xs">{t.desc}</span>
            {t.sha ? <span className="shrink-0 font-mono text-[11px] text-brand-600">{t.sha}</span> : null}
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{t.at || ""}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** 知识图谱独立分区（D-003；画布为声明式替代，见文件头声明②）。 */
function GraphSection() {
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <span>知识图谱 · 本变更邻域</span>
          <Chip>独立分区</Chip>
        </span>
      }
      extra={
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">层级</span>
          <Chip tone="brand">1 跳</Chip>
          <Chip>2 跳</Chip>
          <Chip>3 跳</Chip>
          <span className="text-[11px] text-muted-foreground">· {GRAPH_NODES.length} 节点 · {GRAPH_EDGES.length} 边</span>
        </span>
      }
    >
      <div className="flex flex-col gap-3 md:flex-row">
        <div
          className="relative min-h-[300px] flex-1 overflow-hidden rounded-md border"
          style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--muted))" }}
        >
          <svg viewBox="0 0 620 310" className="h-[300px] w-full" role="img" aria-label="知识图谱邻域示意">
            {GRAPH_EDGES.map(([a, b]) => (
              <line
                key={`${a}-${b}`}
                x1={GRAPH_NODES[a].x}
                y1={GRAPH_NODES[a].y}
                x2={GRAPH_NODES[b].x}
                y2={GRAPH_NODES[b].y}
                stroke="hsl(var(--border))"
                strokeWidth="1.5"
              />
            ))}
            {GRAPH_NODES.map((n) => (
              <g key={n.label}>
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                  fill={["var(--color-brand-600)", "var(--color-brand-400)", "hsl(var(--success))", "var(--color-brand-300)", "hsl(var(--muted-foreground))"][n.type]}
                />
                <text x={n.x} y={n.y + n.r + 11} textAnchor="middle" fontSize="9" fill="hsl(var(--muted-foreground))">
                  {n.label}
                </text>
              </g>
            ))}
          </svg>
          <span className="absolute bottom-2 right-2 text-[10px] text-muted-foreground">
            示意占位 · 接线替换为生产 GraphCanvas
          </span>
        </div>
        <div
          className="w-full shrink-0 rounded-md border px-3 py-2.5 md:w-[260px]"
          style={{ borderColor: "hsl(var(--border))" }}
        >
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--color-brand-600)" }} />
            <span className="text-xs font-medium">变更 · 2026-10-15-change-detail-redesign</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            节点详情 · 与图谱页 detail 同型（类型中文标签 + 等宽 ID + 邻居分组）
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {GRAPH_NEIGHBORS.map((n) => (
              <div key={n.label} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  <Chip>{n.kind}</Chip>
                  <span className="truncate">{n.label}</span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{n.dir}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

/** 资产分组（2 列网格，自然高度 + 上限收起；取代固定 h-64 内滚网格）。 */
function AssetGroup({ group }: { group: (typeof ASSET_GROUPS)[number] }) {
  const shown = group.rows.slice(0, 5);
  return (
    <div className="rounded-md border" style={{ borderColor: "hsl(var(--border))" }}>
      <div
        className="flex items-center justify-between gap-2 border-b px-3 py-2"
        style={{ borderColor: "hsl(var(--border))" }}
      >
        <h3 className="text-xs font-semibold">
          {group.title} <Counter count={group.total} />
        </h3>
        <span className="truncate text-[11px] text-muted-foreground">{group.source}</span>
      </div>
      <div>
        {shown.map((r) => (
          <IssueRow
            key={r.id}
            state="done"
            title={
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-[11px] text-brand-600">{r.id}</span>
                <span className="truncate text-xs">{r.title}</span>
              </span>
            }
            right={null}
          />
        ))}
      </div>
      {group.total > shown.length ? (
        <div className="border-t px-3 py-1.5" style={{ borderColor: "hsl(var(--border))" }}>
          <button type="button" className="text-[11px] text-muted-foreground hover:underline">
            展开全部 {group.total} 条 ▾
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 归档留档（归档态首屏与产出 tab 复用；在途态不渲染，D-001）。 */
function ArchiveLedger() {
  return (
    <Card title="归档留档" extra={<span className="text-[11px] text-muted-foreground">change.patch（收尾时点冻结）</span>}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
          <span>
            patch：<span className="font-mono">{ARCHIVE_LEDGER.patch}</span>
          </span>
          <span className="text-muted-foreground">
            delta：<span className="font-mono">{ARCHIVE_LEDGER.delta}</span>
          </span>
        </div>
        <IssueRowHeader title="改动文件（点开看该文件 diff）" right="diff" />
        {ARCHIVE_LEDGER.files.map((f) => (
          <IssueRow
            key={f}
            state="done"
            title={<span className="truncate font-mono text-[11px]">{f}</span>}
            right={
              <button type="button" className="text-[11px] text-primary hover:underline">
                看 diff
              </button>
            }
          />
        ))}
      </div>
    </Card>
  );
}

// ── 四个 tab 面板 ──────────────────────────────────────────────────────────

function OverviewPanel({ archived }: { archived: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_288px]">
      <div className="flex flex-col gap-3">
        {archived ? null : <TodoCard />}
        <Card
          title={archived ? "成果总结" : "变更摘要"}
          extra={
            <span className="text-[11px] text-muted-foreground">
              {archived ? "已归档" : "非终态每 10 秒自动刷新"}
            </span>
          }
        >
          <StatGrid
            items={
              archived
                ? [
                    { label: "需求规则", value: "8", tone: "brand" },
                    { label: "决策蒸馏", value: "13" },
                    { label: "改动文件", value: "26" },
                    { label: "净增行", value: "+1820 / −430" },
                  ]
                : [
                    { label: "当前阶段", value: "验证", tone: "brand" },
                    { label: "任务进度", value: "13 / 13" },
                    { label: "已用时长", value: "5.4h" },
                    { label: "最后信号", value: "2 分钟前" },
                  ]
            }
          />
          {archived ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              墙钟 5 小时 8 分 · 观测事件 128 条 · 提交 14 次 · 归档于 10-16 03:20
            </p>
          ) : null}
        </Card>
        {archived ? <ArchiveLedger /> : null}
        <Card
          title={archived ? "最终动态" : "最近动态"}
          extra={
            <a href="#process" className="text-[11px] text-primary hover:underline">
              查看全部 →
            </a>
          }
        >
          <RecentRows rows={archived ? FINAL_ROWS : RECENT_ROWS} />
        </Card>
      </div>
      <OverviewSide archived={archived} />
    </div>
  );
}

function AssetsPanel({ archived }: { archived: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <GraphSection />
      <div className="grid gap-3 md:grid-cols-2">
        {ASSET_GROUPS.map((g) => (
          <AssetGroup key={g.title} group={g} />
        ))}
        {archived ? <ArchiveLedger /> : null}
      </div>
    </div>
  );
}

function ProcessPanel({ archived }: { archived: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <Card
        title="统一过程时间线"
        extra={<span className="text-[11px] text-muted-foreground">步骤 + 事件两源合流 · {TIMELINE_ROWS.length} 条</span>}
      >
        <UnifiedTimeline rows={TIMELINE_ROWS} />
      </Card>
      <TaskChecklist />
      <Card title="阶段耗时">
        <StatGrid
          items={[
            { label: "需求分析", value: "1.2h" },
            { label: "规划", value: "0.6h" },
            { label: "执行", value: "3.4h", tone: "brand" },
            { label: "验证", value: archived ? "0.2h" : "进行中" },
            { label: "归档", value: archived ? "0.1h" : "—" },
          ]}
        />
      </Card>
      <Card
        title="展开态示意"
        extra={<span className="text-[11px] text-muted-foreground">离线产物中「展开详情」点击无效</span>}
      >
        <div
          className="whitespace-pre-wrap rounded-md border px-3 py-2 font-mono text-xs leading-5"
          style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--muted))" }}
        >
          {"> 修改 frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx\n> 新增 change-tabs.tsx / change-unified-timeline.tsx\n> 测试 148 passed · tsc 0 · eslint 0"}
        </div>
      </Card>
    </div>
  );
}

function FilesPanel() {
  return (
    <div className="flex flex-col gap-3">
      <Card
        title="变更文件"
        extra={<span className="text-[11px] text-muted-foreground">文件树直接内嵌（不再只给「打开」按钮）</span>}
      >
        <div className="flex flex-col gap-3 lg:flex-row">
          <div
            className="w-full shrink-0 rounded-md border py-1.5 lg:w-[300px]"
            style={{ borderColor: "hsl(var(--border))" }}
          >
            {FILE_TREE.map((f) => (
              <div
                key={f.name}
                className={`flex items-center justify-between gap-2 px-2.5 py-1 font-mono text-[11px] ${f.kind === "dir" ? "text-muted-foreground" : "hover:bg-muted"}`}
                style={{ paddingLeft: `${10 + f.depth * 14}px` }}
              >
                <span className="truncate">{f.name}</span>
                <span
                  className="shrink-0 text-[10px]"
                  style={{
                    color:
                      f.kind === "add"
                        ? "hsl(var(--success))"
                        : f.kind === "del"
                          ? "hsl(var(--destructive))"
                          : "hsl(var(--muted-foreground))",
                  }}
                >
                  {f.stat ?? ""}
                </span>
              </div>
            ))}
          </div>
          <div
            className="min-h-[240px] flex-1 rounded-md border px-3 py-2.5"
            style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--muted))" }}
          >
            <p className="text-xs text-muted-foreground">点左侧文件在此处预览内容 / diff（复用既有 ChangeFileTree + FilePreview）。</p>
          </div>
        </div>
      </Card>
      <Card
        title="范围对账（scope-audit）"
        extra={
          <span className="flex items-center gap-1.5">
            <Chip>✓ 计划内 {SCOPE_AUDIT.planned}</Chip>
            <Chip tone="brand">⚠️ 计划外 {SCOPE_AUDIT.unplanned}</Chip>
            <Chip>⚠️ 计划未动 {SCOPE_AUDIT.untouched}</Chip>
            <GhostButton>查看明细（{SCOPE_AUDIT.planned + SCOPE_AUDIT.unplanned + SCOPE_AUDIT.untouched}）</GhostButton>
          </span>
        }
      >
        <div className="flex flex-col gap-2">
          {SCOPE_AUDIT.repos.map((r) => (
            <div
              key={r.name}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
              style={{ borderColor: "hsl(var(--border))" }}
            >
              <span className="flex items-center gap-2 text-xs">
                <span className={r.name === "主仓" ? "font-medium text-brand-600" : "font-medium"}>{r.name}</span>
                <Chip>锚点 {r.anchor}</Chip>
                <Chip>✓ {r.planned}</Chip>
                <Chip>⚠️ {r.unplanned}</Chip>
                <Chip>未动 {r.untouched}</Chip>
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">{r.diff}</span>
            </div>
          ))}
          <div className="pt-1">
            <button type="button" className="text-[11px] text-muted-foreground hover:underline">
              本地命令（表格版 / JSON 版）▾
            </button>
          </div>
        </div>
      </Card>
      <Card title="关联的快速任务" extra={<Counter count={QUICKLOG_ROWS.length} />}>
        <div className="flex flex-col">
          {QUICKLOG_ROWS.map((q) => (
            <IssueRow
              key={q.title}
              state={q.status === "已完成" ? "done" : "open"}
              title={
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-xs">{q.title}</span>
                  <Chip>{q.status}</Chip>
                </span>
              }
              right={<span className="text-[11px]">{q.at}</span>}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── 单态主体（tab 组）────────────────────────────────────────────────────

type DetailTab = "overview" | "assets" | "process" | "files";

const TAB_LABELS: Record<DetailTab, string> = {
  overview: "概览",
  assets: "产出",
  process: "过程",
  files: "文件与对账",
};

function StateBody({ archived }: { archived: boolean }) {
  // D-007：归档态收窄 tab 集（隐藏「文件与对账」——归档时与归档留档重复）
  const tabs: DetailTab[] = archived
    ? ["overview", "assets", "process"]
    : ["overview", "assets", "process", "files"];
  const panels: Record<DetailTab, React.ReactNode> = {
    overview: <OverviewPanel archived={archived} />,
    assets: <AssetsPanel archived={archived} />,
    process: <ProcessPanel archived={archived} />,
    files: <FilesPanel />,
  };
  return (
    <div className="mt-4 flex flex-col gap-4" data-detail-tabs="">
      <UnderlineNav<DetailTab>
        items={tabs.map((t) => ({ key: t, label: TAB_LABELS[t] }))}
        value="overview"
        onChange={() => undefined}
      />
      {tabs.map((t) => (
        <div key={t} data-detail-panel="">
          {panels[t]}
        </div>
      ))}
    </div>
  );
}

// ── 视图主体 ───────────────────────────────────────────────────────────────

function ChromeBar() {
  const cls =
    "rounded-md border px-2.5 py-1 text-xs transition-colors hover:bg-muted";
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 border-b px-6 py-2 text-xs text-muted-foreground"
      style={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}
    >
      <span>
        原型 chrome · 切换变更状态（真实页面按变更状态自动分叉渲染，无此开关）：
        <span className="ml-1 text-muted-foreground/80">
          tab 栏与内容随状态变化；归档态隐藏「文件与对账」
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        <button type="button" data-state-btn="active" className={cls} style={{ borderColor: "hsl(var(--border))" }}>
          在途变更
        </button>
        <button type="button" data-state-btn="archived" className={cls} style={{ borderColor: "hsl(var(--border))" }}>
          已归档
        </button>
      </span>
    </div>
  );
}

export function ChangeDetailV2View() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <DemoBar />
      <ChromeBar />
      <main className="mx-auto max-w-6xl px-6 py-6">
        <PageHead
          breadcrumb={
            <span className="flex items-center gap-1.5">
              <span>SillyHub</span>
              <span className="text-muted-foreground/60">/</span>
              <span>multi-agent-platform</span>
              <span className="text-muted-foreground/60">/</span>
              <a href="#changes" className="hover:underline">
                变更
              </a>
              <span className="text-muted-foreground/60">/</span>
              <span className="text-foreground">{CHANGE.title}</span>
            </span>
          }
          title={CHANGE.title}
          titleExtra={
            <span className="flex items-center gap-2">
              <span data-state-panel="active">
                <StateLabel variant="open" size="md">
                  进行中
                </StateLabel>
              </span>
              <span data-state-panel="archived" style={{ display: "none" }}>
                <StateLabel variant="merged" size="md">
                  已归档
                </StateLabel>
              </span>
            </span>
          }
          subtitle={
            <span className="flex flex-wrap gap-x-4 gap-y-0.5">
              <span className="font-mono text-xs">{CHANGE.key}</span>
              <span>类型: {CHANGE.type}</span>
              <span>创建: {CHANGE.createdAt}</span>
              <span>负责人: {CHANGE.owner}</span>
              <span>影响: {CHANGE.affected}</span>
              <span className="w-full min-w-0 truncate text-muted-foreground">{CHANGE.description}</span>
            </span>
          }
          actions={
            <>
              <GhostButton>删除</GhostButton>
              {/* 归档态无「继续执行」（D-001：归档不为在途语义留位） */}
              <span data-state-panel="active">
                <button
                  type="button"
                  className="h-8 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
                >
                  继续执行
                </button>
              </span>
            </>
          }
        />
        <div data-state-panel="active">
          <StageBar archived={false} />
          <StateBody archived={false} />
        </div>
        <div data-state-panel="archived" style={{ display: "none" }}>
          <StageBar archived />
          <StateBody archived />
        </div>
      </main>
    </div>
  );
}
