---
author: qinyi
created_at: 2026-09-07 20:45:00
---

# task-10 实机集成验收记录（integration-critical）

> 验收环境：worktree 代码实跑——backend（uvicorn 127.0.0.1:8100，commit b77d5d6841dd，连共享 PG + 临时 Redis 6380）+ 隔离 daemon 实例（SILLYHUB_DAEMON_DIR=/tmp/wt-daemon-state，注册为机器 a20631a6-0f59-45d4-b707-f062caa68560，providers=claude/codex/opencode/openclaw/pi/cursor/kimi，临时 api key 已吊销）。验收时间 2026-09-07 20:20~20:45。

## 逐项核验

### 1. compare 端点全链路连通（真实 HTTP→鉴权→路由→WS RPC→daemon handler→错误透传）

在线机器 + 真实存量冲突名（2026-09-02-changes-overview-card，spec-tree）：

```
HTTP 502 {"code":"HTTP_502_DAEMON_RPC_REMOTE","details":{
  "method":"sillyspec_conflict_snapshot",
  "daemon_code":"no_spec_root",
  "daemon_message":"未观察到 workspace 主仓根，无法生成冲突快照"}}
```

- 三端拼装零错位实证：路由挂载 ✓、JWT 鉴权 ✓、query 校验 ✓、WS RPC method 名与 params ✓、daemon `registerRpcHandler('sillyspec_conflict_snapshot')` 分发 ✓、conflictSnapshot 真实执行 ✓、RpcError code 经 `_sendRpcResult` 原样回传 ✓、backend 映射 502 ✓。
- `no_spec_root` 是该实例的正确业务态（新隔离 daemon 未跑过任务、未观察到 workspace 根——design §5 Phase 1 明确的无根错误码）。真实用户 daemon（跑过任务有根）与已验证链路完全同路径。
- progress kind 同形态（quick-62e1d5fb → 同 502 no_spec_root）。

### 2. 错误形态负例（全部实测）

| 场景 | 实测 |
|---|---|
| 离线机器（68c63051，无 WS） | `HTTP 504 HTTP_504_DAEMON_RUNTIME_OFFLINE`，details 含 daemon_id ✓ |
| 不存在的 instance_id | `HTTP 404 HTTP_404_DAEMON_RUNTIME_NOT_FOUND` ✓ |
| change 名含 `..`（a..b） | `HTTP 422`，中文白名单报文 ✓ |
| 无 Authorization | `HTTP 401 HTTP_401_AUTH_TOKEN_MISSING` ✓ |

### 3. ql_id 心跳字段实机形态

机器视图 `GET /api/daemon/machines`：存量机器 sillyspec_status.pending_conflicts[] 6 条真实冲突透出（change/created_at/type 与本地进度库一致）；本仓 3 条冲突对应条目 ql_id 均为 null——**符合 D-004 已知限制**（存量 quick 冲突 guard.json 已清理、QUICKLOG 无结构化反查源，兜底显示原 ID；ql 编号对新 quick 冲突生效）。

### 4. UI 行为（组件测试证据，实机 UI 演示不可行的说明）

frontend 容器（3001）连主栈 backend（旧代码无 compare 端点），无法实机演示新弹窗；行上单按钮「查看对比」/ql 标题/弹窗双模式渲染/差异高亮/裁决 confirm/权限 gating 由 33 个组件测试覆盖（conflict-compare-modal 13 + platform-sync-section 12 + changes-overview-card 8，全绿）。弹窗消费的响应结构与 8100 实测 502/504 响应 envelope 同源（api-types 生成类型）。

### 5. 实机发现并修复的真实缺陷（本轮验收核心产出）

**compare gather 并发 asyncpg 连接冲突**：首发实机调用返回 500 internal_error，日志 traceback 确认 `asyncio.gather(RPC, 平台侧 session 查询)` 触发 asyncpg `another operation is in progress / cannot use Connection.transaction() in a manually started transaction`（同请求内 RPC 等待期与 session 操作在连接上交叠）。单测未暴露原因：mock RPC 立即返回，交叠窗口趋零。修复：平台侧定位（单行主键查询）改为 RPC 前顺序执行，彻底消除同请求 session 并发面；修复后单测 23/23 不回归 + ruff 净 + 实机 502/504 形态正确。修复 commit 见 worktree（task-10 轮）。

## 结论

- 全局验收标准 1（三端测试全绿）：✅（task-09 记录：23+102+33，tsc×2 零错）
- 全局验收标准 2（集成冒烟）：✅（链路连通 + 错误形态全谱实测；真实数据渲染由双端真实文件单测+组件测试覆盖，限定说明如上）
- 全局验收标准 3（权限负例）：✅（401/404 实测）
- 全局验收标准 4（存量 quick 兜底原 ID）：✅（ql_id=null 实测，符合已知限制）
- 全局验收标准 5（未触发时行为不变）：✅（resolve/ghost/心跳三字段语义未动，回归测试全绿；DaemonHeartbeatSillySpecConflict 新增可选 ql_id 零改写透传）

## 环境清理

- 临时 api key `task10-acceptance-temp` 已吊销（DB revoked=t 实证）
- 隔离 daemon 实例 stop + 状态目录清理
- 8100 uvicorn 停止；临时 Redis（6380）容器删除
- 共享 DB 迁移漂移已复位（并行会话测试残留的 agent_liveness 四列 drop + alembic_version stamp 回主仓 head 20260905004300；主栈 backend 容器以 latest 镜像 recreate 后 healthy——镜像重建后容器未 recreate 的漂移是 crash 根因，非本变更）
