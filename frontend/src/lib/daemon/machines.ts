/**
 * Daemon API client —— machines 域（machine 全部函数与类型 + daemon 实例列表）。
 *
 * 2026-09-07-arch-large-file-split task-15：自原 lib/daemon.ts 按资源域原样搬移，
 * @/lib/daemon 导入面经 ./index 全量再导出保持零变化。OwnerRead/DaemonRuntimeRead
 * 定义在 ./runtimes，SharedMachineView 定义在 ./shared-agents（基线归域备注 1/2）。
 */
import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";
import type { DaemonRuntimeRead, OwnerRead } from "./runtimes";
import type { SharedMachineView } from "./shared-agents";

/**
 * 2026-07-03-daemon-entity-binding task-10：守护进程实体（daemon_instance）的前端 DTO。
 *
 * 由 workspace-daemon-switcher 使用，展示当前用户在线守护进程列表。
 * providers 为该 daemon 实体下已启用的运行时列表（用于渲染 provider 徽标）。
 */
export interface DaemonInstanceProviderItem {
  provider: string;
  status: string;
  version?: string | null;
}

export interface DaemonInstanceRead {
  id: string;
  hostname: string;
  display_alias: string | null;
  status: string;
  /** daemon 进程版本（2026-07-04-daemon-version-management D-005）。 */
  version?: string | null;
  build_id?: string | null;
  providers: DaemonInstanceProviderItem[];
}

/**
 * GET /api/daemon/instances — 列出当前用户在线的守护进程实体。
 * 返回包含各 daemon 已启用 provider 列表，用于 workspace-daemon-switcher
 * 下拉显示 hostname/display_alias + provider 徽标（task-10 / FR-09）。
 */
export async function listDaemonInstances(): Promise<DaemonInstanceRead[]> {
  return apiFetch<DaemonInstanceRead[]>("/api/daemon/instances");
}

// ── Daemon machines（machine→runtime 两级）──
// 2026-07-07-daemon-machine-runtime-hierarchy task-05：machine 作为一级资源，
// 字段对齐 design §5.1 / 后端 task-01 DTO（蛇形），与 runtime 级类型并列。

/**
 * machine 级 pending 升级视图（2026-08-29-daemon-selfupdate-safety task-07 /
 * FR-05 / D-003@v2），对齐后端 task-06 机器视图透出的 MachinePendingUpdateRead
 * （蛇形）。daemon 自更新安全层在「服务端升级指令 / 磁盘旁路探测」发现新版本
 * 但机器忙（会话轮次 / 任务执行中）时推迟升级，心跳上报 pending_update；
 * null = 无挂起（升级已执行/取消，backend 清列）。api-types 生成版归 task-08。
 */
export interface MachinePendingUpdate {
  /**
   * 挂起原因：server_command（服务端升级指令）/ disk_change（磁盘版本变更
   * 探测）。与后端口径一致保持 string 不收紧成 Literal——心跳通道宁宽勿断，
   * 前端对未知 reason 兜底按升级等待（warning）横幅渲染。
   */
  reason: string;
  /** 挂起时 daemon 当前版本。 */
  current_version: string;
  /** 待升级目标版本。 */
  target_version: string;
  /** 挂起起始时间（ISO；backend 首落库盖值，同内容重放心跳保留原值）。 */
  since: string;
}

/**
 * machine（守护进程实例）视图 DTO，对齐 design §5.1 DaemonMachineRead。
 * owner 复用既有 OwnerRead，runtimes 复用既有 DaemonRuntimeRead（含各自
 * capabilities/allowed_roots）。runtime_count / online_runtime_count 由后端派生。
 */
