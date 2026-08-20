---
id: task-06
title: '全量验证（grep 验收清单 + 断言同步 + pnpm test + tsc/eslint）+ Docker 抽查'
title_zh: '全量验证（grep 验收清单 + 断言同步 + pnpm test + tsc/eslint）+ Docker 抽查'
author: 'qinyi'
created_at: 2026-08-20 22:30:00
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-301, D-302, D-303, D-304]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/explorer-page.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/skills/__tests__/page.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/mcp/__tests__/page.test.tsx
  - frontend/src/components/workspace/shared-daemon-manager.test.tsx
goal: >
  对 task-01~05 的 8 页样式统一成果做统一验收——grep 三清零（bg-red-50 错误条 / tone 语义色硬编码 / members 英文文案）、
  受影响测试断言核对与必要等价同步、全量 pnpm test 与 tsc/eslint、Docker 抽查 skills/members/explorer 三页双主题观感
  （验收依据按 D-304 为 §0.5 主题系统 + 概览页基线，不引旧 antd 全量条款）。
implementation:
  - grep 三清零核查——bg-red-50 在 8 页 page.tsx 与 shared-daemon-manager.tsx 清零；amber/emerald/blue tone 硬编码 5 处清零（changes/explorer/mcp/mcp-tokens 语义色项）；members 英文文案清零（User/Role/Granted At/Actions/+ Add Member/管理 workspace 成员）
  - 断言核对（预期免改清单）——explorer-page.test.tsx:254 alert 角色与 191 行刷新按钮文案经保留设计免改；skills __tests__/page.test.tsx:90 暂无自定义 skill 与 mcp __tests__/page.test.tsx:116 暂无 MCP 服务器配置两处空态断言文案未变即通过；若断言因前序任务改动失效——仅等价同步定位方式（限 allowed_paths 测试文件），禁止削弱断言语义，暴露真实回归则回对应任务修实现
  - 模式套用核对——返链 4 处（components/skills/mcp/mcp-tokens 均在 PageHeader actions 内且目标统一为 /workspaces/工作区id 详情页）；空态 4 处换 EmptyState；skills/mcp 列表卡 hover lift；components 页 NAV Link 走 buttonVariants
  - 规格核对——members/mcp-tokens 两手写表头逐字段一致（表头 px-4 py-3 bg-muted/40、行 hover:bg-muted/25）；explorer 高度锚 64px；git diff 仅含样式与文案改动（零业务逻辑/API 变更）
  - 全量测试与静态检查——pnpm test 全绿、tsc --noEmit 0 error、pnpm lint 0 error
  - Docker 双主题抽查——按 sillyhub-docker-deploy 技能起 deploy/docker-compose.yml 全栈，浏览器抽查 skills/members/explorer 三页 html data-theme 在 blue 与 ai-native 下观感与概览页一致（R-01/R-03 收口，explorer 滚动分栏正常）
acceptance:
  - plan 全局验收标准 6 项逐条满足（grep 三清零 / 返链空态 hover / 表头与高度锚 / 测试静态检查 / Docker 抽查 / 行为等价）
  - explorer-page.test 与 shared-daemon-manager.test 的 alert 角色与刷新文案断言全绿且未改语义
  - skills:90 与 mcp:116 空态断言不改自通过（文案保留设计生效）
  - 全量 pnpm test 通过且 tsc 与 eslint 均 0 error
  - 本卡不产源码改动——仅断言失效时等价同步 allowed_paths 内测试文件
verify:
  - cd frontend && grep -rn bg-red-50 src/app/\(dashboard\)/workspaces/\[id\]/components/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/changes/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/skills/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/mcp/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/mcp-tokens/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/members/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/explorer/page.tsx src/components/workspace/shared-daemon-manager.tsx（预期无输出）
  - cd frontend && grep -rn "amber-\|emerald-\|border-blue-\|bg-blue-\|text-blue-" src/app/\(dashboard\)/workspaces/\[id\]/changes/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/explorer/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/mcp/page.tsx src/app/\(dashboard\)/workspaces/\[id\]/mcp-tokens/page.tsx（预期无输出，语义色 token 化清零）
  - cd frontend && grep -n "Add Member\|Granted At\|Actions\|管理 workspace 成员" src/app/\(dashboard\)/workspaces/\[id\]/members/page.tsx（预期无输出）
  - cd frontend && pnpm vitest run src/app/\(dashboard\)/workspaces/\[id\]/__tests__/explorer-page.test.tsx src/app/\(dashboard\)/workspaces/\[id\]/skills/__tests__/page.test.tsx src/app/\(dashboard\)/workspaces/\[id\]/mcp/__tests__/page.test.tsx src/components/workspace/shared-daemon-manager.test.tsx
  - cd frontend && pnpm test
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
  - Docker 抽查——sillyhub-docker-deploy 技能起 deploy/docker-compose.yml，浏览器切 html data-theme 验证 blue/ai-native 双主题下 skills/members/explorer 观感与概览页一致
constraints:
  - 本卡不改产品源码——发现问题回 task-01~05 对应任务修复，验收卡不兼任修卡；唯一例外是断言失效时的等价同步（限 allowed_paths 内测试文件）
  - 禁止为通过测试削弱断言语义或删用例（CLAUDE.md 规则 9）
  - changes:424 空态文案不在同步清单（plan 已移出，不受影响）
  - 验收依据按 D-304 声明执行——FRONTEND_PAGE_STYLE §0.5+概览页基线，旧 antd 条款（§4 DataTable/§5 antd Button/§9 bg-red-50 模板/§11 Don't）不适用
  - 行为等价红线——git diff 不得含业务逻辑/API 调用改动
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
