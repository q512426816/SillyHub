# MCP Tools 参考（9 个 tool）

本篇逐个列出对外 MCP 服务暴露的 9 个 tool 的 input / output schema、调用示例与错误码。
字段以 `backend/app/modules/mcp_gateway/tools.py` 实际落地的 `inputSchema` 与返回 dict
为准。

## 通用约定

- **workspace 注入**：每个 tool 的 `workspace_id` **不出现在 inputSchema**，由鉴权中间件
  从 McpToken 注入。你只能操作 token 绑定的那个 workspace；传了别的 workspace 的
  mission_id 一律视同 not found（跨 workspace 不报错，直接 404，防探测）。
- **返回值形态**：tool handler 返回 dict，由 FastMCP 序列化成 JSON 文本
  （`{content:[{type:"text", text:"<json>"}]}`）。下面 output 列的是 JSON 反序列化后的
  字段。
- **scope**：每个 tool 入口校验 scope，不足返回权限错误（见文末错误码）。scope 与 tool
  对应关系见 [security.md](security.md)。

## scope 速查

| tool | 需要的 scope |
| --- | --- |
| list_agent_profiles | read |
| list_workers | read |
| get_worker_result | read |
| get_run_logs | read |
| get_daemon_status | read |
| create_mission | dispatch |
| dispatch_worker | dispatch |
| report_progress | dispatch |
| converge_mission | converge |

---

## 1. list_agent_profiles

列当前 workspace 可见的 agent 档案（选 agent 用，read scope）。

可见集合 = 平台级公开档 ∪ 该 workspace 的 workspace 级档 ∪ 签发该 token 的用户自己的
private 档。

**Input**：无参数（`workspace_id` 由 token 注入）。

**Output**：

```json
{
  "profiles": [
    {
      "id": "uuid",
      "name": "string",
      "description": "string | null",
      "provider": "string",
      "model": "string",
      "tools_summary": {
        "tool_policy_id": "uuid | null",
        "mcp_refs": ["..."],
        "skill_refs": ["..."]
      }
    }
  ]
}
```

说明：`description` 取 profile 的 system_prompt 首行（截 200 字符），无则为 `null`；
`tools_summary` 透出 profile 的工具能力面（tool_policy / mcp_refs / skill_refs），供你
判断这个 agent 能干什么。

**错误码**：`MCP_404_WORKSPACE_NOT_FOUND`（token 绑定的 workspace 已不存在）。

---

## 2. create_mission

建一个 team / external mission（dispatch scope）。

**Input**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| objective | string | 是 | mission 目标 |
| worker_preset | array\<object\> | 否 | worker 预设列表（最多 20 条），每条 `{agent_type, model, objective, role}`。仅用于渲染给主 agent 的提示（预设角色清单），实际 worker 由主 agent 经 `dispatch_worker` 派发；`orchestration_mode="external"` 时同样只是记录 |
| main_agent_config | object | 否 | 主 agent 配置 `{agent_type, provider, model, agent_profile_id}`，缺省 `agent_type=claude_code` / `provider` 走 workspace 默认 |
| budget_usd | number | 否 | mission 预算上限（美元）。治理门按它拦超预算派发（`dispatch_worker` 被拒 `budget_exhausted` 类 reason） |
| change_id | uuid | 否 | 关联的 SillySpec change id |
| orchestration_mode | string | 否 | `team`（缺省）/ `external`，见下 |

**orchestration_mode 取值**（单 worker 场景请用 `external`，orchestrator 是纯开销）：

- `team`（缺省）：平台起一个主 agent run（role=orchestrator）+ daemon lease，由它
  编排后续 worker。适合多 worker 协作、需要平台侧主控的场景。
- `external`：**完全跳过 orchestrator**——不建主 agent run、不派 lease，返回
  `main_run_id=null` / `workers=[]`，mission 由调用方自己经 `dispatch_worker` 逐个
  派 worker 驱动。单 worker / 外部调度（如 CLI 编排独立审查）必用此模式，零
  orchestrator 开销。收敛语义与 team 一致（converge 检测到 external 自动跳过
  finalize/cleanup）。

**Output**：

```json
{
  "mission_id": "uuid",
  "status": "string",
  "main_run_id": "uuid | null",
  "workers": [
    {
      "id": "uuid",
      "role": "orchestrator",
      "status": "string",
      "objective": "string",
      "error_code": "string | null"
    }
  ]
}
```