export interface DaemonMachineRead {
  id: string;
  hostname: string;
  display_alias: string | null;
  os: string | null;
  arch: string | null;
  status: string; // online/offline/maintenance/disabled
  last_heartbeat_at: string | null;
  /** daemon 语义版本（区别于 runtime.version 的 provider CLI 版本）。 */
  version: string | null;
  /** daemon 构建 SHA。 */
  build_id: string | null;
  /**
   * daemon 进程启动时间（task-07 / FR-03，后端 task-04 新增）。
   * 旧 daemon 未上报时为 null，前端机器头显「—」。
   */
  started_at: string | null;
  created_at: string;
  owner?: OwnerRead | null;
  /** 该 instance 下 runtime 总数。 */
  runtime_count: number;
  /** status=='online' 的 runtime 数。 */
  online_runtime_count: number;
  /** 该机器全部 runtime。0-runtime 机器为 []。 */
  runtimes: DaemonRuntimeRead[];
  /**
   * 推迟升级状态（task-07 / FR-05）：非 null 时机器卡渲染三状态横幅
   * （server_command=warning / disk_change=info）并禁用升级按钮。
   * 旧后端无该字段 → undefined，按无挂起消费（不渲染横幅不改轮询）。
   */
  pending_update?: MachinePendingUpdate | null;
  /**
   * sillyspec 三字段（2026-08-31-machine-sillyspec-version task-06 / FR-05）：
   * version/latest 为兄弟语义（null=未安装/未知；daemon 离线保留最后上报值，
   * 仅 register 落 null），update 为升级状态机投影（null=无进行中/近期升级，
   * 语义同 pending_update）。旧后端无这些字段 → undefined，机器卡按未安装/
   * 无横幅消费。嵌套类型一律引用 api-types 生成版 MachineSillySpecUpdateRead
   * （六字段全 nullable，宁宽勿断），不手写 DTO。
   */
  sillyspec_version?: string | null;
  sillyspec_latest_version?: string | null;
  sillyspec_update?: components["schemas"]["MachineSillySpecUpdateRead"] | null;
  /**
   * sillyspec 活跃变更总览嵌套（2026-09-02-changes-overview-card task-05 / FR-05）：
   * 即 ``progress show --json`` envelope 摘要（计数 + changes[] 截断 N=50 +
   * pending_conflicts[]，conflict_types 为冲突类型→计数映射）。null=CLI 能力缺失
   * （sillyspec 未安装/版本过低，清除语义——卡片显「总览不可用」占位）；
   * undefined=旧后端缺该字段，同样按占位消费。嵌套类型引用 api-types 生成版
   * MachineSillySpecStatusRead（宽松透出，字段全 nullable 宁宽勿断），不手写 DTO。
   */
  sillyspec_status?: components["schemas"]["MachineSillySpecStatusRead"] | null;
  /**
   * sillyspec 总览采集失败状态嵌套（2026-09-08，temp 投毒排障衍生）：daemon 周期
   * 采集 ``progress show --json`` 三态③（超时/非零退出/spawn 失败）持续发生时的
   * 错误快照（reason/detail/since）。sillyspec_status 为 null 且本字段非 null →
   * 总览卡片显「数据源查询失败」而非「未安装/版本过低」；null=无失败/已恢复/
   * register 恒清；undefined=旧后端缺该字段（按无失败消费）。嵌套类型引用
   * api-types 生成版 MachineSillySpecStatusErrorRead（宽松透出，宁宽勿断）。
   */
  sillyspec_status_error?: components["schemas"]["MachineSillySpecStatusErrorRead"] | null;
  /**
   * 工作区级总览 map（2026-09-08 总览工作区级化）：wsId → ``progress show --json``
   * 摘要（仅成功项，daemon 按 wsId→主仓根映射逐目标采集）。null=该机器未启用
   * 工作作区级采集（旧 daemon，卡片回退机器级 sillyspec_status）；非 null 时卡片
   * 取 map[当前工作区ID]，缺席=「本工作区尚未被采集」而非串台显示其他工作区数据。
   * 值类型复用 api-types 生成版 MachineSillySpecStatusRead（宽松透出）。
   */
  sillyspec_status_map?: Record<
    string,
    components["schemas"]["MachineSillySpecStatusRead"]
  > | null;
  /**
   * sillyspec 命令结果槽嵌套（2026-09-04-conflict-resolve-entry task-08 / FR-05）：
   * daemon 侧冲突裁决 / ghost 清理命令执行器的最新结果（action/change/strategy/
   * state/exit_code/error/executed_at 七字段），经心跳落库后在终态展示窗口（约
   * 10 分钟）内随机器视图透出。null=窗口已过期 / register 恒清；undefined=旧
   * 后端缺该字段——均按无回报消费（PlatformSyncSection 等 150s 后恢复可重试）。
   * 嵌套类型引用 api-types 生成版 MachineSillySpecCommandResultRead（宽松透出，
   * 七字段全 nullable 宁宽勿断），不手写 DTO。
   */
  sillyspec_command_result?: components["schemas"]["MachineSillySpecCommandResultRead"] | null;
}

