---
author: flow-machine-draft
created_at: 2026-10-15T07:52:06.615Z
---
# 设计记录（Design Record）— 2026-10-15-workspace-session-agent-only

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

前端单侧改动：给 `PreSessionPicker` 增加可选 prop `boundMachineId`——非空即「工作区绑定模式」，跳过第一步机器列表，直接渲染该绑定机器的智能体步（含专门的空态文案）。绑定来源是 per-member binding（`workspace_member_runtimes.daemon_id`，前端 `MemberBindingView.daemon_id`），不新增任何后端接口与请求路径：门户（sessions-portal）复用已有 `["workspace-switcher-list"]` 查询里的 `bindings`，悬浮宿主（floating-session-host）以同 key 同 queryFn 接入（与顶栏 WorkspaceSwitcher 共享缓存），移动端工作区会话页用 `fetchMyBinding(workspaceId)` 单条取数。

三个宿主（门户 / 悬浮宿主 / 移动页）统一的判定链：`workspaceId 有值 → binding.daemon_id → 机器候选（含共享机器 machineCandidates）查找`：
- 命中 → 「＋」/FAB 打开绑定模式浮层（仅智能体步）；若筛选 agent 非空且绑定机器上该引擎在线 → 直带上下文进预会话（不弹浮层）；
- `?new=1`（workspace/change/quicklog scope）→ 绑定机器上默认 runtime（在线 claude → codex）直进；未命中弹绑定模式浮层；
- 未命中（无 binding / 非工作区组）→ 完全保持原两步流程（零回归）。

绑定机器离线/不可见时不落回全机器列表，给明确空态（离线：启动 daemon；不可见：去工作区页重绑）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `PreSessionPicker` props 新增 `boundMachineId?: string | null`：缺省或 null = 原两步流程（逐字零变化）；非空 = 绑定模式（不渲染「① 机器（仅在线）」）。
- 同文件导出三个纯函数（三宿主共用，避免三处重复实现）：
  - `boundMachineIdFor(bindings, workspaceId): string | null` —— binding 查表取 `daemon_id`（空/未命中 → null）；
  - `pickDefaultRuntimeOnMachine(machine): DaemonRuntimeRead | null` —— 在线且 provider∈{claude, codex}，claude 优先（与既有 ?new=1/悬浮宿主默认解析同语义，抽为单一实现）；
  - `pickRuntimeByProvider(machine, provider): DaemonRuntimeRead | null` —— 在线且 provider 精确匹配（筛选直带用）。
