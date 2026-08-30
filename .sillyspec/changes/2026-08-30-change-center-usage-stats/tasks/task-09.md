---
id: task-09
title: 'usage card wiring at detail render points'
title_zh: '前端两个详情渲染点接线（变更详情页 + quicklog 抽屉）'
author: 'qinyi'
created_at: 2026-08-30 17:00:35
priority: P0
depends_on: ['task-07']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/components/changes/quicklog-drawer.tsx
goal: >
  把 task-07 的 ChangeUsageCard 接进两个详情渲染点——变更详情页 ChangeStageHeader 下方与 quicklog 抽屉 QuicklogSessionsCard 旁，完成 D-004@v1 详情侧展示闭环。
expects_from:
  task-07:
    - contract: ChangeUsageCard
      needs: [kind, workspaceId, refKey]
implementation:
  - 变更详情页 [cid]/page.tsx 在 ChangeStageHeader 之后（page.tsx:326 起的接线块下方）渲染 ChangeUsageCard——kind 传 change、workspaceId 传 params.id、refKey 传 params.cid，对齐同页 ChangeSessionsCard 接线惯例（直接传参挂载，不加加载门控）
  - quicklog-drawer.tsx 在结构化视图底部 QuicklogSessionsCard 之后渲染 ChangeUsageCard——kind 传 quicklog、workspaceId 取 props、refKey 传 entry.ql_id；抽屉关闭（entry 为 null）时区块整体不渲染，原始 md 切换视图不渲染（对齐 sessions 卡同款 section 门控）
  - 两处均由组件 useQuery 自取数，接线层不引入 state/effect、不改既有区块渲染顺序
acceptance:
  - 变更详情页 ChangeStageHeader 下方渲染用量卡（kind=change，命中 change usage 端点数据）
  - quicklog 抽屉 QuicklogSessionsCard 旁渲染用量卡（kind=quicklog，命中 quicklog usage 端点数据），抽屉关闭不渲染
  - 接线层零新增取数逻辑与 state，tsc 0 错且 quicklog-drawer 既有测试不回归
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- src/components/changes/__tests__/quicklog-drawer.test.tsx
constraints:
  - 对齐同渲染点卡片接线惯例（照 ChangeSessionsCard/QuicklogSessionsCard 直接挂载传参形态）
  - 不动移动端 m/** 页面
  - 不改 daemon 侧任何代码
  - 样式走双主题规范（brand-* 语义阶、阴影走主题 token，禁手写 blue-* 色阶）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
