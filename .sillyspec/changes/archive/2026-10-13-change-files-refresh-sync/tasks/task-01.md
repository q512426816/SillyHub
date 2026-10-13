---
id: task-01
title: 'daemon 执行器——sillyspec-manager.ts 新增 `runSyncChange(change, workspaceId)`：`_sillyspecStatusRoots` 查根（无根结构化 no_workspace_root）→ cwd=主仓根串行 execFile `sillyspec platform sync --change X` → `sillyspec platform sync-docs --change X`（各 120s 超时）→ 聚合 `{ok,actions[{cmd,code,ms}]}` / `{ok:false,reason,failed_cmd,stderr_tail}` 结构化回执 [target: sillyhub-daemon/src/sillyspec-manager.ts]'
title_zh: 'daemon 执行器——sillyspec-manager.ts 新增 `runSyncChange(change, workspaceId)`：`_sillyspecStatusRoots` 查根（无根结构化 no_workspace_root）→ cwd=主仓根串行 execFile `sillyspec platform sync --change X` → `sillyspec platform sync-docs --change X`（各 120s 超时）→ 聚合 `{ok,actions[{cmd,code,ms}]}` / `{ok:false,reason,failed_cmd,stderr_tail}` 结构化回执 [target: sillyhub-daemon/src/sillyspec-manager.ts]'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-13 12:58:32
priority: P0
depends_on: []
blocks: [task-02, task-03]
requirement_ids: [FR-01, FR-04, FR-05]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/sillyspec-manager.ts
target_files: [sillyhub-daemon/src/sillyspec-manager.ts]
goal: >
  daemon 侧执行器 runSyncChange：给定 change 与 workspaceId，查本地主仓根后串行执行两条 sillyspec CLI（platform sync --change 落镜像 + platform sync-docs --change 落 DB 四件套），聚合结构化回执——文件树新鲜与 DB 全文双通道的数据上行核心（D-001@v1）。
implementation:
  - sillyhub-daemon/src/sillyspec-manager.ts 新增 runSyncChange(change:string, workspaceId?:string)——对齐既有 runResolve/runTombstoneCleanup 执行器惯例（daemon.ts:1554 SillySpecCommandExecutor 接口、daemon.ts:1544 最小接口约定注释）
  - 根解析：复用 _sillyspecStatusRoots（daemon.ts:5263 登记的 workspaceId→rootPath LRU 映射，与 runResolve statusRootFor 同款 daemon.ts:2164）——查不到返回 {ok:false, reason:'no_workspace_root'}
  - 串行执行：execFile sillyspec CLI，cwd=根，两条命令依次 platform sync --change <名> → platform sync-docs --change <名>，单条 timeout 120s（对齐 SILLYSPEC_COMMAND_TIMEOUT_MS，sillyspec-manager.ts:150）
  - 回执聚合：成功 {ok:true, actions:[{cmd:'sync'|'sync-docs', code, ms}]}；任一条非零/超时 {ok:false, reason:'cli_failed', failed_cmd, stderr_tail}（stderr 尾部截断防超大）
acceptance:
  - 无根映射时返回 {ok:false, reason:'no_workspace_root'}，不抛异常
  - 两条命令按序串行执行（第一条结束才启动第二条），cwd 为映射根
  - CLI 非零退出/超时返回结构化失败（含 failed_cmd 与 stderr_tail），不 reject
  - runSyncChange 落入 SillySpecCommandExecutor 可选执行器检测（daemon.ts:7828 起的字段检测惯例不因新增方法破坏）
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 不改动既有 runResolve/runTombstoneCleanup/runGhostCleanup 行为
  - 不新增 fire-and-forget 消息类型（走既有 daemon:rpc 同步通道，协议面只加 method 不加 message type）
  - stdout 不全量回传（只回 code/ms；stderr 仅尾部截断）
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
