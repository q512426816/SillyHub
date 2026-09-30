# 平台 Agent 日志上报协议（Platform Agent Log Protocol）

> 版本：v2（2026-09-30 · 变更 2026-09-30-tool-report-activation-wrong-machine 起草并沉淀主仓）
> v1 语义见 2026-08-23-platform-agent-log-ingest（协议文档此前散见 sillyspec 仓与模块文档，本文件为主仓权威沉淀）。

## 1. 端点与鉴权

- `POST /api/platform-sync/agent-logs`（旧路径 `/api/agent-logs` 同路由）：CLI `sillyspec run` 入口 best-effort 批量推送本地 harness 会话日志元信息。
- 鉴权：仅 `shpsync_` token（workspace 派生唯一权威）；JWT / `shk_live_` 一律 403。
- body `workspace_id` 被忽略（extra=ignore）——workspace 以 token 派生为准。

## 2. 请求体

```json
{
  "schema_version": 2,
  "pushed_at": "2026-09-30T03:00:00.000Z",
  "agent_cwd": "C:/Users/qinyi/IdeaProjects/multi-agent-platform",
  "scan_run_id": "run-20260930-0053",
  "hub_session_id": null,
  "entries": [
    {
      "harness": "zcode",
      "log_path": "C:/Users/qinyi/.zcode/cli/rollout/model-io-sess_<uuid>.jsonl",
      "format": "zcode-model-io-jsonl",
      "session_id": "<引擎侧会话 id>",
      "agent_cwd": "C:/Users/qinyi/IdeaProjects/multi-agent-platform",
      "first_seen_at": "2026-09-30T00:34:57.342Z",
      "last_seen_at": "2026-09-30T01:08:20.872Z",
      "machine": {
        "machine_id": "0f1e2d3c-4b5a-4c6d-8e9f-a0b1c2d3e4f5",
        "hostname": "DESKTOP-HJ0AM09"
      }
    }
  ]
}
```

- `entries` 1..50 条；同请求同 `log_path` 后者胜；幂等键 `(workspace_id, log_path)` 整行覆盖（`created_at` 保留）。
- 时间字段为 CLI ISO 8601 UTC 原文（字典序 = 时间序）。
- 未知字段 `extra=ignore` 静默丢弃（schema 升版演进靠加列，不 422）。

## 3. machine 块（v2 新增）

**目的**：让平台知道「这条日志产生于哪台机器」——本地 Agent 会话（tool_report）接手（takeover）时按原机钉定派发，杜绝错机派发（Windows 路径派到 Mac 等实证故障）。

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `machine.machine_id` | string ≤64 | 否 | 上报方持久 machineId（uuid）。**生成约定**：`~/.sillyhub/daemon/machine-id` 文件（daemon 侧 `readOrCreateMachineId` 读/生成；CLI 侧 v2 起读同一文件，无则生成于 `~/.sillyhub/machine-id` 并与 daemon 侧约定互相同步） |
| `machine.hostname` | string ≤255 | 否 | 上报方主机名（`os.hostname()`，匹配平台 `daemon_runtimes.name`） |

- 整块可选：老 CLI 不携带 → 平台两列落 NULL、接手走 cwd ∈ allowed_roots 匹配（四级匹配③级）。
- 双空块等价缺块。
- 上报方：
  - **daemon 注入路径**（daemon 派发的 agent 进程，`SILLYHUB_SESSION_ID` env 注入）：daemon 自动附带自身 machine_id + hostname。
  - **CLI 直跑路径**（用户终端 `sillyspec run`）：CLI 附带本机 hostname（machineId 待 CLI v2 升级，跨仓 sillyspec 变更跟踪）。

## 4. 服务端落点

- `platform_agent_logs.reported_machine_id` / `reported_machine_name`（entry 级，随整行覆盖翻转）。
- tool_report 聚合会话 `config_snapshot.latest_reported_machine = {machine_id, hostname}`（组内 `last_seen_at` 最大 entry 胜出）——接手（takeover）四级匹配的数据源：
  1. `machine_id` 精确匹配在线 runtime（`daemon_runtimes.metadata.machine_id`，daemon 心跳携带同源值）
  2. `hostname` 匹配 `daemon_runtimes.name`（在线）
  3. 存量无机器信息：`agent_cwd ∈ runtime.allowed_roots` 唯一匹配
  4. 无果 409 中文报错（不静默换机）

## 5. 变更历史

- v2（2026-09-30）：entries 增 `machine` 块；daemon 心跳协议同步增 `machine_id` 键（`POST /api/daemon/heartbeat`）。
- v1（2026-08-23）：初始协议（entries 元信息 + hub_session_id 关联 + entry 级 ctx）。