说明：`workers` 即主 agent run（role=orchestrator）单条，第三方据此拿 `main_run_id`
去调 `get_run_logs` / `dispatch_worker`；`external` 模式 `main_run_id=null` /
`workers=[]`。team 模式 daemon 离线 / workspace 未绑定 daemon 时主
agent run 标 `pending` + `error_code`，不抛错（mission 仍建成，靠后台 reconcile 重派）；
派发前可用 `get_daemon_status` 先探在线性。

**调用示例**：

```json
{
  "objective": "对 PR 1234 做独立审查",
  "budget_usd": 1.0,
  "orchestration_mode": "external"
}
```

**错误码**：`MCP_400_MCP_TOKEN_NO_CREATOR`（token 无签发用户归属（`created_by` 为空），
无法作为派发 actor——用 `POST /api/workspaces/{id}/mcp-tokens` 由真实用户签发的
token，或给存量 token 补 `created_by`；签发用户被删同样触发）。

---

## 3. dispatch_worker

派一个 worker run（dispatch scope）。

**Input**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| mission_id | uuid | 是 | 目标 mission |
| objective | string | 是 | 该 worker 的子目标 |
| role | string | 否 | worker 角色，缺省 `worker` |
| agent_type | string | 否 | agent 类型标签。**缺省跟随目标 workspace 的 `default_agent`（部署级默认执行器，如 `pi`），未配置才回退 `claude_code`**。它是展示标签，真正选执行器的是 provider（同样解析 `workspace.default_agent`），显式传值仅影响标签与审计 |
| model | string | 否 | 指定模型（如 `zai/glm-5.2`） |
| read_only | bool | 否 | 只读模式，缺省 `false`。落 `run.read_only` 审计列并经 daemon 物制成 `--allowedTools Read,Glob,Grep`（审查类任务建议开） |
| agent_profile_id | uuid | 否 | 绑定 AgentProfile 精确选 agent（配合 `list_agent_profiles` 取 id），缺省走兜底链 |
| worktree_path | string | 否 | 调用方自带 worktree 的**绝对路径**（daemon 侧可达）。非空时平台跳过自建 worktree，直接以它为执行根——路径必须是目标 daemon 所在机器上的路径，且须已存在 |
| branch | string | 否 | 调用方 worktree 的分支名（如 `sillyspec/<change>`）。仅入 lease metadata，**不落 `run.worktree_branch`**（防 finalize 误 merge 调用方分支） |
| worker_prompt | string | 否 | 整段覆写 worker prompt（含「不 commit / 不越界」指令由调用方自负）。缺省用平台渲染的模板 |
| target_workspace_id | uuid | 否 | 跨 workspace 派发目标，缺省派到 mission 锚点 workspace。必须 ∈ mission 的 scope，且 token 签发人对目标 workspace 有写权限 |

`agent_profile_id` 传入时做三级 visibility + workspace 归属校验（workspace 级 profile
须属于本 mission 的 workspace，private / platform 级放行），校验通过后冻结
`agent_profile_snapshot`（含 version）落 `run`，历史 run 不受档案后续编辑影响。

**Output**：

```json
{
  "id": "uuid",
  "role": "string",
  "objective": "string",
  "status": "string",
  "agent_type": "string",
  "lease_id": "uuid | null",
  "error_code": "string | null"
}
```

说明：派发前过治理门（取消 / 并发上限 / 预算）。被治理门拒绝时**直接抛 MCP 错误**
（`MCP_400_DISPATCH_WORKER_REJECTED`，携带 reason，不产生 run）；daemon 离线 /
worktree 建不起来时 run 标 `failed` + `error_code`（如 `no_online_daemon`），不抛。
派发前可用 `get_daemon_status` 先探在线性，避免真派一次才发现没人认领。

**错误码**：`MCP_404_MISSION_NOT_FOUND`（mission 不存在或不属于本 workspace）、
`MCP_400_MCP_TOKEN_NO_CREATOR`（token 无签发用户归属，修复动作见 create_mission 节）、
`MCP_400_DISPATCH_WORKER_REJECTED`（治理门拒绝，reason 在错误信息里）、
`MCP_400_AGENT_PROFILE_UNAVAILABLE`（agent_profile_id
不存在或当前 token 无可见性）、`MCP_400_AGENT_PROFILE_WORKSPACE_MISMATCH`（workspace 级
profile 不属于本 mission 的 workspace）、`MCP_400_MISSION_TARGET_OUT_OF_SCOPE` /
`MCP_403_MISSION_TARGET_FORBIDDEN`（跨 workspace 派发越界 / 无写权限）、
`HostFsDelegateUnavailable`（workspace 未绑定 daemon，wiring 错误，会显式报错）。

