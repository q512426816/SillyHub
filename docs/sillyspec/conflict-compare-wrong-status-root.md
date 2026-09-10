---
author: qinyi
created_at: 2026-09-09T20:32:00
---

# 冲突对比读错工作区根——单槽位 `_sillyspecStatusRoot` 被 Temp 投毒，列表对、对比错

> **修复状态（2026-09-10 更新）**：
> - ✅ 根治已实施并合入 main（commit `28b758edc`，change
>    `2026-09-09-conflict-root-workspace-scoping` 全流程 verify PASS）：对比/裁决全链携带
>    workspace_id、daemon 映射查根未命中报 workspace_root_unknown 不回退、无 ws claim
>    不再覆盖单槽位、resolve 补成员校验、502 文案分叉；真实栈集成验证 6 项证据
>    （`.sillyspec/changes/2026-09-09-conflict-root-workspace-scoping/verify-integration.log`）。
> - ⏳ 待发版部署后验证平台实际场景，再移 `docs/sillyspec/finished/`。

## 现象（2026-09-09 实证）

平台打开冲突对比：

`GET /api/daemon/machines/{instance_id}/sillyspec-conflicts/{change}/compare?kind=spec-tree&workspace_id=...`

返回：

```json
{
  "code": "HTTP_502_DAEMON_RPC_REMOTE",
  "message": "读取机器侧冲突快照失败，请稍后重试。",
  "details": {
    "method": "sillyspec_conflict_snapshot",
    "daemon_code": "conflict_record_missing",
    "daemon_message": "冲突记录不存在：spec-sync-conflict-2026-09-02-changes-overview-card.json"
  }
}
```

易误判为「冲突记录已删、列表是旧快照」或「机器/网络故障」。本次实证两者皆非。

## 根因（半改造：列表工作区级化，对比/裁决仍单槽位）

### 证据链（本机 70f430e3 / workspace `b97f8231-…`）

| 项 | 事实 |
|----|------|
| 冲突记录文件 | **存在**：`multi-agent-platform/.sillyspec/.runtime/spec-sync-conflict-2026-09-02-changes-overview-card.json`（`created_at=2026-09-04`） |
| 单槽位落盘 | `~/.sillyhub/daemon/sillyspec-status-root.json` → `C:\Users\qinyi\AppData\Local\Temp`（`saved_at=2026-09-09T04:48:34Z` ≈ 北京 12:48） |
| 工作区映射落盘 | `~/.sillyhub/daemon/sillyspec-status-roots.json` 中 `b97f8231 → multi-agent-platform`（正确） |
| 列表为何仍显示 | 心跳采集走 `_sillyspecStatusRoots` / `sillyspec_status_map`（2026-09-08 总览工作区级化） |
| 对比为何失败 | `sillyspec_conflict_snapshot` → `conflictSnapshot` → `_statusCwd()` → **单槽位** `_sillyspecStatusRoot`（Temp）下找记录 → `conflict_record_missing` |
| 502 含义 | backend 把任意 daemon 业务 RpcError（除 forbidden）映射为 `HTTP_502_DAEMON_RPC_REMOTE`；**不是网关宕机**，重试无效 |

### 代码锚点

- 单槽位学习 / 落盘 / 恢复：`sillyhub-daemon/src/daemon.ts` `_noteSillySpecStatusRoot` / `_persistSillySpecStatusRoot` / `_restoreSillySpecStatusRoot`（注释自称为「temp 投毒排障衍生」）
- 注入：`statusCwd: () => this._sillyspecStatusRoot`；多根仅给 `statusTargets`（心跳）
- 快照：`sillyspec-manager.ts` `conflictSnapshot` / `readSillySpecConflictRecord`（缺文件不回退空快照）
- RPC 入参：`daemon.ts` `_registerSillySpecRpcHandler` 只透传 `change`/`kind`，**无 workspace_id**
- 平台侧：`sillyspec_compare.py` `_fetch_snapshot` 只发 `{change, kind}`；接口上的 `workspace_id` **仅用于平台侧** spec/progress 与成员校验
- 裁决：`SILLYSPEC_RESOLVE` payload 仅 `change`/`strategy`；`runResolve` → `_requireCommandPrecondition` 同样 `_statusCwd()` —— **点「保本地/取平台」会在 Temp 下执行 sillyspec**

