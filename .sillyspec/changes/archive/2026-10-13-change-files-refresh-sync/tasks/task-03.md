---
id: task-03
title: 'daemon 测试——vitest 覆盖：参数清洗拒穿越/非法 UUID、15s 防抖 skipped、in-flight skipped、无根映射 no_workspace_root、两条命令按序串行、CLI 非零退出 cli_failed 结构、硬帽淘汰 [target: NEW:sillyhub-daemon/tests/sillyspec-sync-change-rpc.test.ts]'
title_zh: 'daemon 测试——vitest 覆盖：参数清洗拒穿越/非法 UUID、15s 防抖 skipped、in-flight skipped、无根映射 no_workspace_root、两条命令按序串行、CLI 非零退出 cli_failed 结构、硬帽淘汰 [target: NEW:sillyhub-daemon/tests/sillyspec-sync-change-rpc.test.ts]'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-13 12:58:32
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-01, FR-03, FR-04, FR-05]
decision_ids: [D-001@v1, D-004@v1]
allowed_paths:
  - sillyhub-daemon/tests/sillyspec-sync-change-rpc.test.ts
target_files: [NEW:sillyhub-daemon/tests/sillyspec-sync-change-rpc.test.ts]
goal: >
  daemon 侧 handler + 执行器的行为测试闭环——参数守卫/防抖/串行/失败结构四面的回归防线（FR-03/FR-05 可验证化）。
implementation:
  - 新建 sillyhub-daemon/tests/sillyspec-sync-change-rpc.test.ts（vitest，参照 tests/run-sillyspec-init.test.ts 与 tests/daemon-heartbeat-sillyspec.test.ts 的 mock 惯例）
  - 用例组1 参数守卫：change 含 ../、空串、超长、首字符非字母数字 → RpcError；workspace_id 非 UUID → RpcError
  - 用例组2 防抖（fake timers）：首次触发跑 CLI；15s 内再次 → skipped:'debounced' 不跑 CLI；并发第二次 → skipped:'in_flight'；CLI 结束后 in-flight 解除
  - 用例组3 执行器：无根映射 → no_workspace_root；两条命令按序串行（调用序断言）；CLI 非零退出 → {ok:false, reason:'cli_failed', failed_cmd, stderr_tail}
  - 用例组4 硬帽：超 1000 条淘汰最旧（可缩容常量注入或直接断言 Map size 上限）
acceptance:
  - pnpm test（聚焦本文件）全绿
  - 防抖窗口/硬帽常量可注入或可 monkeypatch（测试不真等 15s）
verify:
  - cd sillyhub-daemon && pnpm test -- sillyspec-sync-change-rpc
constraints:
  - 不跑 daemon 全量测试（CLAUDE.md 规则 0：仅跑本变更相关）
  - 不 mock 真实 sillyspec CLI 进程行为以外的网络/WS 层
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
