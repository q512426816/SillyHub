---
id: task-08
title: '端到端验收（curl 推 5 条含 2 warning → GET 正序去重 → 面板核对）'
title_zh: '端到端验收（curl 推 5 条含 2 warning → GET 正序去重 → 面板核对）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-23 04:16:42
priority: P0
depends_on: ['task-04', 'task-07']
blocks: []
requirement_ids: [FR-01, FR-02, FR-04, FR-05, FR-06, FR-07]
decision_ids: [D-004]
allowed_paths:
  - backend/app/modules/platform_sync/router.py
  - frontend/src/components/changes/detail/change-events-card.tsx
target_files: []
goal: >
  端到端验收：curl 模拟 watcher 推 5 条（2 warning）→ GET 正序去重 → 面板核对（用户验收原文）。
implementation:
  - 本地起 dev backend（uvicorn，迁移后）；用 shpsync_ token（测试环境签发）curl POST
    /api/changes/2026-09-23-change-events-channel/events 推 5 条（乱序 ts、2 条 severity=warning）
  - curl GET 同端点：断言 5 条 ts 正序；重放同批 POST：deduplicated=5、GET 仍 5 条（去重）
  - 前端渲染核对：warning 琥珀高亮 + provisional 徽标 + 角标 2（vitest 已覆盖行为，手动核对视觉）
  - 红线自查：grep 事件链路无通知/审批/门控调用
acceptance:
  - GET 正序且去重；面板高亮徽标角标正确（用户验收原文全项）
  - 模块级 pytest/vitest/tsc/mypy 全绿（local.yaml commands 口径，仅相关面）
verify:
  - cd backend && uv run pytest app/modules/platform_sync/tests/ -q && uv run mypy app
  - cd frontend && pnpm test -- change-events-card && pnpm typecheck
constraints:
  - 不跑全量测试（CLAUDE.md 规则 0：全量留 CI）
  - 与并行变更文件面冲突时显式 pathspec 提交隔离
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