/** GET /api/daemon/machines 查询参数（design §5.1）。 */
export interface DaemonMachineListParams {
  q?: string;
  status?: string;
  provider?: string;
  user_id?: string;
  limit?: number;
  offset?: number;
}

/**
 * GET /api/daemon/machines 响应体（机器级分页）。
 *
 * 2026-08-28-daemon-agent-share task-07/task-09：后端 machines 响应末位附加
 * ``shared_to_me``（「共享给我的」机器行，grants.queries 五字段契约）；旧后端
 * / 无授权数据时字段缺省，前端按可选消费（?? []）。
 */
export interface DaemonMachineListResponse {
  items: DaemonMachineRead[];
  total: number;
  limit: number;
  offset: number;
  /** 「共享给我的」机器行（workspace grant 装配；空/缺省 = 无共享）。 */
  shared_to_me?: SharedMachineView[];
}

/** PATCH /api/daemon/machines/{id} 请求体（省略=不变，显式 null/空白=清空）。 */
export interface DaemonMachineUpdate {
  display_alias?: string | null;
}

/**
 * GET /api/daemon/machines — machine 级分页列表（admin 全局 / 普通用户仅自己）。
 * 仿 listDaemonRuntimesPage 的 query 写法。
 */
export async function listDaemonMachines(
  params?: DaemonMachineListParams,
): Promise<DaemonMachineListResponse> {
  return apiFetch<DaemonMachineListResponse>("/api/daemon/machines", {
    query: params as Record<string, string | number | undefined> | undefined,
  });
}

/**
 * PATCH /api/daemon/machines/{instance_id} — 直写机器别名（0-runtime 机器也能改）。
 * 返回重新聚合的 DaemonMachineRead。仿 updateDaemonRuntime。
 */
export async function updateDaemonMachine(
  instanceId: string,
  input: DaemonMachineUpdate,
): Promise<DaemonMachineRead> {
  return apiFetch<DaemonMachineRead>(
    `/api/daemon/machines/${encodeURIComponent(instanceId)}`,
    { method: "PATCH", json: input },
  );
}

/**
 * POST /api/daemon/machines/{instance_id}/self-update — 按 instance 路由 daemon 升级。
 * 不再借道 runtime_id（design §5.3）。返回 {sent, latest_version}，仿 triggerDaemonSelfUpdate。
 */
export async function triggerMachineSelfUpdate(
  instanceId: string,
): Promise<{ sent: boolean; latest_version: string }> {
  return apiFetch(
    `/api/daemon/machines/${encodeURIComponent(instanceId)}/self-update`,
    { method: "POST" },
  );
}

/**
 * POST /api/daemon/machines/{instance_id}/sillyspec-update — 推送 sillyspec
 * 升级指令（admin，2026-08-31-machine-sillyspec-version task-06 / FR-02）。
 * fire-and-forget 无回执（同 CLEANUP）：daemon 收到后本机 npm 升级，状态机经
 * 心跳 sillyspec_update 字段回传（不走本消息）。刻意不返回 latest_version——
 * npm latest 由 daemon 自行探测并经心跳 sillyspec_latest_version 上报（design
 * §接口定义）。失败抛 ApiError（404 归属 / 504 DaemonRuntimeOffline）。
 * 返回 {sent}，仿 triggerMachineSelfUpdate。
 */
export async function triggerMachineSillySpecUpdate(
  instanceId: string,
): Promise<{ sent: boolean }> {
  return apiFetch(
    `/api/daemon/machines/${encodeURIComponent(instanceId)}/sillyspec-update`,
    { method: "POST" },
  );
}

/**
 * POST /api/daemon/machines/{instance_id}/sillyspec-resolve — 推送 sillyspec
 * 冲突裁决指令（admin，2026-09-04-conflict-resolve-entry task-08 / FR-02 /
 * D-001@v1）。fire-and-forget 无回执（同 SILLYSPEC_UPDATE）：daemon 收到后
 * 调本机 sillyspec CLI 执行裁决（strategy 下划线字面量 → --keep-local /
 * --take-platform flag 映射归 daemon 单点），结果经心跳 sillyspec_command_result
 * 字段回传（终态窗口内，不走本消息）。change 白名单与 strategy Literal 校验在
 * 后端 422 兜底。失败抛 ApiError（404 归属 / 504 DaemonRuntimeOffline）。
 * 返回 {sent}，仿 triggerMachineSillySpecUpdate。
 */
