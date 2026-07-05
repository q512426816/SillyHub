// task-07 / FR-09 / D-001@v1 / D-002@v1：工具种类徽标映射。
//
// 14 枚举（与 backend TOOL_KIND_VALUES / sillyhub-daemon tool_kind.ts 严格对齐，修改须三端同步）
// → { label(中文 ≤3 字), Icon(lucide-react), badgeClass(tailwind border-200/bg-50/text-700) }。
//
// 配色策略（design §5 Phase 3 / 验收：与现有 SemanticCategory 视觉协调不撞色）：
// 避开已占用色 —— user 紫(violet) / ask 琥珀(amber) / assistant+result 天蓝(sky) /
// tool_call 蓝(blue) / tool_result+success 绿(emerald-700 已用于返回徽标) /
// error 红(red) / thinking 灰(zinc)。工具徽标按下表错开分配：
//
//   sillyspec → 紫红(fuchsia)   skill    → 玫红(rose)     bash   → 蓝绿(teal)
//   read     → 青(cyan)         write    → 翠绿(green)    search → 靛(indigo)
//   task     → 橙(orange)       web      → 天蓝(sky)*     todo   → 黄(yellow)
//   plan     → 紫(violet)*      ask      → 粉(pink)       schedule→ 石板(slate)
//   mcp      → 锌(zinc)         other    → 锌(zinc)
//
//   * 注：web 用 sky 与 assistant sky 同色族但工具徽标带 Icon 可区分；plan 用 violet
//     与 user violet 同族但场景不同（user 是 channel=user_input，plan 是 tool_kind）。
//     如需进一步错开，web 可降级 cyan，plan 可降级 purple（保留此处为 design 原始方案）。
//
// null/undefined/未知 kind → 灰色兜底「工具」（Wrench 图标），与 semanticCategoryMeta
// tool_call 蓝徽标区别：本兜底用于 tool_kind 缺失（历史日志），tool_call 蓝徽标用于
// channel 维度（语义分类），两者渲染层级不同（task-08 viewer 在工具卡片内用本映射）。
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  CalendarClock,
  CircleDot,
  Compass,
  FileText,
  Globe,
  ListTodo,
  MessageSquareText,
  Pencil,
  Plug,
  Search,
  Sparkles,
  Terminal,
  Wrench,
  Zap,
} from "lucide-react";

export interface ToolKindMeta {
  /** 中文标签，≤3 字以适配徽标固定宽度（参照 semanticCategoryMeta ≤2 字约定放宽）。 */
  label: string;
  /** lucide-react 图标组件。 */
  Icon: LucideIcon;
  /** tailwind 徽标类名（border-{c}-200 bg-{c}-50 text-{c}-700 风格）。 */
  badgeClass: string;
}

/**
 * 14 枚举 → 徽标元数据。key 必须与 backend TOOL_KIND_VALUES 一一对应。
 *
 * 枚举顺序对齐 backend/app/modules/agent/tool_kind.py: TOOL_KIND_VALUES。
 */
export const TOOL_KIND_META: Record<string, ToolKindMeta> = {
  sillyspec: {
    label: "SillySpec",
    Icon: Sparkles,
    badgeClass: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  },
  skill: {
    label: "技能",
    Icon: Zap,
    badgeClass: "border-rose-200 bg-rose-50 text-rose-700",
  },
  bash: {
    label: "命令行",
    Icon: Terminal,
    badgeClass: "border-teal-200 bg-teal-50 text-teal-700",
  },
  read: {
    label: "读文件",
    Icon: FileText,
    badgeClass: "border-cyan-200 bg-cyan-50 text-cyan-700",
  },
  write: {
    label: "写文件",
    Icon: Pencil,
    badgeClass: "border-green-200 bg-green-50 text-green-700",
  },
  search: {
    label: "搜索",
    Icon: Search,
    badgeClass: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  task: {
    label: "子任务",
    Icon: Bot,
    badgeClass: "border-orange-200 bg-orange-50 text-orange-700",
  },
  web: {
    label: "网搜",
    Icon: Globe,
    badgeClass: "border-sky-200 bg-sky-50 text-sky-700",
  },
  todo: {
    label: "清单",
    Icon: ListTodo,
    badgeClass: "border-yellow-200 bg-yellow-50 text-yellow-700",
  },
  plan: {
    label: "计划",
    Icon: Compass,
    badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
  },
  ask: {
    label: "提问",
    Icon: MessageSquareText,
    badgeClass: "border-pink-200 bg-pink-50 text-pink-700",
  },
  schedule: {
    label: "定时",
    Icon: CalendarClock,
    badgeClass: "border-slate-200 bg-slate-50 text-slate-700",
  },
  mcp: {
    label: "MCP",
    Icon: Plug,
    badgeClass: "border-zinc-200 bg-zinc-50 text-zinc-700",
  },
  other: {
    label: "其他",
    Icon: CircleDot,
    badgeClass: "border-zinc-200 bg-zinc-50 text-zinc-700",
  },
};

/** 灰色兜底（null/undefined/未知 kind）。 */
const TOOL_KIND_FALLBACK: ToolKindMeta = {
  label: "工具",
  Icon: Wrench,
  badgeClass: "border-zinc-200 bg-zinc-50 text-zinc-500",
};

/**
 * 取 tool_kind 徽标元数据。
 *
 * - null / undefined / 未知 kind（不在 TOOL_KIND_META）→ 灰色兜底「工具」
 * - 已知 kind（14 枚举之一）→ 对应徽标
 *
 * 用于 task-08 viewer 工具卡片渲染（design §5 Phase 4）。
 */
export function toolKindMeta(kind: string | null | undefined): ToolKindMeta {
  if (!kind) return TOOL_KIND_FALLBACK;
  return TOOL_KIND_META[kind] ?? TOOL_KIND_FALLBACK;
}
