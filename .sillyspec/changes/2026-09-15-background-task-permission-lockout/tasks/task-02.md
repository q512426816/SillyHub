---
id: task-02
title: 'SessionManager 门面新增 hasLiveBackgroundTasks(sessionId) 只读访问器'
title_zh: 'SessionManager 门面新增 hasLiveBackgroundTasks(sessionId) 只读访问器'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 16:45:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/session-manager.ts
target_files:
  - sillyhub-daemon/src/interactive/session-manager.ts
goal: >
  SessionManager 门面新增只读公共访问器 hasLiveBackgroundTasks(sessionId): boolean（FR-01）：
  注册表 _backgroundTasks 为私有，daemon.ts 等外部消费者不可直达；经门面暴露「会话是否有存活后台任务」
  的布尔查询（task-04 标记注入、task-06 用量标注、守卫等消费方共用）。
implementation:
  - "session-manager.ts 公共方法族新增 hasLiveBackgroundTasks(sessionId: string): boolean"
  - 实现返回 this._backgroundTasks.get(sessionId)?.size > 0 ?? false
  - 加 JSDoc：会话是否有存活后台任务（只读，不建 map）
  - 不改动其他公共方法；不暴露 _backgroundTasks 引用本身
acceptance:
  - 注册表为空或 sessionId 不存在时返回 false
  - 注册表非空时返回 true
  - 对不存在的 sessionId 调用不创建新 map（无副作用，「不建 map」语义成立）
  - 不泄漏/不暴露私有 map 引用（返回值仅 boolean）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/session-manager.test.ts && pnpm typecheck
constraints:
  - 只读访问器：不得改动注册表内容或触发任何状态副作用
  - 注释与实现一致（CLAUDE.md 规则18）
  - 不引入无关文件变更
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