### 为何映射正确、单槽位却是 Temp

`_noteSillySpecStatusRoot(workspaceId, rootPath)`：

- 有合法 UUID `workspaceId` → 更新映射 **且** 覆盖单槽位；
- `workspaceId` 为空/未知 → **只改单槽位、不进映射**（legacy）。

本次映射无任何项指向 Temp，单槽位却是 Temp → 更符合「无 workspaceId 的 claim，`rootPath=Temp`」投毒路径。单槽位几乎只挡借用沙箱 marker，**不挡系统临时目录**。

同日关联坑：`docs/sillyspec/daemon-heartbeat-workspace-key-no-uuid-guard.md`（假 ws 键 + Temp 根曾污染映射/心跳）；UUID 守卫已拦假键，**未解决「合法 claim 把单槽位写成 Temp」**。

## 临时绕过（根治前）

1. **修好前不要点裁决**（会在错误 cwd 跑命令）。
2. 在目标工作区（如 multi-agent-platform）开一次带正确 `workspaceId` + `rootPath` 的会话 claim → 单槽位被写回，对比可暂时恢复。
3. **重启 daemon 无效**（落盘已是 Temp，启动会恢复）。
4. 手改 `sillyspec-status-root.json` 的 `root_path` 指向正确仓根亦可，但下次无 workspace 的 claim 仍会再投毒。

## 根治口径（已定稿，开 change 时按此 brainstorm）

**主修（必须）：**

1. 对比 RPC `sillyspec_conflict_snapshot` 与裁决指令 `sillyspec_resolve` **强制携带 `workspace_id`**（平台 compare 已有；裁决需补 API/WS/前端——弹窗已有 `workspaceId` 却未下传）。
2. daemon 用 `_sillyspecStatusRoots.get(workspaceId)` 解析根；**映射未命中不得回退单槽位**（回退等于保留本 bug）→ 明确 RpcError（如 `workspace_root_unknown`），提示该工作区尚未被本机会话认领。
3. 无 `workspace_id` 的旧客户端：可保留单槽位仅作 legacy；新路径一律按工作区。

**辅防（建议同 change）：**

4. 无 `workspaceId` 的 claim **不再覆盖**单槽位；或单槽位学习拒绝系统临时目录（`os.tmpdir()` / `%TEMP%` 等）。「拒 Temp」黑名单**不能当主修**——错根不只有 Temp。

**范围外：**

5. `sillyspec_ghost_cleanup` 为机器级、无工作区上下文——**本次不要捆进同一 change**。
6. 前端/502 文案对 `conflict_record_missing` / `workspace_root_unknown` 显示「冲突记录失效或工作区根未认领」优于「请稍后重试」——锦上添花，非根因。

**流程：** 触及 daemon + backend + 前端 + OpenAPI，**走完整 `brainstorm → plan → execute → verify`**，不要 quick。

建议 change 名：`2026-09-09-conflict-root-workspace-scoping`。

## 建议下一步 session 提示词

```
开新 change 2026-09-09-conflict-root-workspace-scoping：
依据 docs/sillyspec/conflict-compare-wrong-status-root.md。
sillyspec_conflict_snapshot RPC 与 sillyspec_resolve 控制指令补 workspace_id；
daemon 从 _sillyspecStatusRoots 取根，映射未命中不回退单槽位；
无 workspace 的 claim 不再污染单槽位（辅防）。
ghost_cleanup 不进本 change。先 brainstorm。
```

## 关联

- 总览工作区级化 / temp 投毒注释：`sillyhub-daemon/src/daemon.ts`（2026-09-08）
- 冲突对比三端：`.sillyspec/changes/archive/2026-09-07-conflict-diff-compare/`
- 心跳 UUID 守卫：`docs/sillyspec/daemon-heartbeat-workspace-key-no-uuid-guard.md`

## 巡检注记（2026-09-09 定时扫描）

- 根治 change `2026-09-09-conflict-root-workspace-scoping` **已开且正在进行中**（本仓 .sillyspec/changes/ 下有实体，verify-facts.json 处于活跃编辑）——按本文件口径走完整流程，定时巡检不抢跑。待其 verify/archive 后本文件随验归档。
