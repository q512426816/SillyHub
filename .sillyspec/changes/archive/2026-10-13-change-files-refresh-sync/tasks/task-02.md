---
id: task-02
title: 'daemon RPC 注册——daemon.ts `SillySpecCommandExecutor` 接口加 `runSyncChange`；`_registerHostFsRpcHandler` 同款注册 `sillyspec_sync_change` handler：change 过 SAFE_CHANGE_NAME_RE（拒穿越）+ workspace_id 过 isWorkspaceIdShape → 防抖（模块级 Map：15s TTL 惰性清理 + 1000 条硬帽 + in-flight 去重，命中回 skipped）→ 调执行器回结构化 result（不 reject） [target: sillyhub-daemon/src/daemon.ts]'
title_zh: 'daemon RPC 注册——daemon.ts `SillySpecCommandExecutor` 接口加 `runSyncChange`；`_registerHostFsRpcHandler` 同款注册 `sillyspec_sync_change` handler：change 过 SAFE_CHANGE_NAME_RE（拒穿越）+ workspace_id 过 isWorkspaceIdShape → 防抖（模块级 Map：15s TTL 惰性清理 + 1000 条硬帽 + in-flight 去重，命中回 skipped）→ 调执行器回结构化 result（不 reject） [target: sillyhub-daemon/src/daemon.ts]'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-13 12:58:32
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-05]
decision_ids: [D-002@v1, D-004@v1, D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
target_files: [sillyhub-daemon/src/daemon.ts]
goal: >
  daemon 注册 sillyspec_sync_change RPC handler：参数守卫 + 15s 防抖/in-flight 去重 + 调 task-01 执行器并结构化回执——平台刷新触发的 daemon 侧入口（D-002/D-004）。
implementation:
  - daemon.ts SillySpecCommandExecutor 接口（daemon.ts:1554）新增 runSyncChange(change, workspaceId?) 签名声明（task-01 已落执行器实现）
  - _registerHostFsRpcHandler（daemon.ts:6950）同款 ws.registerRpcHandler('sillyspec_sync_change', handler) 注册（注册函数内或紧邻新增，与 host_fs.* 十三方法并列）
  - 参数守卫：change 过 SAFE_CHANGE_NAME_RE（daemon.ts:1611，与墓碑收敛双端对齐）；workspace_id 过 isWorkspaceIdShape（daemon.ts:1335）——不合法抛 RpcError invalid_params
  - 防抖（D-004）：模块级 Map<`${workspaceId}:${change}`, {ts}>——15s 内已结束回 {skipped:'debounced', last_sync_at}；同 key in-flight 回 {skipped:'in_flight'}；惰性清理过期项 + 1000 条硬帽（超帽淘汰最旧，R-06）
  - in-flight 标记以执行 Promise 生命周期为界（CLI 结束才解除，覆盖 RPC 已超时但 CLI 仍在跑的窗口错位，R-05）
acceptance:
  - 非法 change（含 ../ 穿越）与非法 workspace_id 被 RpcError 拒绝
  - 防抖窗口内重复请求回 skipped:'debounced'，并发请求回 skipped:'in_flight'，均不触发 CLI
  - 正常路径回执行器结构化 result（ok/skipped 形态），异常不 reject（回 {ok:false,...}）
  - 老 daemon 未注册本 method 时 backend 侧降级路径不受影响（本卡不涉及 backend，仅确认协议无破坏）
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 不改动既有 host_fs.* 十三方法与 SILLYSPEC_RESOLVE/TOMBSTONE 消息处理
  - 防抖 Map 为进程内存态，不落盘不入库
  - handler 不抛普通 Error（全部收敛为结构化 result 或 RpcError invalid_params）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
