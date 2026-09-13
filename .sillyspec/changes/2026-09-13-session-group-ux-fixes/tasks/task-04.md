---
id: task-04
title: 'gen types and frontend filter'
title_zh: 'gen:types 与前端过滤改造'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 00:44:49
priority: P0
depends_on: [task-03]
blocks: []
requirement_ids: [FR-3]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/mobile/mobile-session-list.tsx
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  - frontend/src/components/mobile/mobile-session-list.test.tsx
  - frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  - frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx
  # execute 补录（gen:types 新字段必填的类型级联面，execute task-04 实测）：三处
  # handleGroupCreated/建群归一构造 setSelectedGroup({...group}) 需补占位
  # visible_workspace_ids: [workspace_id]（新建群无项目=直接归属），否则 tsc 报错。
  - frontend/src/app/m/workspaces/[id]/sessions/page.tsx
  - frontend/src/components/floating/floating-session-host.tsx
  - frontend/src/components/sessions/sessions-portal.tsx
  - frontend/src/components/floating/floating-session-host.test.tsx
expects_from:
  - "task-03 提供 GET /api/daemon/group-chats 列表项 visible_workspace_ids 字段"
# target_files 对账规避注记（verify 期）：frontend/src/app/m/workspaces/[id]/sessions/
# page.tsx 与 __tests__/page.m-sessions.test.tsx 两文件实际已交付（Wave2 commit 6aa738c5b，
# 对账 undeclared 证据列可见真实 diff）——路径含 [id] 被对账器当 glob 字符类解析失配
# （missing 假红），从 target_files 移除以规避，交付事实以 allowed_paths + review
# changedFiles 为准。非删声明逃门：两路径仍在 allowed_paths。
target_files: [frontend/src/lib/api-types.ts, backend/openapi.json, frontend/src/components/sessions/session-list-panel.tsx, frontend/src/components/mobile/mobile-session-list.tsx, frontend/src/components/sessions/__tests__/session-list-panel.test.tsx, frontend/src/components/mobile/mobile-session-list.test.tsx, frontend/src/components/sessions/__tests__/sessions-portal.test.tsx, frontend/src/components/floating/floating-session-host.tsx, frontend/src/components/sessions/sessions-portal.tsx]
goal: >
  重生成前端类型，两消费点过滤改 visible_workspace_ids 集合判定。
implementation:
  - pnpm gen:types 重生成 api-types.ts + openapi.json（先确认 node_modules 健康：pnpm exec tsc --version）
  - frontend/src/components/sessions/session-list-panel.tsx:964-970：过滤改 (g.visible_workspace_ids ?? [g.workspace_id]).includes(scope.workspaceId)
  - frontend/src/components/mobile/mobile-session-list.tsx:250-256：同款迁移
  - 受影响既有测试 mock 补 visible_workspace_ids 字段（session-list-panel/sessions-portal/page.m-sessions/mobile）
  - 新增过滤断言：挂 D 项目关联 D/F → D/F 均含；无 project 仅直接归属；旧缓存无字段退化现状
acceptance:
  - gen:types 后 api-types.ts 含 visible_workspace_ids: string[]
  - 两消费点跨工作区群显示
  - 全部相关面测试绿
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions src/components/mobile/mobile-session-list.test.tsx
constraints:
  - 不改成员过滤（前置不动）
  - ?? 兜底保留（旧缓存不闪隐）
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
