---
author: WhaleFall
created_at: 2026-08-19T14:01:26
scale: large
---

# 设计文档（Design）— /sessions 新建会话工作区选择器

## 1. 背景

`/sessions`（智能体会话总入口，2026-08-14-sessions-portal）的 NewSessionForm 新建会话时不传 `workspace_id`，提交体只有 `{ runtime_id, agent_profile_id?, llm_provider_id?, prompt }`。后端 `create_session`（`backend/app/modules/daemon/session/service.py:709-714`）只在 `workspace_id` 非空时才把 `cwd` 设为工作区项目根，缺省时 daemon 侧 cwd 回落 `~/sillyhub_workspaces` 空目录（`sillyhub-daemon/src/daemon.ts:3361-3362`），且 tar 传输模式下无 workspaceId 不拉取 SillySpec 规范树（`daemon.ts:3452-3457` warn `interactive_spec_pull_no_workspace`）、不注册 `specSyncCtx`（会话产出不回灌）。

结果：从 `/sessions` 新建的会话是"裸会话"——agent 看不到项目代码、没有规范文档上下文。带完整工作区上下文的会话目前只能从工作区会话页（`/workspaces/{id}/sessions`）或变更中心发起。

同时存在一个既有安全缺口：`create_session` 收到 `workspace_id` 时不校验调用者归属（直接按 ID 读 Workspace 行取 root_path 当 cwd）。工作区会话页入口隐式限定了成员，但 `/sessions` 开放选择器后该缺口会显性化，需一并修复。

## 2. 设计目标

- FR-01：`/sessions` 新建会话表单新增「工作区」选择器（可选，默认「不使用工作区」），选中后提交体携带 `workspace_id`，会话获得该工作区的项目上下文（cwd=项目根 + SillySpec 规范树拉取 + 会话结束回灌，均为既有后端能力，本次只做入口）。
- FR-02：选工作区时机器选择器自动联动——选中当前用户在该工作区绑定的机器（member binding 的 daemon 实体，若在线），用户仍可手动换其它机器。
- FR-03：后端 `create_session` 补 workspace 归属校验：调用者对目标工作区无 WORKSPACE_READ 权限或工作区不存在 → 404 拒绝（与不存在同语义，不泄露存在性）。
- FR-04：不选工作区时行为与现状完全一致（提交体不带 `workspace_id` 字段，零回归）。

## 3. 非目标（Non-Goals）

- 不改会话执行链路（lease/claim/SSE/spec pull/回灌——后端已支持 workspace_id，本变更只补入口与校验）。
- 不改工作区会话页（`/workspaces/{id}/sessions`）与变更中心会话——它们已带工作区上下文。
- 不做工作区搜索式下拉（超 100 个工作区的场景记入风险 R-03，后续按需升级）。
- 不做多成员"按成员解析各自项目路径"——cwd 取 Workspace.root_path（创建者路径）的既有语义不变。
- 不做强制锁定机器（选工作区后仍允许选非绑定机器，见 D-003@v1）。

## 4. 拆分判断

单一功能模块（表单选择器 + 传参 + 后端校验），改动约 5 个文件、跨 frontend/daemon-session 两处，无独立可交付子模块、无多角色视图、无跨页面状态流转——不拆分。非批量模式（非"模板×数据"）。走 standard 单变更。

## 5. 总体方案

### Phase A：前端选择器组件（新增）

新组件 `frontend/src/components/sessions/workspace-session-picker.tsx`，自治受控组件：

- 数据源（全部既有 API，零后端新增）：
  - `listWorkspaces({ limit: 100 })`（`lib/workspaces.ts:82`，后端已按 `allowed_workspace_ids` 权限过滤）→ 工作区选项；
  - `fetchMyBindings()`（`lib/workspace-binding.ts:37`，`GET /api/workspaces/my-bindings` 批量端点）→ workspace→daemon 实体绑定映射（避免逐工作区 N+1）。
- 受控接口：`value: string | null` + `onChange(workspaceId: string | null, boundMachineId: string | null)`——选中工作区时把该工作区绑定的 daemon 实体 ID（= `DaemonMachineRead.id`）一并带出供父层联动。
- UI：antd Select；首项「不使用工作区（默认）」；选项显示工作区名。
- 状态：空列表（未加入任何工作区）→ 禁用 + 提示「你还未加入工作区，可在工作区页创建」；加载失败 → 错误条 + 重试。

### Phase B：NewSessionForm 接入与联动

