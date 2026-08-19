/**
 * 工作区类型词表与徽标 helper（前端单一事实源）。
 *
 * task-05 / 2026-08-18-workspace-role-type / design §5.1+§5.4 / FR-01 / FR-04 /
 * D-002@v1：Workspace.type 收成 8 值受控词表（后端 constants.py
 * WORKSPACE_TYPE_VALUES + WorkspaceTypeLiteral，经 gen:types 进 api-types 枚举）。
 * 本文件提供：
 *   - WorkspaceType：从 api-types 的 WorkspaceCreate.type 派生的 8 值联合（禁手抄；
 *     后端加值 → gen:types → 此处联合自动跟上，词表漂移由 tsc 暴露）
 *   - WORKSPACE_TYPE_OPTIONS：value + 中文 label + badgeClass 8 项（创建弹窗 /
 *     筛选下拉共用；task-06/07/08 一律从此导入，禁止组件内重复硬编码）
 *   - UNCLASSIFIED_OPTION：「未分类」展示项（type 为 NULL 的工作区；筛选走
 *     ?unclassified=true 谓词，D-005@v1——?type= 等值匹配表达不了 NULL）
 *   - workspaceTypeBadge：徽标渲染统一入口——NULL/undefined/空串 → 灰色「未分类」；
 *     已知值 → 词表项；未知非空值 → 原值灰徽标（存量脏数据不崩，design §9）
 *
 * badgeClass 只含配色（border-{c}-200 bg-{c}-50 text-{c}-700，风格对齐
 * components/agent-log/tool-kind-meta.ts 的徽标约定），布局类（inline-flex
 * rounded border px-1.5 …）由消费方叠加；灰阶兜底用 text-zinc-500——比已知值
 * 的 -700 更弱一档，与 tool-kind-meta 的 fallback 同款（other 已知值用 -700，
 * 未分类/未知兜底用 -500，弱化「没有类型」的视觉权重）。
 *
 * author: qinyi  created_at: 2026-08-19  change: 2026-08-18-workspace-role-type（task-05）
 */
import type { components } from "@/lib/api-types";

/**
 * 工作区类型 8 值联合——从 OpenAPI 生成类型派生（WorkspaceCreate.type 为必填
 * 枚举，gen:types 产物），与 backend/app/modules/workspace/constants.py 的
 * WORKSPACE_TYPE_VALUES 逐字对齐。禁止在此手抄字面量联合。
 */
export type WorkspaceType = components["schemas"]["WorkspaceCreate"]["type"];

/** 词表项：下拉选项与徽标元数据共用形态。 */
export interface WorkspaceTypeOption {
  /** 8 值词表之一（与后端 Literal 逐字一致）。 */
  value: WorkspaceType;
  /** 中文标签（UI 展示，CLAUDE.md 规则：UI 默认中文）。 */
  label: string;
  /** 徽标配色类名（仅配色，布局类由消费方叠加，见文件头注释）。 */
  badgeClass: string;
}

/**
 * 8 值受控词表（顺序对齐后端 constants.py WORKSPACE_TYPE_VALUES）。
 *
 * 配色分配参照 tool-kind-meta.ts 的错开策略（同文件内 8 色互不重复；
 * other 用中性 zinc-700 与灰阶兜底 zinc-500 区分一档）：
 *   前端 sky / 后端 teal / 全栈 violet / 业务文档 amber /
 *   子模块 indigo / 部署运维 orange / 设计资产 fuchsia / 其他 zinc
 */
export const WORKSPACE_TYPE_OPTIONS: readonly WorkspaceTypeOption[] = [
  {
    value: "frontend-code",
    label: "前端代码",
    badgeClass: "border-sky-200 bg-sky-50 text-sky-700",
  },
  {
    value: "backend-code",
    label: "后端代码",
    badgeClass: "border-teal-200 bg-teal-50 text-teal-700",
  },
  {
    value: "fullstack",
    label: "全栈代码",
    badgeClass: "border-violet-200 bg-violet-50 text-violet-700",
  },
  {
    value: "business-doc",
    label: "业务文档",
    badgeClass: "border-amber-200 bg-amber-50 text-amber-700",
  },
  {
    value: "submodule",
    label: "子模块",
    badgeClass: "border-indigo-200 bg-indigo-50 text-indigo-700",
  },
  {
    value: "deploy-ops",
    label: "部署运维",
    badgeClass: "border-orange-200 bg-orange-50 text-orange-700",
  },
  {
    value: "design-asset",
    label: "设计资产",
    badgeClass: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  },
  {
    value: "other",
    label: "其他",
    badgeClass: "border-zinc-200 bg-zinc-50 text-zinc-700",
  },
];

/** 「未分类」展示项（灰阶兜底配色）。 */
export interface UnclassifiedOption {
  /** null 表示「type IS NULL」筛选语义（消费方映射为 ?unclassified=true，D-005@v1）。 */
  value: null;
  /** 中文标签。 */
  label: string;
  /** 灰阶兜底配色（弱一档的 zinc-500，区别于 other 已知值的 zinc-700）。 */
  badgeClass: string;
}

/** 「未分类」展示项——type 为 NULL 的工作区（存量不强制回填，design §9）。 */
export const UNCLASSIFIED_OPTION: UnclassifiedOption = {
  value: null,
  label: "未分类",
  badgeClass: "border-zinc-200 bg-zinc-50 text-zinc-500",
};

/** 已知值查找表（key 用 string，未知值 get 返回 undefined 走兜底）。 */
const OPTION_BY_VALUE: ReadonlyMap<string, WorkspaceTypeOption> = new Map(
  WORKSPACE_TYPE_OPTIONS.map((option) => [option.value, option]),
);

/** workspaceTypeBadge 的返回形态。 */
export interface WorkspaceTypeBadgeView {
  /** 徽标文案：已知值 → 中文标签；NULL/空 → 「未分类」；未知非空 → 原值。 */
  label: string;
  /** 徽标配色类名（仅配色，布局类由消费方叠加）。 */
  className: string;
}

/**
 * 取工作区类型徽标渲染信息（列表卡片 / 关联弹窗 / 详情页统一入口）。
 *
 * - null / undefined / 空串 → 「未分类」灰（空串视同未填，防御 legacy 数据）
 * - 8 值词表内 → 对应中文标签 + 词表配色
 * - 未知非空值（存量脏数据 / 废弃旧值如 daemon-client）→ 原值 + 灰徽标，不崩
 */
export function workspaceTypeBadge(
  type: string | null | undefined,
): WorkspaceTypeBadgeView {
  if (!type) {
    return {
      label: UNCLASSIFIED_OPTION.label,
      className: UNCLASSIFIED_OPTION.badgeClass,
    };
  }
  const known = OPTION_BY_VALUE.get(type);
  if (known) {
    return { label: known.label, className: known.badgeClass };
  }
  return { label: type, className: UNCLASSIFIED_OPTION.badgeClass };
}
