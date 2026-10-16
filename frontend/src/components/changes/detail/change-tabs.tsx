"use client";

/**
 * 变更详情页 tab 容器与共享契约（2026-10-15-change-detail-redesign / D-002@v1 / D-013@v1 / D-015@v1）。
 *
 * 职责两件：①`DetailTab` 类型与 `visibleTabs` 判定（tab 集只由「归档与否」一个布尔决定，
 * thin 不特判——thin 的主线叙事由观测事件流承担，收窄「过程」会把唯一叙事面藏掉，见 D-015@v1）；
 * ②`ChangeTabs` = primer `UnderlineNav` 的受控包装（本页 tab 不带计数）。
 *
 * 边界：URL 读写与非法值钳制属页面层（task-07）；本组件不读 URL、不取数、不持内部 state——
 * 受控纯组件，故 `DetailTab`/`visibleTabs` 与组件同文件导出（各面板 `import type` 消费，
 * 不产生运行时循环依赖）。
 */
import { UnderlineNav } from "@/components/primer";

/** 四 tab 标识（归档态可见三枚：无 `files`）。 */
export type DetailTab = "overview" | "assets" | "process" | "files";

/** tab 固定顺序（`visibleTabs` 的取序基准，与 tools 侧 tab 栏顺序同源）。 */
export const DETAIL_TAB_ORDER: readonly DetailTab[] = [
  "overview",
  "assets",
  "process",
  "files",
] as const;

/** tab 中文标签（UnderlineNav item.label 单一源）。 */
export const TAB_LABELS: Record<DetailTab, string> = {
  overview: "概览",
  assets: "产出",
  process: "过程",
  files: "文件与对账",
};

/**
 * 可见 tab 集：恒为四枚。（2026-10-16-archived-files-tab / D-019@v1 用户裁决推翻
 * D-007@v1 的归档收窄——归档留档不展示 spec 文档全貌，归档态同样需要文件树与
 * 范围对账入口。）`archived` 参数保留以兼容调用方签名，当前不参与判定。
 */
export function visibleTabs(_archived: boolean): DetailTab[] {
  return [...DETAIL_TAB_ORDER];
}

export interface ChangeTabsProps {
  /** 已归档（终态）——决定 tab 集；调用方传 `isTerminalChange(change)`。 */
  archived: boolean;
  /** 当前 tab（由 `?tab=` 派生，见 task-07 的页面层）。 */
  value: DetailTab;
  /** 切换回调（页面层据此更新 URL）。 */
  onChange: (_tab: DetailTab) => void;
  className?: string;
}

/** tab 栏（受控）：只渲染可见 tab，`aria-selected` 由 `value` 决定。 */
export function ChangeTabs({ archived, value, onChange, className }: ChangeTabsProps) {
  return (
    <UnderlineNav<DetailTab>
      items={visibleTabs(archived).map((key) => ({ key, label: TAB_LABELS[key] }))}
      value={value}
      onChange={onChange}
      className={className}
    />
  );
}
