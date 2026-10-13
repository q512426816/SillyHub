---
author: qinyi
created_at: 2026-10-13 12:57:48
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）— 2026-10-13-change-files-refresh-sync

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户（工作区成员） | 在变更详情页刷新文件树，期望看到绑定 daemon 本机的最新文档数据 |
| daemon（开发机守护进程） | 持有工作区本地副本，被动接受平台 RPC 触发执行 sillyspec CLI 上行同步 |
| 平台管理员 | 无特殊入口；未绑定 daemon 时与普通用户同走降级路径 |

## 功能需求

### FR-01: 刷新触发定向上行同步
Given 当前用户在工作区已绑定 daemon 且 daemon 在线，变更 X 存在于该 daemon 的本地工作区
When 用户请求 GET /api/workspaces/{ws}/changes/{id}/files
Then backend 经同步 RPC 触发该 daemon 仅对变更 X 串行执行 `sillyspec platform sync --change X` 与 `sillyspec platform sync-docs --change X`，同步完成后返回扫描镜像目录的文件清单

### FR-02: 四路静默降级
Given daemon 未绑定 / 离线 / RPC 超时（15s）/ 远端返回错误（含老 daemon 未注册 method）
When 用户请求 GET files
Then 全部静默降级：log.info 留痕后直接返回现有镜像数据，HTTP 不 500、响应 schema 不变

### FR-03: daemon 侧防抖
Given 同一 (workspace_id, change) 在 15s 内已触发过一次同步，或该 key 的同步正在执行
When 再次收到 sillyspec_sync_change RPC
Then 直接回执 skipped（debounced / in_flight），不重复执行 CLI

### FR-04: 仅此变更粒度
Given 任一次触发
Then daemon 只对该 change 执行同步命令，不触发全树同步

### FR-05: daemon 侧参数守卫
Given 收到 sillyspec_sync_change 请求
Then change 过 SAFE_CHANGE_NAME_RE 白名单（拒路径穿越），workspace_id 过 UUID 形态守卫；无本地根映射返回结构化失败（no_workspace_root）

## 非功能需求
- 兼容性：新 backend + 老 daemon 自动降级（method not found → DaemonRpcRemoteError → 降级）；老 backend + 新 daemon 新注册闲置无害；部署顺序 daemon 先、backend 后，无破坏窗口。
- 可用性：GET files 可用性优先于数据新鲜度——同步失败绝不阻断刷新。
- 性能：常态路径（防抖命中 / 无差异 CLI 短路）接口增量 3~8s 内；RPC 硬超时 15s 兜底。
- 资源：CLI 子进程 execFile 120s 硬超时自灭；防抖 Map 惰性清理 + 1000 条硬帽。
- 安全：change 参数白名单双端对齐（daemon SAFE_CHANGE_NAME_RE），workspace_id UUID 守卫，CLI cwd 限定主仓根。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-04 | 串行两条 CLI（sync 落镜像 + sync-docs 落 DB），仅 change 粒度 |
| D-002@v1 | FR-01 | GET 内同步 RPC 触发机制 |
| D-003@v1 | FR-02 | 四路静默降级铁律 |
| D-004@v1 | FR-03 | 15s TTL + in-flight 防抖 |
| D-005@v1 | FR-01, FR-02 | 改动面边界（router 层前置、service 零改动、前端零改动） |
| D-006@v1 | — | rejected：fire-and-forget + 前端二次刷新 |
| D-007@v1 | — | rejected：显式 POST 同步端点 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
