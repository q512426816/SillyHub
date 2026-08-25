/**
 * 悬浮会话壳层 store（2026-08-25-unified-floating-session task-04 / FR-1~3 / D-002）。
 *
 * 边界（R6，出处 diff-analysis §6）：只存「壳态」——开/关/最小化/选中会话/
 * 预会话上下文/页面上下文；会话内部状态（SSE 连接、消息队列、turns、团队
 * 任务块）100% 留在 SessionPanel 组件内部（key 重挂载契约由 sessionId 驱动，
 * 与门户一致）。本 store 不 import SessionPanel / daemon lib（纯状态，可单测）。
 *
 * 消费方：
 *   - FloatingSessionHost（task-05）：渲染门控 open||minimized||sessionId；
 *   - 任意页面入口（task-07 PPM 行按钮）：startPreSession 携带页面上下文唤起。
 *
 * 语义：
 *   - minimize：保活收起（open=false, minimized=true，sessionId 保留——
 *     抽屉主体 hidden 不卸载，SSE/队列不断）；
 *   - closeDrawer：无选中会话 → 全壳态清零（宿主卸载抽屉主体，释放查询）；
 *     有选中会话 → 等同 minimize（运行中会话不因关抽屉而断）；
 *   - selectSession：切选中（预会话上下文清空，优先级真会话 > 预会话）；
 *   - startPreSession：进入预会话（清选中，可携带 pageContext）。
 */
import { create } from "zustand";

/** 预会话机器/工作区上下文（对齐 SessionPreContext，宿主解析 runtime 后填）。 */
export interface FloatingPreContext {
  runtimeId: string;
  workspaceId: string | null;
  changeId?: string | null;
  /**
   * 快速修复入口传入（2026-08-25-session-spec-binding task-11 / FR-06）：ql_id
   * 短码，经宿主展开透传进 SessionPanel preContext.quickId，随首句 createSession
   * 上送 quicklog_id 落绑定。缺省零回归（对齐 changeId 语义）。
   */
  quickId?: string | null;
}

/**
 * runtime 锁定壳态（FR-01/FR-02，/runtimes 入口唤起抽屉时携带）。
 * 锁定后：抽屉头部显示锁定徽标、树按 runtime scope 过滤、新建钉死该 runtime。
 * 不随 closeDrawer 自动清——下次 openRuntimeSession 或显式 closeRuntimeLock 覆盖。
 */
export interface FloatingLockedRuntime {
  /** runtime id（传给 SessionListPanel scope.runtimeId + preContext.runtimeId）。 */
  id: string;
  /** 展示用：机器显示名。 */
  machineLabel: string;
  /** 展示用：智能体/提供方显示名。 */
  providerLabel: string;
}

/**
 * 页面上下文（后端 PageContextCreateBlock 前端形态）：
 * - ppm_project：PPM 项目详情（显式入口携带，服务端回查项目数据）；
 * - generic_page（task-09）：通用页面（URL 派生 route_key，服务端注册表
 *   Lookup 页面中文名注入；未注册键静默不注入——枚举键，零自由文本）；
 * - workspace（task-10）：工作区详情（URL 派生 workspace_id，服务端回查
 *   工作区名称/类型/路径注入——用户实测反馈"只注入笼统标签不知道是哪个"）。
 */
export type FloatingPageContext =
  | { page_key: "ppm_project"; project_id: string }
  | { page_key: "generic_page"; route_key: string }
  | { page_key: "workspace"; workspace_id: string; tab_key?: string };

