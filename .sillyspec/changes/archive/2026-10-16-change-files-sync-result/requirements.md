---
author: flow-machine-draft
created_at: 2026-10-16T07:50:41.181Z
---
# 需求规格（Requirements）— 2026-10-16-change-files-sync-result

## 功能需求

### FR-01: 后端 _FILES_REFRESH_SYNC_RPC_TIMEOUT_S 从 3s 放宽到 15s（覆盖实测 6~13.5s 同步耗时）

- 后端 GET files?sync=1 触发 daemon 上行同步 RPC 的等待预算**必须**为 15 秒——覆盖平台侧实测 5.5~13.5 秒的真实同步耗时；原 3 秒预算下真同步恒超时、每次都静默降级返回旧数据。

#### 场景：真实同步在预算内完成

- Given 绑定 daemon 在线、daemon 串行两条 CLI 的真实同步耗时 6~13.5s
- When 用户点击「刷新」（GET files?sync=1）
- Then RPC 在 15s 预算内等到 daemon 回执，响应携带同步后数据与成功回执

#### 场景：超预算仍降级不阻断

- Given daemon 未在 15s 内回执
- When 等待预算耗尽
- Then HTTP 恒 200，响应携带 rpc_timeout 失败回执 + 现有镜像数据（GET 不因同步失败报错，D-003@v1 不破）

### FR-02: 后端消费 sillyspec_sync_change 回执：ok:false/超时/远程错误/连接丢失记 warning 日志（含 reason 与 stderr_tail），成功与防抖跳过记 info

- 后端**必须**消费 daemon 结构化回执并在失败路径记 warning 日志（含 reason 与 stderr_tail 尾段）——**禁止**再无声丢弃 ok:false 回执；成功与防抖跳过记 info。

#### 场景：CLI 失败回执透传

- Given daemon 回 `{ok:false, reason:"cli_failed", stderr_tail:"exit 1 ..."}`
- When GET files?sync=1
- Then 日志出现 warning 级 change.files_refresh_sync_failed（含 reason/stderr_tail），响应回执 ok=false 且 reason/stderr_tail 原样透传

#### 场景：防抖跳过不算失败

- Given daemon 回 `{skipped:"debounced"}`（15s 内已同步过）
- When GET files?sync=1
- Then 日志 change.files_refresh_sync_skipped（info），回执 ok=null / reason=skipped_debounced

#### 场景：四路异常降级留痕

- Given DaemonRpcTimeout / DaemonRpcRemoteError / DaemonRuntimeOffline / 其它异常任一发生
- When GET files?sync=1
- Then 各映射机读 reason（rpc_timeout / rpc_remote_error / runtime_offline / exception）记 warning，HTTP 恒 200

### FR-03: GET files?sync=1 响应新增可选 sync_result 字段（triggered/ok/reason/stderr_tail）；默认纯读不带（null）

- GET files?sync=1 响应**必须**新增可选 `sync_result`（triggered/ok/reason/stderr_tail）；默认纯读（不带 sync）时 `sync_result` **必须**为 null；未绑定/离线时 `triggered=false` 且 reason 为 no_binding / daemon_offline。

#### 场景：纯读不带回执

- Given 默认加载/轮询（不带 sync=1）
- When GET files
- Then 响应 sync_result 为 null，且不触碰 daemon 通道

#### 场景：未触发可区分

- Given 当前账号未绑定 daemon（或绑定离线）
- When GET files?sync=1
- Then 回执 triggered=false / ok=null / reason=no_binding（或 daemon_offline），HTTP 200

### FR-04: 前端「刷新」按钮：sync_result 失败或未触发时展示同步未完成提示（含原因中文标注），文件树照常展示；成功与防抖跳过不提示

- 前端「刷新」点击后**必须**按回执展示非阻塞提示条：ok=false → 「同步未完成」+ 中文原因（含 stderr 尾段）；triggered=false → 「同步未执行」+ 中文原因；成功、防抖跳过、纯读**禁止**展示提示；提示**禁止**阻塞文件树展示。

#### 场景：失败可见且不挡文件树

- Given daemon 回执 ok=false / reason=cli_failed + stderr_tail
- When 用户点击「刷新」
- Then 页面出现提示条（含「同步未完成」「CLI」「HTTP 500」等要素），文件树照常渲染

#### 场景：先失败后成功自动清除

- Given 上次刷新失败提示条在场
- When 再次刷新且回执 ok=true
- Then 提示条消失

### FR-05: 新增/更新后端与前端测试全绿，既有 test_files_refresh_sync.py 各路用例语义不回归

- 本变更**必须**伴随后端/前端相关测试全绿，既有 test_files_refresh_sync.py 各路降级用例语义**禁止**回归（含四路静默降级与触发透传断言）。

#### 场景：回归面被守护

- Given 改动后的后端 change 模块与前端变更文件树组件/工具
- When 跑目标测试集
- Then 后端模块 691 passed / 前端目标 4 文件 45 passed，0 失败

### FR-06: 后端 openapi.json 与前端/daemon api-types.ts 依据 pnpm gen:types 重新生成并提交

- 后端 openapi.json 与 frontend/daemon 两份 api-types.ts **必须**由 `pnpm gen:types`（前后端各跑一次）重新生成并随本变更提交——**禁止**手写生成物。

#### 场景：类型与 schema 同步

- Given schema.py 新增 ChangeFileSyncResult / ChangeFileList.sync_result
- When 跑 frontend 与 daemon 的 gen:types
- Then openapi.json、两种 api-types.ts 出现对应 schema，frontend/daemon typecheck 通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_files_refresh_sync.py「test_sync_budget_covers_measured_cli_runtime」
FR-02: backend/app/modules/change/tests/test_files_refresh_sync.py「test_daemon_cli_failure_result_propagates / test_daemon_no_workspace_root_result_propagates / test_daemon_debounce_skip_maps_to_info / test_rpc_timeout_degrades / test_rpc_remote_error_degrades_old_daemon / test_runtime_offline_degrades」
FR-03: backend/app/modules/change/tests/test_files_refresh_sync.py「test_online_triggers_sync_before_list / test_default_read_only_skips_sync / test_no_binding_skips_sync / test_daemon_offline_skips_sync / test_binding_without_daemon_id_skips_sync」
FR-04: frontend/src/lib/__tests__/change-file-sync.test.ts「changeFileSyncWarningText 全分支（10 例）」＋ frontend/src/components/__tests__/change-file-tree-sync-feedback.test.tsx「刷新回执提示 6 例」
FR-05: backend/app/modules/change/tests/（691 passed）＋ frontend/src/components/__tests__/change-file-tree{,-sync-feedback,-autorefresh}.test.tsx 与 src/lib/__tests__/change-file-sync.test.ts（45 passed）
FR-06: 不适用：生成物一致性由 `pnpm gen:types:check`（git diff --exit-code）+ pre-commit hook 守护，非测试用例面