---

## 4. list_workers

列 mission 下所有 run 状态（含主 agent run，read scope）。

**Input**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| mission_id | uuid | 是 | 目标 mission |

**Output**：

```json
{
  "mission_id": "uuid",
  "workers": [
    {
      "id": "uuid",
      "role": "string",
      "status": "string",
      "objective": "string",
      "total_cost_usd": "number | null"
    }
  ]
}
```

**错误码**：`MCP_404_MISSION_NOT_FOUND`。

---

## 5. get_worker_result

读单个 worker 的结构化产出（read scope）。

**Input**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| mission_id | uuid | 是 | 目标 mission |
| worker_id | uuid | 是 | 目标 worker run id |

**Output**：

```json
{
  "worker_id": "uuid",
  "status": "string",
  "artifacts": [
    { "kind": "string", "content_ref": "string", "id": "uuid" }
  ]
}
```

说明：`artifacts[].kind` 如 `patch` / `summary` 等。worker 不属于该 mission → 404。

**错误码**：`MCP_404_MISSION_NOT_FOUND`、`MCP_404_WORKER_RUN_NOT_FOUND`。

---

## 6. get_run_logs

读单个 run 的执行日志（read scope）。

**Input**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| mission_id | uuid | 是 | 目标 mission |
| worker_id | uuid | 是 | 目标 run id（worker_id 即 run_id） |
| limit | int | 否 | 返回条数上限，缺省 `100` |
| channel | string | 否 | 按 channel 过滤（`stdout` / `stderr` / `tool_call`） |

**Output**：

```json
{
  "logs": [
    {
      "timestamp": "ISO8601 string",
      "channel": "string",
      "tool_kind": "string",
      "content_redacted": "string"
    }
  ]
}
```

说明：按时间升序。**只返回 `content_redacted`（脱敏后内容），不返回原始 `content`**——
平台只存脱敏后日志，密钥永不外泄。

**错误码**：`MCP_404_MISSION_NOT_FOUND`、`MCP_404_WORKER_RUN_NOT_FOUND`。

---

## 7. converge_mission

触发 mission 收敛（converge scope）。**可重入状态机**。

**Input**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| mission_id | uuid | 是 | 目标 mission |

**Output**：

```json
{
  "mission_id": "uuid",
  "status": "string",
  "converged": true,
  "artifact_id": "uuid | null",
  "merged_branches": ["..."],
  "conflicts": ["..."],
  "attempt": 0
}
```

`status` 取值与含义：

| status | 含义 | 下一步 |
| --- | --- | --- |
| `merged` | 全部分支已合并，worker 副本已清理 | 流程结束 |
| `conflict` | 有 git 冲突，`conflicts` 列出冲突项 | 让主 agent 解冲突后**再次调用**本 tool 重入 |
| `failed_manual` | 解冲突轮次超上限（默认 3 次，R-07），已标 needs_manual | 需人工介入 |
| `done` / `degraded` / `running` | bootstrap mission（无 merge 需求）走既有收敛语义 | 视 converged |

说明：解冲突轮次计数存 mission.constraints，上限默认 3（env
`CONVERGE_MAX_CONFLICT_ATTEMPTS` 可覆盖），超限标 `failed_manual`。

**错误码**：`MCP_404_MISSION_NOT_FOUND`、
`MCP_404_ORCHESTRATOR_RUN_NOT_FOUND`（mission 没有主 agent run）。

---

## 8. report_progress

落主 agent 决策日志（dispatch scope）。

**Input**：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| mission_id | uuid | 是 | 目标 mission |
| run_id | uuid | 是 | 目标 run id |
| message | string | 是 | 日志内容 |
| decision | string | 否 | 决策标签，拼到内容前缀便于筛选 |

**Output**：

```json
{ "run_id": "uuid", "log_id": "uuid" }
```

说明：写入 AgentRunLog（channel=tool_call）。`decision` 非空时内容形如
`[<decision>] <message>`。run 不属于该 mission → 404。