/** 悬浮会话壳层状态与动作（design §3）。 */
export interface FloatingSessionState {
  /** 抽屉是否展开（false 且 minimized=true 为胶囊态）。 */
  open: boolean;
  /** 最小化保活（sessionId 保留，宿主 hidden 渲染）。 */
  minimized: boolean;
  /** 选中会话 id（SessionPanel key 源；null = 预会话或空态）。 */
  sessionId: string | null;
  /** 预会话上下文（与 sessionId 互斥，优先级真会话 > 预会话）。 */
  preContext: FloatingPreContext | null;
  /** 页面上下文（创建会话时随首句上送，服务端白名单回查）。 */
  pageContext: FloatingPageContext | null;
  /**
   * 自动新建挂起位（task-07）：页面入口 requestNewSession 置 true；宿主
   * 挂载后解析默认机器进预会话并清除（未命中机器弹两步浮层兜底）。
   */
  autoNewPending: boolean;
  /**
   * FR-01/FR-02：runtime 锁定态（/runtimes 入口唤起时携带）。非空=锁定，
   * 抽屉头部渲染锁定徽标、树按 runtime scope 过滤、新建钉死该 runtime。
   * 不随 closeDrawer 自动清（运行中会话保活时保留；下次 openRuntimeSession
   * 或 closeRuntimeLock 覆盖）。
   */
  lockedRuntime: FloatingLockedRuntime | null;

  openDrawer: () => void;
  minimize: () => void;
  restore: () => void;
  closeDrawer: () => void;
  selectSession: (_sessionId: string | null) => void;
  startPreSession: (_preContext: FloatingPreContext, _pageContext?: FloatingPageContext | null) => void;
  /** 页面入口一键唤起：开抽屉 + 携带页面上下文 + 请求自动进预会话。 */
  requestNewSession: (_pageContext?: FloatingPageContext | null) => void;
  /** 宿主消费 autoNewPending 后清除（防循环触发）。 */
  clearAutoNew: () => void;
  /** 预会话首句创建成功（SessionPanel onPreSessionCreated → 宿主回调）。 */
  preSessionCreated: (_sessionId: string) => void;
  /**
   * FR-01：/runtimes 入口唤起锁定态抽屉——置 lockedRuntime + open + 清
   * sessionId/preContext（新会话从空态或 preContext 开始，不继承旧选中）。
   */
  openRuntimeSession: (_lock: FloatingLockedRuntime) => void;
  /** FR-01：显式清锁定态（锁定随抽屉关闭或下次 openRuntimeSession 覆盖）。 */
  closeRuntimeLock: () => void;
}

export const useFloatingSessionStore = create<FloatingSessionState>((set) => ({
  open: false,
  minimized: false,
  sessionId: null,
  preContext: null,
  pageContext: null,
  autoNewPending: false,
  lockedRuntime: null,

  openDrawer: () => set({ open: true, minimized: false }),

  minimize: () => set({ open: false, minimized: true }),

  restore: () => set({ open: true, minimized: false }),

  closeDrawer: () =>
    set((s) => {
      // 无选中会话：全清（宿主卸载抽屉主体，释放数据查询——降载 v1 策略）。
      if (!s.sessionId) {
        return {
          open: false,
          minimized: false,
          preContext: null,
          pageContext: null,
          autoNewPending: false,
          // lockedRuntime 不清（运行中会话保活时保留锁定）。
        };
      }
      // 有会话：等同最小化（SSE 保活，不因关抽屉断连）。
      return { open: false, minimized: true };
    }),

  selectSession: (sessionId) =>
    set((s) => ({
      sessionId,
      // 切选中清预会话（优先级真会话 > 预会话；同 id 重复选中仅展开）。
      preContext: sessionId ? null : s.preContext,
      open: true,
      minimized: false,
    })),

  startPreSession: (preContext, pageContext = null) =>
    set({
      preContext,
      pageContext,
      sessionId: null,
      open: true,
      minimized: false,
      autoNewPending: false,
    }),

  requestNewSession: (pageContext = null) =>
    set({
      pageContext,
      sessionId: null,
      preContext: null,
      open: true,
      minimized: false,
      autoNewPending: true,
    }),

  clearAutoNew: () => set({ autoNewPending: false }),

  preSessionCreated: (sessionId) =>
    set({ sessionId, preContext: null, open: true, minimized: false, autoNewPending: false }),

  openRuntimeSession: (lock) =>
    set({
      lockedRuntime: lock,
      sessionId: null,
      preContext: null,
      open: true,
      minimized: false,
    }),

  closeRuntimeLock: () => set({ lockedRuntime: null }),
}));
