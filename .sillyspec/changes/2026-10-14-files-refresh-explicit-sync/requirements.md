---
author: flow-machine-draft
created_at: 2026-10-14T00:45:14.881Z
---
# 需求规格（Requirements）— 2026-10-14-files-refresh-explicit-sync

## 功能需求

### FR-01: GET files 默认（不带 sync 参数）为纯读：不触发 daemon 同步、直接返回平台镜像数据，响应语义与现状一致

- GET /changes/{id}/files 在不带 `sync` 参数（或 sync=false）时，禁止向 daemon 通道发起任何 RPC，必须直接扫描平台镜像目录并返回清单（响应 schema 与既有 ChangeFileList 一致）。

#### 场景：默认纯读零同步

Given 当前用户工作区已绑定 daemon 且在线
When 请求 GET files（不带 sync 参数）
Then daemon RPC 通道零调用，响应 200 且 items 为平台镜像现有内容

### FR-02: 显式 sync=1（前端刷新按钮点击、错误重试）才触发 daemon 定向上行同步，等待预算从 15s 降到 3s，超时静默降级返回现有镜像数据

- 带 `sync=1` 的 GET files 必须先经绑定 daemon 触发一次此变更的定向上行同步（RPC 等待预算 3s）；同步失败/超时/未绑定/离线时禁止报错，必须静默降级返回现有镜像数据（HTTP 200）。

#### 场景：点击刷新触发同步

Given 绑定 daemon 在线
When 请求 GET files?sync=1
Then 先向该 daemon 发送 sillyspec_sync_change RPC（timeout=3.0），同步完成后返回新鲜清单

#### 场景：超时降级

Given 绑定 daemon 在线但同步超过 3s 预算
When 请求 GET files?sync=1
Then RPC 超时被静默消化，响应 200 返回现有镜像数据（CLI 后台跑完，daemon 防抖 15s 内再点秒回新数据）

### FR-03: 悬浮面板 autoRefreshMs 轮询、初始挂载加载、保存后刷新均不带 sync（不触发同步）

- 前端仅「刷新」按钮 onClick 与 ErrorBanner onRetry（用户主动动作）必须以 sync=true 调用 listChangeFiles；初始挂载 useEffect、autoRefreshMs 定时轮询、保存成功后刷新禁止传 sync。

#### 场景：轮询零同步

Given 悬浮面板开着（autoRefreshMs=15000 轮询中）
When 定时器触发 refreshTree
Then 发出的 GET files 不带 sync 参数（纯读，零 daemon 开销）

### FR-04: backend/daemon typecheck + 聚焦测试全绿，api-types 经 gen:types 再生成

- 收口前 backend ruff/mypy 与前端 tsc 必须零错误；backend 聚焦测试（test_files_refresh_sync + test_files_router）与前端聚焦测试（change-file-tree 系 + session-change-files-hover）必须全绿；backend OpenAPI schema 变更后必须经 `pnpm gen:types` 再生成并提交 api-types.ts + openapi.json。

#### 场景：静态与测试门

Given 全部代码改动落盘
When 跑 lint/typecheck/聚焦测试与 gen:types
_then 全部通过且生成件已更新（backend openapi.json + frontend api-types.ts）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_files_refresh_sync.py「test_default_read_only_skips_sync」
FR-02: backend/app/modules/change/tests/test_files_refresh_sync.py「test_online_triggers_sync_before_list」「test_rpc_timeout_degrades」「test_no_binding_skips_sync」「test_daemon_offline_skips_sync」「test_rpc_remote_error_degrades_old_daemon」「test_runtime_offline_degrades」「test_binding_without_daemon_id_skips_sync」
FR-03: frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx「初始挂载与 autoRefresh 轮询：listChangeFiles 无 sync 选项（纯读，零 daemon 开销）」「点击「刷新」按钮：listChangeFiles 以 sync:true 调用（触发 daemon 同步）」+ frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx 回归
FR-04: backend/app/modules/change/tests/test_files_router.py 回归 15 用例 + frontend tsc --noEmit exit 0（执行记录见 flow 收口摘要）
