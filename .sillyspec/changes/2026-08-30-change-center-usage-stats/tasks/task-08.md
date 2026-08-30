---
id: task-08
title: 'execution column for changes and quicklog lists'
title_zh: '前端两个列表「执行」列（changes/page.tsx + quicklog-table.tsx）与测试补充'
author: 'qinyi'
created_at: 2026-08-30 17:00:35
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
  - frontend/src/components/changes/quicklog-table.tsx
  - frontend/src/components/changes/__tests__/quicklog-table.test.tsx
goal: >
  变更列表与快速修复列表各加「执行」列（紧凑两行摘要 + 起止时间悬浮提示 + usage None 降级），落地 D-004@v1 列表侧展示并补齐 quicklog-table 测试断言。
expects_from:
  task-06:
    - contract: ChangeUsageRead-types
      needs: [UsageSummaryRead]
implementation:
  - changes/page.tsx 变更列定义在 影响组件 与 更新时间 之间加「执行」列——紧凑两行（首行耗时 + 可选进行中标记，次行 N tok · N 次），单元格 title 悬浮显示开始/结束时间（进行中时显示进行中），c.usage 为 None 显示「—」
  - quicklog-table.tsx 在 影响模块 与 时间 之间加同款「执行」列——次行追加 N 轮（usage.totals.num_turns），进行中标记与 None 降级同变更列表规则
  - 进行中标记 = usage.started_at 有值且 finished_at 缺（usage 非 None 时才判定）
  - 数字格式化对齐会话页 token 惯例（万级 X.X 万、万以下千分位、次数千分位直显），耗时 duration_ms 紧凑中文格式化（X.X 小时 / N 分钟）且 None 显示「—」
  - quicklog-table.test.tsx 既有 makeEntry mock 补 usage 字段（有值/None/进行中三态），新增「执行」列断言（耗时行、token·次·轮行、悬浮 title、None →「—」、进行中标记）
acceptance:
  - 两列表均渲染「执行」列且不破坏现有列布局（既有列断言全部通过）
  - 耗时 + 进行中标记、N tok · N 次（quicklog 追加 N 轮）、悬浮起止时间渲染正确；usage None 显示「—」
  - quicklog-table 测试覆盖新列各态，tsc 0 错
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- src/components/changes/__tests__/quicklog-table.test.tsx
constraints:
  - 不破坏现有列布局（既有列宽/对齐/渲染逻辑不改，新列用紧凑格式）
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
