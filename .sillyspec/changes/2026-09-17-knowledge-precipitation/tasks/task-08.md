---
id: task-08
title: 'add-distill-source-tab-and-task-bar-polling'
title_zh: '前端从记录提炼 tab + distill-task-bar 轮询'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-17 10:44:49
priority: P0
depends_on: ['task-05', 'task-07']
blocks: ['task-09']
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001@v1, D-002@v1]
expects_from:
  - contract: DistillDispatchIn
    needs: [source_type, source_ref, focus]
  - contract: DistillTaskRead
    needs: [agent_run_id, source_type, source_ref, status, created_at]
related_tests:
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
allowed_paths:
  - frontend/src/components/knowledge/precipitate-dialog.tsx
  - NEW:frontend/src/components/knowledge/distill-task-bar.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
  - frontend/src/lib/knowledge.ts
  - NEW:frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
target_files:
  - NEW:frontend/src/components/knowledge/precipitate-dialog.tsx
  - NEW:frontend/src/components/knowledge/distill-task-bar.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx
  - frontend/src/lib/knowledge.ts
  - NEW:frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx
goal: >
  在 task-05 所建沉淀弹层中新增「从记录提炼」tab（来源类型切换 + 真实源列表选择 + 关注点 + 派发），并新建 distill-task-bar 轮询蒸馏任务（进行中展示、完成/失败反馈后消失），兑现 FR-01/FR-03 会话与变更双来源派发入口（D-001/D-002）。
implementation:
  - lib/knowledge.ts 增 dispatchDistill（POST distill，入参 DistillDispatchIn）与 listDistillTasks（GET distill/tasks）封装，类型来自 api-types 再生成果禁止手写
  - precipitate-dialog.tsx 增「从记录提炼」tab 对照原型 tab-distill——来源类型切换（会话记录/变更归档）、源列表单选、关注点 textarea、派发按钮
  - 会话源列表用 listAgentSessions（frontend/src/lib/daemon/session-lists.ts，传 workspace_id 过滤当前工作区）渲染会话标题；变更源列表用 listChanges（frontend/src/lib/changes.ts，status 过滤 archived 仅已归档）渲染变更名，均为既有 API 实名调用
  - 派发调 dispatchDistill（source_type 取 session/change，source_ref 取会话 id 或变更名，focus 可选透传）成功后关弹层并 toast 已派发提炼任务
  - 新建 distill-task-bar.tsx 挂知识库页列表上方（原型 .distill-bar 位），useQuery + refetchInterval 轮询 listDistillTasks，节奏复用 platform-sync-section 先例（有进行中任务走 5s 快档否则 15s）
  - 任务条仅存在 pending/running 任务时渲染；任务转 completed 时 toast 候选已进入待审核并刷新列表，转 failed（含 no_online_daemon）时展示失败态与 daemon 离线文案，终态短暂停留后随下次轮询从条上消失
  - 新增 distill-task-bar.test.tsx 覆盖轮询渲染、终态消失与失败文案；knowledge-page.test.tsx 补任务条挂载断言
acceptance:
  - 来源类型可切换，两类源列表分别来自真实 API（会话带 workspace 过滤、变更仅已归档），字段名与既有响应一致无编造
  - 派发成功后任务条出现并按轮询节奏刷新；无进行中任务时任务条不渲染
  - 任务完成触发知识列表刷新使候选出现在待审核区；失败态可见 daemon 离线对应文案
  - 手工录入 tab（task-05 产物）行为不回归
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/knowledge/__tests__/distill-task-bar.test.tsx
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx"
constraints:
  - 不改后端与 daemon；distill 状态以 task-07 端点返回为准不新增独立状态机
  - 样式走 AI-Native 双主题（brand-* 语义阶 + 主题 token），文案中文
  - precipitate-dialog 手工录入 tab 与 entry-editor 属 task-05 产物，本 task 只增 tab 不重构既有结构
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