**错误码**：`MCP_404_MISSION_NOT_FOUND`、`MCP_404_RUN_NOT_FOUND`。

---

## 9. get_daemon_status

查 token 绑定 workspace 的 daemon 在线状态（read scope，**轻量无副作用**——派发前
探查用，不必真派一次 worker 才发现没人认领）。

**Input**：无参数（`workspace_id` 由 token 注入）。

**Output**：

```json
{
  "workspace_id": "uuid",
  "daemon_online": true,
  "daemon_name": "string | null",
  "stale_threshold_seconds": 45,
  "daemons": [
    {
      "daemon_id": "uuid",
      "daemon_name": "string",
      "user_id": "uuid",
      "shared": false,
      "status": "online",
      "last_heartbeat_at": "ISO8601 string | null",
      "heartbeat_age_seconds": 12,
      "ws_connected": true,
      "online": true
    }
  ]
}
```

口径说明：

- `daemon_online`：任一成员 binding 的 daemon 满足 `status=online` 且心跳在
  `stale_threshold_seconds`（45s，与平台 runtime 清扫阈值同源）内——回答「现在派发
  会不会有 daemon 认领」。无任何 binding 时为 `false`（此时派发必失败
  `no_online_daemon`）。
- `ws_connected`：backend 与该 daemon 的 **WebSocket 实时连接态**（派发侧同款双重
  校验）。DB `status` 在 daemon 掉线后最长 45s 仍显示 `online`（假在线窗口），
  `ws_connected` 才是「此刻能收任务」的最强信号；两者都为真才算真可派发。
- `heartbeat_age_seconds`：最近心跳距今秒数，调用方据此自判新鲜度。
- `daemon_name`：在线 daemon 的机器名（`display_alias` 优先），无在线时给首个
  binding 的机器名，无 binding 时 `null`。

**错误码**：`MCP_404_WORKSPACE_NOT_FOUND`。

---

## 错误码总表

tool 调用层错误以 MCP error 返回（FastMCP 把异常包装成 JSON-RPC error）。鉴权 / scope
错误发生在 tool 触达业务逻辑之前。

| HTTP / code | 触发条件 |
| --- | --- |
| `HTTP_401_MCP_TOKEN_MISSING`（401） | 没带 `Authorization: Bearer` header |
| `HTTP_401_MCP_TOKEN_INVALID`（401） | token 未知 / 已吊销 / 前缀不对（message 统一，不区分哪种） |
| `MCP_AUTH_ERROR`（500） | 鉴权后端（DB / 缓存）不可用 |
| scope denied（403） | token 缺该 tool 所需 scope（`require_mcp_scope`） |
| `MCP_404_MISSION_NOT_FOUND` | mission 不存在或不属于本 workspace |
| `MCP_404_WORKER_RUN_NOT_FOUND` | worker run 不存在或不属于该 mission |
| `MCP_404_RUN_NOT_FOUND` | report_progress 的 run 不属于该 mission |
| `MCP_404_ORCHESTRATOR_RUN_NOT_FOUND` | converge 时 mission 没有主 agent run |
| `MCP_404_WORKSPACE_NOT_FOUND` | token 绑定的 workspace 已不存在 |
| `MCP_400_MCP_TOKEN_NO_CREATOR` | token 无签发用户归属（`created_by` 为空或签发用户被删），无法作为派发 / 可见性 actor。修复：用 `POST /api/workspaces/{id}/mcp-tokens` 由真实用户签发的 token，或给存量 token 补 `created_by` |
| `MCP_400_DISPATCH_WORKER_REJECTED` | 治理门拒绝派发（mission 取消 / 并发上限 / 预算耗尽，reason 见错误信息），不产生 run |
| `MCP_400_MISSION_TARGET_OUT_OF_SCOPE` | dispatch_worker 的 target_workspace_id 不在 mission scope |
| `MCP_403_MISSION_TARGET_FORBIDDEN` | token 签发人对跨 workspace 派发目标无写权限 |
| `MCP_400_AGENT_PROFILE_UNAVAILABLE` / `MCP_400_AGENT_PROFILE_WORKSPACE_MISMATCH` | agent_profile_id 不可见 / workspace 归属不符 |
| `MCP_400_MCP_TOKEN_CREATOR_GONE` | token 签发用户对应的 User 行已被物理删除 |