- 新 state `workspaceId: string | null`（默认 null）。选择器置于表单最顶部（⓪，驱动机器联动），原有四项编号顺移为 ①-④。
- 联动规则（D-003@v1）：onChange 收到 `(wsId, boundMachineId)` 时，若 `boundMachineId` 命中在线机器 → `setMachineId(boundMachineId)` + `setAgentId(null)`（智能体走既有默认逻辑）；未绑定/离线/未命中 → 机器选择不动。改回「不使用」→ 仅清 workspaceId，不回动机器。
- 选中工作区后表单顶部显示绿色提示条：「会话将在〈工作区名〉的项目目录中运行，自动加载其规范文档」。
- 提交：`workspaceId` 非空时 createSession 加 `workspace_id` 字段；`NewSessionFormValues` 增 `workspaceId`。

### Phase C：后端归属校验

`create_session`（`session/service.py`）在 workspace_id 非空时校验：

```python
allowed = await allowed_workspace_ids(self._session, user_id=user_id, permission=Permission.WORKSPACE_READ)
if workspace_id not in allowed:
    raise DaemonSessionWorkspaceNotFound(...)  # 404，与不存在同语义
```

- 口径与前端列表数据源（`workspace/router.py:246-248` 同款调用）完全一致——前端列得出的，后端必放行；前端列不出的，后端必拒绝。
- 原 `cwd = _ws.root_path` 读取逻辑不变（校验通过后 `_ws` 行必然可见）。

### Phase D：测试

- 前端：`workspace-session-picker.test.tsx`（新）覆盖空态/禁用/onChange 回调含绑定机器；`new-session-form.test.tsx`（补）覆盖选工作区联动切机器、提交体含 workspace_id、不选不带字段。
- 后端：`daemon/session` 测试补归属校验用例（非成员 404 / 有权限通过 / 不传零回归）。

## 6. 文件变更清单（File Changes）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | frontend/src/components/sessions/workspace-session-picker.tsx | 工作区选择器自治组件（Phase A） |
| 修改 | frontend/src/components/sessions/new-session-form.tsx | 接入选择器 + workspaceId state + 机器联动 + 提交带 workspace_id + 编号顺移 |
| 新增 | frontend/src/components/sessions/__tests__/workspace-session-picker.test.tsx | 选择器单测 |
| 修改 | frontend/src/components/sessions/__tests__/new-session-form.test.tsx | 联动/提交用例 |
| 修改 | backend/app/modules/daemon/session/service.py | create_session 补 WORKSPACE_READ 归属校验（404） |
| 修改 | backend/app/modules/daemon/tests/test_session_service.py | 校验用例 ×3 |

**字段数据流标注**（`workspace_id` 透传链，producer→consumer）：

`workspace_id: string`（producer=NewSessionForm 用户选择）→ `createSession()`（`lib/daemon.ts:650-676`，已支持 `body.workspace_id`，无需改动）→ HTTP `POST /api/daemon/sessions` → router（`daemon/router.py` create 端点，schema 已含字段）→ `DaemonSessionService.create_session(workspace_id=...)`（本变更加归属校验）→ `AgentSession.workspace_id` 列 + `cwd=_ws.root_path` + lease metadata（`placement.py:712-715`）→ claim payload `workspaceId`（`lease/context.py:577-579`）→ daemon `pullSpecBundle`/cwd（consumer，既有逻辑）。除前端表单层与后端校验外全链路既有，无 dormant 风险。

## 7. 接口定义

### WorkspaceSessionPicker props

```tsx
interface WorkspaceSessionPickerProps {
  /** 当前选中工作区 id；null = 不使用工作区 */
  value: string | null;
  /**
   * 选中/取消回调。boundMachineId = 该工作区 member binding 的 daemon 实体 id
   * （与 DaemonMachineRead.id 同键），未绑定/未加载为 null。
   */
  onChange: (workspaceId: string | null, boundMachineId: string | null) => void;
  /** 表单禁用态（提交中）透传，可选 */
  disabled?: boolean;
}
```

### createSession 提交体（既有，无改动）

```ts
{ runtime_id, prompt, workspace_id?: string,  // 新增可选透传（daemon.ts 已支持）
  agent_profile_id?, llm_provider_id?, manual_approval: true, ask_user_only: true }
```

### NewSessionFormValues（修改）

```ts
export interface NewSessionFormValues {
  workspaceId: string | null;  // 新增
  machineId: string | null;
  agentId: string | null;
  providerId: string;
  profileId: string;
  prompt: string;
}
```

### 后端新增错误类（service.py 内定义，对齐既有风格）

```python
class DaemonSessionWorkspaceNotFound(AppError):
    code = "HTTP_404_DAEMON_SESSION_WORKSPACE_NOT_FOUND"
    http_status = 404
```

## 7.5 生命周期契约表

