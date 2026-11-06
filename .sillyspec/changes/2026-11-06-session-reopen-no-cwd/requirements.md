---
author: qinyi
created_at: 2026-11-06 22:25:04
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在平台发起/续聊会话的终端用户（本案核心：使用非工作区闲聊会话的用户） |
| backend | FastAPI 服务：reopen 校验、SESSION_RESUME 下发、cwd 落库端点 |
| daemon | 本地守护进程：会话进程管理、三级链 cwd 解析、回报携带 |

## 功能需求

### FR-01: 非工作区会话重开续聊（存量救回）
Given 一条 `cwd` 为空且 `agent_session_id` 非空的已结束（ended/failed）会话
When 用户点「重新开启」
Then backend 不再以 `HTTP_409_DAEMON_SESSION_NO_CWD` 拒绝；SESSION_RESUME 下发不含 cwd 键；daemon 按三级链（payload → 本地快照 → `config.workspace_dir`）解析出 cwd 完成 SDK resume，会话经 confirm 回到 active，可继续对话。
关联: FR-daemon-369（同一 resume 恢复链路 `_routeSessionResume` 的行为扩展；不改写其 lastActiveAt 保留语义，三级链与 lastActiveAt 三级取值同构共存）

### FR-02: reopen 放行口径
Given 一条 `agent_session_id` 也无法自愈（从未成功建立 SDK 会话）的会话
When 用户点「重新开启」
Then 仍被拒绝（`DaemonSessionNoAgentSession` 409）——放行只放宽 cwd 维度，SDK 标识维度维持现状；放行不按会话来源（origin）区分。

### FR-03: 新建会话 cwd 回报落库
Given 一条新建非工作区会话在 daemon 侧创建成功（create 或 recover 路径）
When daemon 上报 session ready（或 reopen 后 confirm reconnected）
Then 请求体携带可选 `cwd` 键（值为实际生效目录）；backend 端点对非空字符串落 `agent_sessions.cwd`，缺键/空串 no-op；daemon 为目录真相源，异值以回报覆写。

### FR-04: daemon 解析失败收敛
Given 三级链解析出的目录无法完成 SDK resume（目录错配/快照与 transcript 均不存在）
Then 走既有 markRecoveryFailed 链将会话翻 failed，用户看到明确失败——不静默错聊、不挂起。

### FR-05: 工作区会话零回归
Given 一条 cwd 非空的工作区会话
When 重开或续聊
Then 行为与现状逐字节一致：payload cwd 键照发、daemon 三级链第一级命中、回报值与库中一致（幂等）。

### FR-06: schema 与生成物义务
Given backend 请求 schema 增加 `cwd` 可选字段（SessionRuntimeRequest / ready 端点 body）
When 同一变更内
Then 前端 `pnpm gen:types` 与 `pnpm -C sillyhub-daemon gen:types` 双端跑并提交 `frontend/src/lib/api-types.ts` + `sillyhub-daemon/src/api-types.ts` + `backend/openapi.json`；`DaemonSessionNoCwd` 从 OpenAPI 面退役。

## 非功能需求
- 兼容性：灰度双向安全——老 backend 忽略 daemon 新键、老 daemon 对无 cwd 键 payload 得空串走既有失败链（明确 failed，不静默）；发版顺序先 daemon 后 backend。
- 兼容性：无 DB schema 迁移（复用既有 `agent_sessions.cwd` 列）；无新端点、无既有端点删除。
- 回退性：backend 键位可选 + 单校验块删除，回滚 commit 即回 DS-7 现状；daemon 三级链第一级对工作区会话零变化。
- 平台兼容：路径/换行处理兼容 Windows/Linux/macOS（cwd 字符串原样透传，不做归一化——与 daemon 侧快照/配置值同源同拼写）。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-03 | 组合方案：回报+兜底两条腿 |
| D-002@v1 | FR-01, FR-04 | v1 双源表述，已被 v2 三级链取代（supersedes 留档） |
| D-002@v2 | FR-01, FR-04 | 三级同源兜底链 + DS-7 放宽 + NO_CWD 退役 |
| D-003@v1 | FR-03, FR-05 | cwd 真相源在 daemon，backend 不推导 |
| D-004@v1 | FR-02 | scan/bootstrap 顺带可重开，统一放行口径 |
| D-005@v1 | FR-03（负向约束） | rejected：不做 backend 分配目录 |
| D-006@v1 | FR-02（负向约束） | rejected：不做 origin 分流 |
| D-007@v1 | FR-01, FR-02, FR-03 | 回报捎带既有通道 |
| D-008@v1 | FR-03（负向约束） | rejected：不建独立回报端点 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-06: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
