---
id: task-05
title: 'mobile-change-card-and-pending-review-label-export'
title_zh: 'MobileChangeCard 组件（阶段/待办徽标/相对时间）+ changes/page.tsx 导出 PENDING_REVIEW_LABEL（FR-03；Grill C-10）'
author: 'qinyi'
created_at: 2026-08-27 00:34:52
priority: P0
depends_on: []
blocks: ['task-06', 'task-08']
requirement_ids: [FR-03]
decision_ids: [D-001@V1]
allowed_paths:
  - frontend/src/components/mobile/mobile-change-card.tsx
  - frontend/src/components/mobile/mobile-change-card.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
provides:
  - contract: PENDING_REVIEW_LABEL
    fields: [PENDING_REVIEW_LABEL]
goal: >
  新建移动变更卡片组件（阶段徽标/待办徽标/相对时间），并给桌面 changes/page.tsx 模块
  私有常量 PENDING_REVIEW_LABEL 加 export 供移动端复用（Grill C-10）。
implementation:
  - (dashboard)/workspaces/[id]/changes/page.tsx:63 仅给 PENDING_REVIEW_LABEL 前加 export 关键字（一行改动、渲染零变化；同文件 isTerminalChange 等已有导出先例）
  - '新建 frontend/src/components/mobile/mobile-change-card.tsx，props 按 design §7：change: ChangeSummary、onClick: () => void'
  - 阶段徽标复用 ChangeStepBadge（纯内容徽章，自带 STAGE_KIND/STAGE_LABELS 与 stepProgress 副行）；待办徽标复刻桌面 renderTodoBadge（page.tsx:287）三态：blocked→阻塞中 / pending_review 命中→PENDING_REVIEW_LABEL 映射 / 否则空占位
  - 相对时间复用既有导出 formatRelativeTime（runtime-card-helpers.tsx:205），禁止复制第二份实现
  - 卡片布局：变更名 + 阶段徽标 + 待办徽标 + 最近活动相对时间（change.updated_at），整卡可点 onClick，触摸热区 ≥44px、语义 token
  - 新增 colocate 测试 mobile-change-card.test.tsx：待办徽标三态映射、阶段徽标渲染、相对时间文案、onClick 回调
acceptance:
  - 桌面 changes/page.tsx 仅增加 export 一行，渲染行为零变化（既有 changes/__tests__/page.test.tsx 全绿即证）
  - MobileChangeCard props 与 design §7 一致（change/onClick），纯展示零数据请求
  - 待办徽标三态与桌面 renderTodoBadge 语义一致；PENDING_REVIEW_LABEL 从桌面页 import 复用而非复制映射表
  - 相对时间经 formatRelativeTime 渲染（测试断言文案）
verify:
  - cd frontend && pnpm test -- src/components/mobile/mobile-change-card.test.tsx
  - cd frontend && pnpm test -- "src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx"
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 桌面 changes/page.tsx 只许加 export 一行；禁止改 TABS/STAGE_OPTIONS/renderTodoBadge/渲染结构
  - 徽标映射与相对时间必须 import 既有导出（PENDING_REVIEW_LABEL/formatRelativeTime/ChangeStepBadge），禁止复制第二份映射
  - quicklog 卡片形态不在本卡范围（task-07 按需扩展，本卡仅 ChangeSummary）
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
