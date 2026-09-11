---
id: task-05
title: 'workspace skills page blocks for platform library enable and adoption'
title_zh: 'workspace skills 页两区块（平台库启用+收编）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 21:39:17
priority: P1
depends_on: ['task-01', 'task-03']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/skills/
  - frontend/src/components/skills-library/
target_files:
  - frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/skills/__tests__/page.test.tsx
  - frontend/src/components/skills-library/skill-source-api.ts
  - frontend/src/components/skills-library/library-enable-list.tsx
expects_from:
  - task-01 提供 toggle_enable 双 scope 签名（可选 workspace_id 参数；library 与 enable 端点 HTTP 侧同名可选参数）
  - task-03 提供 adoptable 与 adopt 两端点契约（候选含 invalid 标记、adopt 响应逐名结果）
goal: >
  workspace skills 页增两区块——平台 git 技能库按 workspace 维度启用开关（桥①）与 specDir 技能收编入口（桥④前端面），复用 skills-library 组件与 AI-Native 双主题规范（FR-04）。
implementation:
  - skill-source-api.ts 扩 workspace 维度——library/enable/disable 请求带 workspace_id 参数（参数与响应过渡类型定义在本文件，字段命名与后端 DTO 严格一致）；新增 adoptable/adopt 请求函数与 hooks
  - page.tsx 增「平台技能库」区块——复用 library-enable-list 渲染 git 技能列表与启用开关，toggle 走 workspace 维度，成功后刷新
  - page.tsx 增「收编为个人技能」区块——adoptable 列表（名称与描述，invalid 标记置灰不可选）加确认收编按钮，adopt 后逐名结果与重名 409 中文提示
  - 样式与测试——两区块空态/加载/错误态齐全（EmptyState 与 ErrorBanner 惯例，brand-* 语义阶禁手写蓝阶）；page.test.tsx 补两区块渲染与交互（toggle 请求带 workspace_id 断言、adopt 结果与错误提示）
acceptance:
  - 平台库区块开关只影响当前 workspace（请求参数可断言），列表启用态与该维度一致
  - 收编区块只列差集技能，invalid 不可选，成功/跳过/重名均有中文反馈
  - 既有 specDir 技能管理功能零回归（既有用例全绿）；pnpm tsc 零错误
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/workspaces/[id]/skills" src/components/skills-library
constraints:
  - 不改 api-types.ts 与 backend/openapi.json（生成物由 task-06 统一 gen:types 收口）；不动平台级 skills 库页面；MCP 选入归 task-06
  - UI 中文文案；主题取值单源 themes.ts
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
