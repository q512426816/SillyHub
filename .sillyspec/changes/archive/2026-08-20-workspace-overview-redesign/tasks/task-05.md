---
id: task-05
title: 'page.test.tsx 断言同步改写 + 新增统计/入口断言 + 全量测试验证（覆盖：FR-05, D-202）'
title_zh: 'page.test.tsx 断言同步改写 + 新增统计/入口断言 + 全量测试验证（覆盖：FR-05, D-202）'
author: 'qinyi'
created_at: 2026-08-20 07:51:07
priority: P0
depends_on: [task-04]
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-202]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx
goal: >
  task-04 四段式重排后核对 page.test.tsx 既有 8 用例断言是否仍成立并做必要的等价同步，
  同时补上现状缺失的两类覆盖——统计四数字渲染与 6 入口 href——
  以全量测试与类型检查锁定重构前后行为等价（R-02 补口）。
implementation:
  - 既有 8 用例逐一核对——it2/3/4 为负向断言（queryByText 规范管理标题与 spec_root/profile_version 字段、queryByRole 初始化/扫描/同步到服务器按钮不在 page 层），WorkspaceConfigCard 被 mock 成空 div 保护，重排后预期仍成立不改写
  - it1/5（workspace-config-card-mock 接线与三策略循环）与 it6/7/8（default_agent 三分支——未绑占位/在线 provider 选择器含 claude 不含 codex/离线提示）内容位于折叠面板内，经 task-04 items 全量 forceRender 挂载预期不改断言直接通过；renderWithStrategy 的 waitFor 锚点 multi-agent-platform 由 hero 横幅继续提供
  - 核对中若发现因版式重排失效的定位方式（如层级变化导致 getBy/findBy 落空）——仅允许等价改写定位方式，禁止削弱断言语义（CLAUDE.md 规则 9）；若断言暴露真实回归则回 task-04 修实现，不为通过改测试
  - 新增统计四数字断言——断言四卡标签（项目组组件/进行中变更/已归档变更/运行时阶段）与对应数值渲染；数据走既有 mock 通道（renderWithStrategy 的 componentCount override 进 components mock total，listChanges mock total 0，getRuntimeProgress null 时运行时阶段显示 —），不为新断言另加 mock 面
  - 新增 6 入口 href 断言——next/link 已 mock 为 a 标签，断言项目组件/变更中心/扫描文档/运行时/智能体档案/方案文件六入口 href 均为 /workspaces/ws-1/ 前缀下对应路径（与现状六项一致，design §5 第 10 行）
  - 新增断言不 mock 三个新展示组件——WorkspaceStatsRow/QuickEntryGrid 真实渲染才能锁住 page 编排层的统计数字与入口链接接线；用例放入既有 describe 并复用 makeWorkspace/mockDefaultBinding/renderWithStrategy fixtures 不另起炉灶
acceptance:
  - 既有 8 用例全绿且无断言语义削弱（it2/3/4 负向断言的 mock 保护保持不动）
  - 新增统计四数字断言与 6 入口 href 断言通过（现状测试无此覆盖，R-02 补口）
  - 全量 pnpm test 通过、pnpm typecheck 0 error
  - 新断言复用既有 fixtures 与 mock 通道，未新增 API mock 面或重复数据准备
verify:
  - cd frontend && pnpm test -- page.test
  - cd frontend && pnpm test
  - cd frontend && pnpm typecheck
constraints:
  - 只改 page.test.tsx 一个文件（发现实现问题回 task-04 修产品码，不为本卡便利改实现）
  - 禁止为通过测试削弱既有断言语义或删用例（CLAUDE.md 规则 9；负向断言 it2/3/4 的 mock 保护不动）
  - 不 mock 三个新展示组件（WorkspaceStatsRow/QuickEntryGrid 需真实渲染以锁住编排层接线）
  - 新增断言数据全部来自既有 mock 通道，不新增 API mock 面
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
