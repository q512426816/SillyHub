---
id: task-05
title: 'mount hover panel + final verification'
title_zh: '挂载悬浮组件并收口验收'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-13 12:20:26
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v2]
allowed_paths:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
target_files:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
expects_from:
  - contract: 悬浮变更文件组件
    needs:
      - 'SessionChangeFilesHover 组件 props 为 workspaceId/sessionId/running'
goal: >
  把悬浮组件接入会话面板（FR-02 落地可见）并做全变更收口验收
  （聚焦测试全绿 + lint/tsc 过门 + design 文件清单对账）。
implementation:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx 中栏会话分支（L969-1088 对应的 page 模式渲染区，聊天列容器内、输入条上方）挂载 `<SessionChangeFilesHover workspaceId={...} sessionId={sessionId} running={running} />`；running 取既有变量（`turnState.currentRunId != null` 判定，L2420 附近）；仅 page 模式挂载（portal 预会话模式不挂）
  - 确认挂载容器 position 上下文（必要时父层加 relative），悬浮入口不遮挡输入条交互
  - 收口验收：跑本变更全部聚焦测试（backend change 模块新测试 + frontend 两个新测试文件）+ ruff/mypy（backend change 模块）+ eslint/tsc（frontend）+ 对照 design.md「文件变更清单」逐项核验（NEW 3 文件存在、修改文件符合说明）+ git 确认 api-types.ts/openapi.json 同批
acceptance:
  - 会话页面（page 模式）渲染悬浮入口，预会话/门户不受影响
  - 本变更全部聚焦测试绿 + lint/tsc 过门 + 无占位符残留
  - design 文件清单 11 项全部对账通过
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_session_changes_endpoint.py -q --no-cov
  - cd frontend && pnpm vitest run src/components/__tests__/change-file-tree-autorefresh.test.tsx src/components/daemon/__tests__/session-change-files-hover.test.tsx
  - cd frontend && pnpm exec tsc --noEmit && pnpm lint
  - cd backend && uv run ruff check app/modules/change/ && uv run mypy app/modules/change/router.py app/modules/change/service.py
constraints:
  - 只改挂载点接线（几行），不重构 session-panel-page（5477 行大文件最小侵入）
  - 不顺手修无关问题；发现必须改其他文件先停下回报
  - 禁全量测试（仅跑本变更相关文件）
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
