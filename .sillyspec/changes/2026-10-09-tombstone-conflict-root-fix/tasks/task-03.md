---
id: task-03
title: 'daemon tombstone_cleanup 执行器（WS 分发+隔离区移动+doctor 归档+幂等回执）'
title_zh: 'daemon tombstone_cleanup 执行器（WS 分发+隔离区移动+doctor 归档+幂等回执）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 11:58:09
priority: P0
depends_on: ['task-01']
blocks: [task-04]
requirement_ids: [FR-03]
decision_ids: [D-001@v1, D-002@v1]
expects_from: 'task-01: WS 消息 daemon:sillyspec_tombstone_cleanup（payload: change, workspace_id）'
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/sillyspec-manager.ts
  - sillyhub-daemon/src/api-types.ts
  - sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts
target_files:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/sillyspec-manager.ts
  - sillyhub-daemon/src/api-types.ts
  - NEW:sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts
goal: >
  daemon 侧 tombstone_cleanup 执行器（FR-03 隔离区收敛+幂等场景）：接收指令→把本机变更目录移入
  .runtime/tombstone-quarantine/ 隔离区（移动不删除）→进度库行归档→回执。这是「断根」的物理执行端。
implementation:
  - sillyhub-daemon/src/daemon.ts WS 消息分发加 daemon:sillyspec_tombstone_cleanup（change/workspace_id 必填校验 + executor 调用，对齐 7364-7378 行 sillyspec_resolve/sillyspec_ghost_cleanup 分发形态；缺字段记 sillyspec_tombstone_cleanup_missing_fields 警告忽略）
  - sillyhub-daemon/src/sillyspec-manager.ts 新执行器 runTombstoneCleanup(change, workspaceId)（对齐 runGhostCleanup:1084-1105 命令执行器结构）：①_resolveWorkspaceRoot(workspaceId) 定位根（未命中报 workspace_root_unknown 不回退单槽位，2026-09-09-conflict-root-workspace-scoping 语义）②目录定位：活跃区 changes/<name>/，不存在查归档区 changes/archive/<name>/，两者都不在→幂等成功（回执 state=success、error 注明「目录已不在本地」）③fs.rename 移动到 <根>/.sillyspec/.runtime/tombstone-quarantine/<name>-<yyyymmdd-HHmmss>/（目录不存在先 mkdirSync recursive；rename 失败→失败回执带错误摘要）④_execSillySpecCli 跑 sillyspec doctor --cleanup-ghosts --confirm（目录已移走该行即 ghost，doctor 归档，复用 runGhostCleanup 同款链路）⑤_recordCommandOutcome('tombstone_cleanup', { change }, outcome) 回执
  - sillyhub-daemon/src/api-types.ts：task-01 的 backend/openapi.json 落盘后跑 daemon 侧 gen 流程重生成（新端点+action 枚举类型）
  - 新增 sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts：幂等（目录不在=success）/活跃区+归档区双定位/移动到隔离区断言（时间戳子目录）/rename 失败失败回执/doctor 调用与回执链/根解析失败 workspace_root_unknown
acceptance:
  - 指令（change+workspace_id）到达后：目录出现在 tombstone-quarantine/<name>-<时间戳>/ 且原位消失、doctor 已跑、回执 action='tombstone_cleanup' 携带 change
  - 目录不存在时回执 state=success 无副作用（幂等重放安全）
  - workspace_id 未命中映射报 workspace_root_unknown（不回退单槽位）
  - api-types 含新端点/action 类型，pnpm typecheck 零错
verify:
  - cd sillyhub-daemon && pnpm test -- tests/sillyspec-tombstone-cleanup.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 移动不删除（同盘 rename 原子性）；禁止 rm；不移入 changes/archive/（墓碑守卫对归档区前缀同样拒收）
  - 隔离区在 .sillyspec/.runtime/ 下（同步树外、不进 git）
  - 旧 daemon 静默忽略新消息的兜底由前端 150s 回显超时承担（本 task 不做版本门控）
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
