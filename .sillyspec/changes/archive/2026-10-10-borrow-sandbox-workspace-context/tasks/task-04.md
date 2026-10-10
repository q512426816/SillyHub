---
id: task-04
title: 'daemon marker 分支 AGENTS.md 落盘（fail-open）+ daemon-borrow-sandbox 集成测试扩展'
title_zh: 'daemon marker 分支 AGENTS.md 落盘（fail-open）+ daemon-borrow-sandbox 集成测试扩展'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 15:56:00
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-02, FR-04, FR-05]
decision_ids: [D-003@v1, D-004@v1, D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts
target_files:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts
expects_from:
  task-03:
    - contract: renderBorrowSandboxContext
      needs: [BORROW_CONTEXT_FILENAME]
goal: >
  marker 分支 prepareWorkspace 成功后把渲染的 AGENTS.md 落进沙箱根（fail-open），
  完成借用会话工作区感知最后一跳。
implementation:
  - daemon.ts _startInteractiveSession marker 分支：prepareWorkspace 成功分支
    （borrow_sandbox_prepared 日志旁，sillyhub-daemon/src/daemon.ts:8613）在
    SessionManager.create（:9141）之前加渲染落盘——execPayload.borrowWorkspaceContext
    存在时 writeFileSync(join(borrowSandboxRoot, BORROW_CONTEXT_FILENAME),
    renderBorrowSandboxContext(ctx, borrowSandboxRoot))，try/catch 仅
    warn borrow_sandbox_context_write_failed（对齐 :8624
    borrow_sandbox_prepare_failed fail-open 先例），异常不改变 cwd、不登记回退
  - 扩展 tests/daemon-borrow-sandbox.test.ts（A 组范式 mock 驱动 lease 状态机）：
    claim payload 含 borrow_workspace_context（snake 形态）→ 沙箱根存在
    AGENTS.md 且内容含 slug/root_path；无键 → 无 AGENTS.md（现状行为）；渲染
    抛错（monkey-patch render 抛）→ session 仍创建成功 + warn 日志
acceptance:
  - 借用 lease（marker+context）认领后沙箱根有 AGENTS.md（FR-04 主路径）
  - 无 context 键不写文件；渲染/写失败仅 warn 不阻塞 session（FR-04 fail-open）
  - 非借用 lease 路径零变化（既有 B 组零回归用例保持绿）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/daemon-borrow-sandbox.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 不动 registerBorrowSandbox/写守卫任何逻辑（D-003@v1 红线，write-guard.ts
    不在 allowed_paths）
  - 渲染落盘仅在 marker 分支（非借用 rootPath 路径不写任何文件）
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
