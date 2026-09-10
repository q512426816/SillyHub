---
id: task-03
title: 'wire-zcode-sqlite-dispatch-in-host-fs-handler'
title_zh: 'host-fs-handler 分派接线——守卫后先库后文件，库失败回落现流程'
author: 'qinyi'
created_at: 2026-09-10 11:50:52
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: [D-001@v1, D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/host-fs-handler.ts
  - sillyhub-daemon/tests/agent-log/zcode-sqlite-dispatch.test.ts
target_files:
  - sillyhub-daemon/src/host-fs-handler.ts
  - NEW:sillyhub-daemon/tests/agent-log/zcode-sqlite-dispatch.test.ts
expects_from:
  task-02:
    - contract: readZcodeSqliteMessages(sessId, beforeSeq) → AgentLogMessagesResult
      needs: [parsed messages, status, truncated, totalSegments]
goal: >
  readAgentLogMessages 接入 zcode 会话先库后文件分派（D-005@v1 插入点——assertWithinAllowedRoots
  守卫通过后、registry 前，format=zcode-model-io-jsonl 先走 task-02 读取器），库读失败原样回落现文件流程、双失败按现状 not_found（FR-03/D-001@v1）；claude/codex 不经新分支（FR-04）。
implementation:
  - 守卫先行不动（D-005@v1 铁律）——assertWithinAllowedRoots 仍在第一步，越界 path 语义不变（仍抛 forbidden，分派不得绕过越界检查）；守卫通过且 format==='zcode-model-io-jsonl' 时，用 extractZcodeSessId 从 path 提取 sess id，先调 task-02 readZcodeSqliteMessages(sessId, beforeSeq)，成功原样回传（不触文件 IO）
  - 读取器抛「不可用/会话不在库/查询异常」→ 原样落回现流程（registry 查 parser → lstat → 20MB 预判 → readFile → parse-zcode-model-io），文件缺失才按现状 not_found（toRpcError 通道，D-001@v1 恒库+文件兜底）
  - claude/codex format 不进新分支（registry 路径零改动）；读取器库路径经模块级工厂注入（默认 ~/.zcode/cli/db/db.sqlite，测试覆写库路径，不动 RPC 协议）
  - 新建 tests/agent-log/zcode-sqlite-dispatch.test.ts 四态用例——库成功断言不触文件 IO（mock）、库失败+文件在=文件解析成功、库+文件双失败=not_found、claude format 不走读取器（mock 断言未调）；另断言越界 path 仍被守卫拦截（forbidden 先于分派）
acceptance:
  - zcode format 库成功——原样回传读取器 AgentLogMessagesResult（status/messages/truncated/totalSegments），零 lstat/readFile 调用
  - 库失败+文件在=回落文件解析成功；库+文件双失败=not_found（现状语义）；claude/codex format 路径与现状一致（读取器未被调）
  - 越界 path 在 zcode format 下仍被 assertWithinAllowedRoots 拦截抛 forbidden（分派不绕过守卫）；RPC 响应形状与错误映射零变更
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/agent-log/zcode-sqlite-dispatch.test.ts tests/agent-log/parse-zcode-model-io.test.ts && pnpm typecheck
constraints:
  - 不改 RPC 响应形状与错误映射（forbidden/not_found 同通道同 code）；不动 registry.ts（读取器不经 registry 分派）；不动 liveness
  - 分派收敛于 readAgentLogMessages 单点 if 分支，host-fs-handler 其余九方法零变更；测试经模块级工厂覆写库路径，不动 RPC 协议与参数
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
