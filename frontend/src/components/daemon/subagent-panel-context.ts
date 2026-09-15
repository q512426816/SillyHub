/**
 * 会话子代理右栏面板 context（2026-09-15-subagent-three-pane-display task-01 /
 * FR-02 / D-001@v1 / D-002@v1，design §5.C）。
 *
 * 三分栏模式下由 session-panel-page 面板根 Provider 注入；SubagentBlockView
 * 消费到 context 时渲染中栏紧凑卡片（仅状态点/名称/类型/徽标/时长，不内联
 * children），点击头部上抛 openSubagent(segment.id) 打开右栏详情；再点已激活
 * 卡片上抛 closeSubagent() 关闭（toggle 语义，D-002@v1 ④）。
 *
 * 默认值 null 是「无右栏能力」哨兵：dialog 弹窗 / 悬浮宿主等旧消费方不挂
 * Provider，useSubagentPanel() 返回 null（不抛错，渐进增强），SubagentBlockView
 * 回退原内联展开行为（FR-05 零回归）——与 MobileWorkspaceContext 的强约束
 * 抛错模式不同，这里允许无 Provider 消费。
 */
import { createContext, useContext } from "react";

/** 右栏子代理面板上下文值（page 模式 Provider 注入）。 */
export interface SubagentPanelContextValue {
  /** 打开右栏面板展示该子代理段（segment.id 是会话内稳定 key）。 */
  // eslint-disable-next-line no-unused-vars -- 接口回调签名形参（同 remote-folder-picker.tsx 惯例）
  openSubagent: (segmentId: string) => void;
  /** 关闭右栏子代理面板（✕ / 段失效 / 会话切换 / 被文件预览覆盖共用出口）。 */
  closeSubagent: () => void;
  /** 当前右栏展示的子代理段 id；null = 未打开（无高亮）。 */
  activeId: string | null;
}

/** 子代理面板上下文（默认 null = 无右栏能力，消费方据此回退内联展开）。 */
export const SubagentPanelContext = createContext<SubagentPanelContextValue | null>(null);

/** 取子代理右栏面板上下文；Provider 外（dialog 等旧宿主）返回 null。 */
export function useSubagentPanel(): SubagentPanelContextValue | null {
  return useContext(SubagentPanelContext);
}
