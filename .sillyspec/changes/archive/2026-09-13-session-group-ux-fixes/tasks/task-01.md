---
id: task-01
title: 'pre-session draft scope isolation'
title_zh: '预会话草稿按入口隔离'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 00:44:49
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-1]
decision_ids: [D-001@v1, D-004@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel/turn-state.ts
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
  - frontend/src/components/daemon/__tests__/
target_files: [frontend/src/components/daemon/session-panel/turn-state.ts, frontend/src/components/daemon/session-panel/session-panel-page.tsx, frontend/src/components/daemon/session-panel/session-panel-dialog.tsx, NEW:frontend/src/components/daemon/__tests__/session-panel-draft-scope.test.tsx]
goal: >
  预会话草稿键从固定 __pre__ 细分为 __pre__:<workspaceId|'-'>:<runtimeId>，消除跨入口串台。
implementation:
  - turn-state.ts：readSessionDraft/writeSessionDraft/sessionDraftLsKey 加可选第三参 preScope（sessionId 非空时忽略）
  - session-panel-page.tsx：草稿恢复/写入两 effect 传 preContext 派生 scope（`${ws ?? '-'}:${runtimeId}`）
  - session-panel-dialog.tsx：预会话态传 workspaceId 维度 scope（`workspaceId ?? '-'`，无 runtime 维度）
  - 测试：真会话切换时序锁定（A 输入→切 B→B 自有草稿、A 不受污染）+ 预会话两入口隔离断言
acceptance:
  - 不同入口的预会话草稿互不可见（localStorage 键断言）
  - 同一入口重进恢复草稿
  - 真会话草稿行为零回归（既有断言绿）
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-panel-prompt.test.tsx src/components/daemon/__tests__
constraints:
  - 不做旧 __pre__ 键迁移
  - 不重构真会话草稿系统
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