- 门户 `handleNewInGroup`：绑定路径的直带条件从「machineId+agent 双备齐」改为「agent 备齐 + 绑定机器命中」；无绑定路径逻辑不变。
- 无后端/DB/端点/命令/文件格式变化；OpenAPI 生成物（`api-types.ts`/`openapi.json`）不涉及（规则 21 不触发）。
- 宿主数据源：门户读 `wsNameQuery.data.bindings`（既有查询，零新增请求）；悬浮宿主接入 `["workspace-switcher-list"]`（同 key 同 queryFn，与顶栏 switcher/门户共享缓存）；移动页新增 `useQuery(["my-workspace-binding", workspaceId], fetchMyBinding)`（单条轻请求，staleTime 60s）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/sessions/pre-session-picker.tsx | `boundMachineId` prop + 绑定模式渲染（跳过机器步/离线与不可见空态）+ 导出 boundMachineIdFor / pickDefaultRuntimeOnMachine / pickRuntimeByProvider |
| 修改 | frontend/src/components/sessions/sessions-portal.tsx | 工作区组「＋」绑定模式浮层；筛选 agent 直带取绑定机器 runtime；?new=1（scope）绑定优先于 D-005；绑定在途守卫（不落旧直带） |
| 修改 | frontend/src/components/floating/floating-session-host.tsx | 接入 ["workspace-switcher-list"] 共享查询取 bindings；组「＋」/工作区页「＋ 新会话」按绑定机器解析 + 在途守卫 + 绑定模式浮层注入 |
| 修改 | frontend/src/app/m/workspaces/[id]/sessions/page.tsx | fetchMyBinding(workspaceId) 单条查询（key ["my-workspace-binding", wsId]）+ FAB/空态入口注入 boundMachineId |
| 修改 | frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx | 绑定模式用例（跳过机器步/三类空态/不传与空串零回归/bottomSheet）+ 三纯函数单测 |
| 修改 | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | 门户绑定用例（组＋绑定浮层/筛选直带取绑定机器/?new=1 绑定优先/离线空态/change scope 双传/零回归） |
| 修改 | frontend/src/components/floating/floating-session-host.test.tsx | 宿主绑定用例（组＋绑定模式透出/筛选直带/工作区页绑定优先/零回归）+ picker mock importActual 展开 |
| 修改 | frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx | 移动页绑定用例（FAB 绑定模式透出/无绑定零回归）+ binding 数据源 mock |
| 修改 | backend/app/modules/daemon/group/service/delegation_notice.py | 收口 lint 门清偿预存 mypy 债：redis-py stubs union 返回按 mentions.py 先例 ignore[misc]（非本变更功能面） |
| 修改 | backend/app/modules/daemon/tests/test_group_bridge_projection.py | 收口 lint 门清偿预存 mypy 债：metadata_（dict \| None）索引前显式 isinstance 收窄（非本变更功能面） |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. **乱序/迟到到达**：bindings 与 machines 均为异步数据且可能先到其一。
   - 门户：`?new=1` 效应在 workspace scope 下增加 `bindings 未就绪则不解析` 门（与既有 `machinesLoading` 门并列），避免用空 bindings 误判「无绑定」而弹两步浮层；绑定模式下浮层阅读的是「渲染时」的 bindings，数据迟到只会让浮层从两步切到绑定模式（用户看到的第一步列表消失为极小概率竞态，且共享缓存使该窗口≈0）。
   - 悬浮宿主/移动页同理以「渲染时 binding 命中与否」为准，迟到即降级为原两步（行为仍是合法路径）。
2. **并发写**：本变更无任何写路径（无新接口、不改 DB/会话数据），不存在并发写冲突面。多标签页在 staleTime 60s 内可能读到旧 binding（换绑后短暂仍在旧机器新建）——最坏结果是会话落在旧机器（原行为本就允许任选机器），非数据损坏，聚焦/重挂载后收敛。
3. **切换/生命周期**：浮层受控（open 由父层持有）；绑定模式不依赖第一步选中态，重开/重渲染无残留；`pickerWorkspaceId` 与 `boundMachineId` 在同一渲染帧由同一 workspaceId 计算，切换工作区分组后不会用旧组的机器；预会话创建成功的清理链路（preContext/选中/URL）不变。
4. **作用域**：binding 是 (workspace, 当前用户) 维度的 per-member 记录，天然按人隔离；机器查找在「自有 + 共享给我」的机器候选（machineCandidates）内进行，借用共享 daemon 的绑定同样可命中；跨工作区不串（每个 workspaceId 独立解析，同一帧计算），跨仓/多实例无新增共享状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

**风险（已接受并留了出口）**：
1. 绑定机器离线/不可见时用户「无路可走」——本设计砍掉机器列表（需求要求），但空态文案给出两条恢复路径（启动 daemon / 去工作区页重绑定）。若实测反馈需要临时换机器，后续可在空态加「换机器」降级入口（本期不做，避免破坏「不选机器」语义）。
2. 门户/悬浮宿主沿用非工作区路径的旧直带逻辑未动，两套直带条件并存（工作区=agent 即可，非工作区=machineId+agent）——已在代码注释与 FR-04 显式声明，防后人误「统一」。

**试过但放弃的方案**：
- 只改工作区 scope 页、不动全局门户的工作区分组 → 同一动作在不同入口表现不一致，用户会认为「有的地方还要选机器」。
- 后端支持「只传 workspace_id + provider，由后端按 binding 派发机器」→ 改动面扩到后端 placement/inject_gates/契约/gen:types，且前端仍需知道「哪台机器在线」才能给空态指引；本期前端解析 binding 已足够，后端零改动。
- 绑定模式保留「机器」只读展示 + 展开可换机器 → 与「不应该选择机器信息」直接冲突，且增加状态机复杂度。
