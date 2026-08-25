---
id: task-10
title: 'QuicklogScope 门户 + 路由页 + 会话列表关联筛选下拉（含既有类型测试更新）'
title_zh: 'QuicklogScope 门户 + 路由页 + 会话列表关联筛选下拉（含既有类型测试更新）'
author: 'qinyi'
created_at: 2026-08-25 22:54:07
priority: P0
depends_on: ['task-04', 'task-09']
blocks: []
requirement_ids: [FR-04, FR-05, D-006@v1]
decision_ids: [D-006@v1]
allowed_paths:
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/sessions/sessions-portal.tsx
  - 'frontend/src/app/(dashboard)/workspaces/[id]/quicklog/[qlId]/sessions/page.tsx'
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  - frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
expects_from:
  - 'task-09 contract ListAgentSessionsOptions needs [ql_id]——QuicklogScope 列表查询与「关联」筛选下拉选中快速修复时的服务端过滤透传参（经 listAgentSessions 客户端下发，后端 M:N 命中含播种行）'
goal: >
  FR-04 门户 + FR-05 筛选——SessionListScope 收编 QuicklogScope（kind 为
  quicklog 加 workspaceId 加 qlId），新建快速修复级门户路由薄壳（D-006@v1
  与变更门户同构）；session-list-panel 六处 scope 消费分支逐一补齐（X-008
  防静默退化），sessions-portal quicklog 分支合成 preContext 三字段；工作区
  树列表新增「关联」筛选下拉（X-009 门控），选中透传 change_id 或 ql_id。
implementation:
  - 'session-list-panel.tsx 类型——新增导出 QuicklogScope（kind 为 quicklog、workspaceId、qlId 三字段，对齐 ChangeScope 形态），SessionListScope 判别联合收编'
  - '消费点一 queryFn 透传（L496-507 附近）——quicklog 分支下发 ql_id（workspaceId 走既有 in 判定自动透传）；消费点二 groups memo 单组模板（L573-583 附近）——quicklog 分支对齐 change 单组（组 id 取 workspaceId、canNew 为真、名称解析失败兜底当前工作区）'
  - 'sessions-portal.tsx 消费点三至六——portalTitle（L312）quicklog 后缀为「 · 快速修复」；scopedPickerWorkspaceId（L239）与 defaultExpandedWorkspaceId（L399-403）判等式补 quicklog；空态文案（L476）quicklog 分支提示在当前快速修复下创建会话'
  - 'sessions-portal.tsx preContext 合成——enterPreSession 与 handleNewInGroup 的 change 双传分支旁补 quicklog 分支，合成 workspaceId 加 quickId 加 runtimeId 三字段（对齐 X-13 显式双传语义；quickId 类型字段由 task-11 同 Wave 落地，见约束）'
  - '新建路由薄壳——frontend/src/app/(dashboard)/workspaces/[id]/quicklog/[qlId]/sessions/page.tsx 对齐变更级门户页形态（use client 加 params 平铺直取），params.id 与 params.qlId 组装 QuicklogScope 传 SessionsPortal，零业务逻辑'
  - '「关联」筛选下拉（X-009）——WorkspaceTreeList 筛选条新增 antd Select（showSearch、选项分组），变更组取 listChanges 活跃集、快速修复组取 listQuicklogEntries 非占位集（客户端过滤 placeholder）；门控 scope?.kind 等于 workspace 时才渲染（查询 enabled 同门控）；选中变更透传 change_id、选中快速修复透传 ql_id 进 listAgentSessions（queryKey 加筛选槽位），清除恢复'
  - '组件测试——session-list-panel.test.tsx 补 QuicklogScope 单组与 ql_id 透传断言、下拉门控（change/quicklog/runtime 与全局不渲染）与选中透传断言；sessions-portal.test.tsx 补 quicklog 分支 portalTitle 与 preContext 合成断言；既有 SessionListScope 类型相关断言同步更新'
acceptance:
  - '访问新路由后门户渲染——标题带快速修复后缀、列表经 ql_id 过滤为单组、?session= 深链复用既有选中恢复逻辑（R-07）'
  - 'quicklog 门户内组头「＋」或两步浮层选完合成含 quickId 的 preContext——首句创建经 task-11 落 quicklog_id 自动绑定本快速修复'
  - '工作区 scope 树列表出现「关联」下拉分组可搜索——选中变更剩 change_id M:N 命中会话、选中快速修复剩 ql_id 命中会话、清除恢复；change/quicklog/runtime scope 与全局门户不渲染该下拉（X-009）'
  - 'workspace/change/runtime 三类既有 scope 与全局门户行为零回归——既有测试更新后全绿'
verify:
  - cd frontend && pnpm exec tsc --noEmit && pnpm test -- --run src/components/sessions
constraints:
  - '六处 scope 消费分支为 if-chain 判等（TS 不做穷尽检查，X-008）——逐一核对补齐并以测试覆盖 quicklog 分支，禁止只改类型不改分支'
  - '「关联」下拉仅 workspace scope 渲染（X-009 门控谓词显式化）——change/quicklog scope 自身已按关联过滤、全局门户跨工作区选项过杂，均不叠加'
  - '与 task-11 同 Wave 类型耦合——本卡 preContext 合成分支按 task-11 契约写 quickId 字段（SessionPreContext 扩展归 task-11，session-panel.tsx 不在本卡路径）；两卡均落地后 tsc 全绿，单独先行时 excess property 报错属预期'
  - '与 task-12 无构建依赖——抽屉卡深链到本卡路由的运行时集成由 task-13 走查覆盖'
related_tests:
  - path: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
    reason: SessionListScope 类型扩展与筛选条新增下拉致既有断言失效，需同步更新并补 QuicklogScope 与筛选透传用例
  - path: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
    reason: 门户 scope 分支收编 quicklog 后既有用例需补 quicklog 断言（portalTitle 与 preContext 合成）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
