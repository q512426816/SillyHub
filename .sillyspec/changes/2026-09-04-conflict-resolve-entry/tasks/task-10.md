---
id: task-10
title: 'Frontend overview card wrap-up (CLI guidance copy in changes-overview-card switched to change-center jump entries)'
title_zh: '前端总览卡收口（changes-overview-card 冲突与 ghost 区的 CLI 指引文案改为跳转变更中心入口）'
author: 'qinyi'
created_at: 2026-09-04 22:40:15
priority: P1
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - frontend/src/components/workspace/changes-overview-card.tsx
  - frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx
goal: >
  「活跃变更总览」卡的跨机器只读监控定位不变，把 ghost 折叠行与未决冲突区的
  CLI 命令指引文案（sillyspec doctor --cleanup-ghosts --confirm 与
  sillyspec platform resolve）替换为跳转变更中心「平台同步」处理区的入口，
  操作单一入口收口（design §5 Phase 3 第 4 条）。
implementation:
  - CLI 指引文案区（约 :444-515，按内容定位）——ghost 折叠行的清理指引 code 块（sillyspec doctor --cleanup-ghosts --confirm）替换为跳转变更中心入口（Link + 前往处理文案，目标为变更中心页，可带平台同步区锚点）
  - 未决冲突区的「处理 sillyspec platform resolve」code 块替换为同款跳转入口（两区同一目标，不写具体命令原文）
  - 健康条计数、只读展示、过滤 tab、三态占位与数据链零改动（不引入任何写操作，保持卡片只读语义）
  - 同步适配 __tests__/changes-overview-card.test.tsx 的两处 CLI 文案断言（:217 与 :252）为跳转入口断言，其余用例不动
acceptance:
  - ghost 区与冲突区均渲出跳转变更中心入口（可聚焦可点击），不再出现两条 CLI 命令原文
  - 健康条计数、ghost 折叠展开行为、冲突 type 徽标与 change 名等只读展示与改前一致
  - 组件测试全绿（含适配后的入口断言与既有其余用例零回归）+ tsc 0 错
verify:
  - cd frontend && pnpm exec vitest run src/components/workspace/__tests__/changes-overview-card.test.tsx && pnpm exec tsc --noEmit
constraints:
  - 只把指引文案改为跳转入口，不加操作按钮不触发请求（写操作在 task-09 变更中心侧，本卡保持总览卡只读）
  - 跳转路由复用既有变更中心页路径（消费组件已有 workspaceId props，不新增路由）
  - 测试适配仅限两处 CLI 文案断言改为跳转入口断言，禁止改动其它用例语义
related_tests:
  - frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx
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