本变更涉及 session 创建链路。事件矩阵（仅列本变更触及/新增的事件；claim/inject/turn/end 等既有事件不受影响，不在本次契约内）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| create session（带工作区，新增路径） | 前端 NewSessionForm | backend daemon/session | prompt, runtime_id, workspace_id | 校验通过 → session pending→派发；校验失败（无权限/不存在）→ 404，无任何落库 |
| create session（不带工作区，既有路径） | 前端 NewSessionForm / 旧入口 | backend daemon/session | prompt, runtime_id | 行为与现状完全一致（零回归，FR-04） |

表内必需字段已存在于相关 DTO（`SessionCreateRequest` 含 `workspace_id`，`daemon.ts createSession` 已透传）——本变更不新增字段，仅让前端开始传、后端开始校验。

## 8. 数据模型

无表结构/字段变更。`AgentSession.workspace_id` 列既有（`session/service.py:734` 已写入）。

## 9. 兼容策略

- **未选工作区**：提交体不含 `workspace_id` 字段（`daemon.ts createSession` 对 undefined 不下发），后端 `workspace_id=None` 走原路径——与今天行为逐字节一致（FR-04）。
- **旧调用方**：`/runtimes` 弹窗、工作区会话页、变更中心的 createSession 调用不受影响；后端校验只对 workspace_id 非空时生效，工作区会话页入口的调用者均为有权限成员，不会被误拦。
- **回退路径**：选择器组件独立，出问题可整体隐藏（一行条件）而不影响表单其余部分。
- **不改变的 API/表结构**：无新端点、无 schema 改动、无迁移。

## 10. 风险登记（Risk Register）

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 工作区项目目录（Workspace.root_path，创建者机器路径）只存在于绑定机器上；用户选了非绑定机器 → daemon mkdir 空目录跑（`daemon.ts:3370-3371`），agent 在空目录无项目内容 | P2 | FR-02 默认联动绑定机器大幅缓解；不强制锁定（D-003@v1 用户决策）；提示条文案已告知"将在项目目录运行"；记为已知限制 |
| R-02 | my-bindings 的 `runtime_id` 不稳定（动态注册常为 null），联动若按 runtime_id 匹配会失效 | P1 | 联动一律按 `binding.daemon_id`（daemon 实体稳定键）↔ `DaemonMachineRead.id` 匹配，与 workspace-config-card 扫描入口同口径 |
| R-03 | 工作区下拉默认前 100 个（listWorkspaces limit），超过的用户看不到后面的 | P2 | 本期固定 limit=100 + 记录；后续按需升级搜索式下拉（非目标） |
| R-04 | 编号顺移（①→②…）造成既有单测 aria-label/文案断言失败 | P1 | 改动时同步更新 new-session-form 既有测试断言（属预期破坏面） |
| R-05 | 后端校验用 `allowed_workspace_ids` 是"读权限"口径而非"成员"口径——有 WORKSPACE_READ 但非成员的角色（如平台管理员）也能建带该工作区的会话 | P2 | 与前端列表口径一致是刻意选择（见 D-001@v1）；管理员本就越权可读，非缺口 |

## 11. 决策追踪

| 决策 | 内容 | 覆盖 |
|---|---|---|
| D-001@v1 | 后端补 workspace 归属校验，口径=WORKSPACE_READ（与前端列表一致），404 同语义 | FR-03、Phase C、R-05 |
| D-002@v1 | 选择器可选，默认「不使用工作区」 | FR-01/FR-04、Phase A/B |
| D-003@v1 | 选工作区自动联动绑定机器，不强制锁定 | FR-02、Phase B、R-01 |
| D-004@v1 | 实现结构=独立选择器组件（方案 B，否决 A 内联/C 跳转） | Phase A/B、文件变更清单 |

详见 decisions.md。无未解决决策。

## 12. 自审（Self-Review）

- 章节齐全：背景/目标/非目标/拆分/方案/文件清单/接口/生命周期契约表/数据模型/兼容/风险/决策/自审 ✅
- 生命周期关键词（session）命中 → 已含生命周期契约表 ✅
- YAGNI 检查：无搜索式下拉、无成员路径解析、无机器锁定——均为非目标 ✅
- 零回归路径明确：不选工作区 = 不带字段 = 既有行为（FR-04 + 兼容策略）✅
- 数据流无 dormant：workspace_id 全链路（表单→daemon.ts→router→service→lease metadata→claim payload→daemon 消费）逐跳列出，仅两端需改动 ✅
- ⚠️ 自审存疑 1：`new-session-form.test.tsx` 现存与否未确认（清单写"如无则新建"），execute 阶段核实。
- ✅ 自审存疑已解决：后端测试文件落点为 test_session_service.py（已确认存在于 daemon/tests/ 目录）。