export async function triggerMachineSillySpecResolve(
  instanceId: string,
  body: components["schemas"]["MachineSillySpecResolveRequest"],
): Promise<{ sent: boolean }> {
  return apiFetch(
    `/api/daemon/machines/${encodeURIComponent(instanceId)}/sillyspec-resolve`,
    { method: "POST", json: body },
  );
}

/**
 * POST /api/daemon/machines/{instance_id}/sillyspec-ghost-cleanup — 推送
 * sillyspec ghost 清理指令（admin，2026-09-04-conflict-resolve-entry task-08 /
 * FR-03 / D-001@v1），无请求体。fire-and-forget 无回执（同 SILLYSPEC_UPDATE）：
 * daemon 收到后先 ``doctor --cleanup-ghosts --confirm`` 清本地幽灵行，再
 * ``platform sync`` 收敛平台侧；结果经心跳 sillyspec_command_result 字段回传
 * （终态窗口内，不走本消息）。失败抛 ApiError（404 归属 / 504
 * DaemonRuntimeOffline）。返回 {sent}，仿 triggerMachineCleanup。
 */
export async function triggerMachineSillySpecGhostCleanup(
  instanceId: string,
): Promise<{ sent: boolean }> {
  return apiFetch(
    `/api/daemon/machines/${encodeURIComponent(instanceId)}/sillyspec-ghost-cleanup`,
    { method: "POST" },
  );
}

/**
 * GET /api/daemon/machines/{instance_id}/sillyspec-conflicts/{change}/compare —
 * 拉取 sillyspec 同步冲突的本地/平台对比数据（2026-09-07-conflict-diff-compare
 * task-07 / FR-02 / D-001@v1 方案A：请求/响应式，区别于 fire-and-forget 裁决
 * 通道）。kind 与 workspace_id 走 query 参数（design §7.2）；权限与裁决端点同
 * 集合（机器所有者 + 平台管理员，越权 404）；机器离线 / RPC 超时（后端显式
 * 15s）→ 504 抛 ApiError。返回生成版 SillySpecConflictCompareResponse——
 * diff_rows / progress_rows 由后端 difflib 算好，前端纯渲染（不引入 diff 库）。
 */
export async function getSillySpecConflictCompare(
  instanceId: string,
  change: string,
  kind: components["schemas"]["SillySpecConflictCompareResponse"]["kind"],
  workspaceId: string,
): Promise<components["schemas"]["SillySpecConflictCompareResponse"]> {
  return apiFetch<components["schemas"]["SillySpecConflictCompareResponse"]>(
    `/api/daemon/machines/${encodeURIComponent(instanceId)}/sillyspec-conflicts/${encodeURIComponent(change)}/compare`,
    { query: { kind, workspace_id: workspaceId } },
  );
}

/**
 * POST /api/daemon/machines/{instance_id}/cleanup — 按 instance 路由 daemon 缓存清理。
 * daemon 收到后清理 specs/、会话日志、备份等本地缓存。返回 {sent}。
 */
export async function triggerMachineCleanup(
  instanceId: string,
): Promise<{ sent: boolean }> {
  return apiFetch(
    `/api/daemon/machines/${encodeURIComponent(instanceId)}/cleanup`,
    { method: "POST" },
  );
}

/**
 * DELETE /api/daemon/machines/{instance_id} — 物理删除机器条目
 * （ql-20260829-006-6a9e）。级联清除该机全部 runtimes 及其会话/任务记录；
 * 后端守卫：daemon 心跳新鲜（在线）/ 工作区绑定 / 共享授权 / 借用审计红线 /
 * in-flight 任务 → 409；daemon 之后重新启动会以同一 daemon_local_id 重建。
 */
export async function deleteDaemonMachine(instanceId: string): Promise<void> {
  await apiFetch(`/api/daemon/machines/${encodeURIComponent(instanceId)}`, {
    method: "DELETE",
  });
}
