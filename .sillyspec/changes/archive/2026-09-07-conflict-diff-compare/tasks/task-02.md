---
id: task-02
title: implement-conflict-snapshot-rpc-and-ql-id-heartbeat
title_zh: 'daemon 实现 conflictSnapshot + RPC 注册 + ql_id 心跳补报'
author: 'qinyi'
created_at: 2026-09-07 13:53:21
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-05, FR-07, FR-08]
decision_ids: [D-001@v1, D-004@v1]
provides:
  - contract: SillySpecConflictSnapshot
    fields: [change, kind, ql_id, conflict_created_at, local_updated_at, files, progress]
allowed_paths:
  - sillyhub-daemon/src/sillyspec-manager.ts
  - sillyhub-daemon/src/daemon.ts
target_files:
  - sillyhub-daemon/src/sillyspec-manager.ts
  - sillyhub-daemon/src/daemon.ts
goal: >
  sillyspec-manager 新增 conflictSnapshot(change, kind) 产出本地冲突快照，daemon 注册 sillyspec_conflict_snapshot RPC，心跳 pending_conflicts 补报 ql_id，供 task-04 backend compare 编排实时拉取本地侧内容与 ql 编号（D-001@v1 方案A、D-004@v1）。
implementation:
  - sillyspec-manager.ts 新增公开 async conflictSnapshot(change, kind)，spec 根复用 _statusCwd 回调（runResolve 同款根），无根抛 RpcError（code 为 no_spec_root，RpcError 从 ws-client.js 引入）
  - 按 kind 定位冲突记录：spec-tree 读 <根>/.sillyspec/.runtime/spec-sync-conflict-<change>.json 取 conflicting_paths 与 created_at，progress 读 sync-conflict-<change>.json；记录缺失或 JSON 损坏抛 RpcError
  - spec-tree 逐路径 realpath 校验落点必须在 spec 根内（file-rpc.ts explorer 同款），越界拒读；逐文件回 path/content/mtime/size/truncated/binary/missing
  - 四道护栏：单文件超 256KB 截断置 truncated 且缺省 content；路径数超 300 截断；files 聚合超 4MB 按信噪比排序（changes/<change>/ 优先、archive 沉底）溢出仅元信息；非 utf8 置 binary 不带内容
  - progress 分支经 _runProgressJson 跑 progress show --json（--json 忽略 --change 恒回全局 envelope），daemon 自行从 data.changes[] 过滤该 change；local_updated_at 取 last_active，spec-tree 取冲突文件 mtime 最大值（无文件取冲突记录 created_at）
  - ql_id：quick-* 名 best-effort 读 .sillyspec/.runtime/quick-sessions/<change>/guard.json 的 quicklogId，读不到或非 quick 置 null
  - 心跳补报：collectStatusOnce 在 buildSillySpecStatusSummary 返回后做后处理，对 quick-* 冲突条同步读 guard.json 补 ql_id，单条失败仅缺省该条不阻断心跳；SillySpecStatusPendingConflict 类型加可选 ql_id
  - daemon.ts 新增 _registerSillySpecRpcHandler(ws) 注册 sillyspec_conflict_snapshot，params 归一后透传 manager.conflictSnapshot，注册点挂 _registerExplorerRpcHandler 旁（daemon.ts:5091 区）；handler 不吞 RpcError，交 _dispatchRpc 回填 code
acceptance:
  - task-01 的 tests/sillyspec-conflict-snapshot.test.ts 全部转绿
  - RPC result 契约与 design §7.1 一致：change/kind/ql_id/conflict_created_at/local_updated_at/files[]/progress，ql_id 与 progress 可空
  - 心跳 pending_conflicts 的 quick 条带 ql_id，其余条 ql_id 为 null，既有三字段语义不变且既有 sillyspec 测试不回归
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/sillyspec-conflict-snapshot.test.ts
  - cd sillyhub-daemon && pnpm vitest run tests/sillyspec-manager.test.ts tests/daemon-heartbeat-sillyspec.test.ts tests/sillyspec-platform-command.test.ts
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 不改外部 sillyspec CLI 源码，ql_id 一律由 daemon 读 guard.json 补报
  - 不改 09-04 已合入的裁决通道与 ghost 清理语义；buildSillySpecStatusSummary 保持纯函数不落 fs，ql_id 只做 collectStatusOnce 后处理
  - RPC 只读快照不写文件、不进状态机；截断常量集中文件头；不跑 pnpm gen:types（归 task-04/task-05）
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
