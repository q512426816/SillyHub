---
id: task-07
title: 'Frontend thin visual identity and stage filters'
title_zh: '前端 thin 视觉与筛选'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-25 07:14:58
priority: P1
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - frontend/src/components/changes/change-step-badge.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx
  - frontend/src/components/changes/detail/change-stage-header.tsx
  - frontend/src/components/workspace/changes-overview-card.tsx
target_files:
  - frontend/src/components/changes/change-step-badge.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
  - frontend/src/app/m/workspaces/[id]/changes/page.tsx
  - frontend/src/components/changes/detail/change-stage-header.tsx
  - frontend/src/components/workspace/changes-overview-card.tsx
goal: >
  前端全触点落「轻量变更」视觉：徽章/标签/筛选项/旁路判断，杜绝裸显英文 thin 与全灰管线。
implementation:
  - frontend/src/components/changes/change-step-badge.tsx:28-48 STAGE_KIND.thin 与 STAGE_LABELS.thin="轻量变更"（kind 走品牌紫阶——按组件既有 kind 体系实现，无紫阶 kind 时加自定义 kind 并接主题 token，参考 FRONTEND_PAGE_STYLE §0.5 与 themes.ts 单一源铁律）；STAGE_LABELS.quick 改"快速任务（存量）"
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:72-79 STATUS_BADGE.thin（防标题裸显）
  - 桌面 frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx:81-88 与移动 frontend/src/app/m/workspaces/[id]/changes/page.tsx:121-128 两份 STAGE_OPTIONS 副本同步加「轻量变更」筛选项
  - frontend/src/components/changes/detail/change-stage-header.tsx:16-26 WORKFLOW_STAGE_LABELS 加 thin="轻量变更"（供时间线组标题复用；主管线渲染 indexOf<0 不受影响）
  - frontend/src/components/workspace/changes-overview-card.tsx:72-75 BYPASS_BADGES 加 thin；:229 与 :268 两处 stage==="quick"||"explore" 旁路判断加 thin（不加则 thin 渲染全灰主管线）
acceptance:
  - 列表阶段列/详情标题徽章/时间线组名均显示「轻量变更」，无裸显 "thin"
  - 阶段筛选（桌面+移动）可选「轻量变更」且过滤生效
  - 概览卡 thin 变更显示旁路徽标（◈ 轻量变更）而非全灰管线；quick 徽标带「存量」
verify:
  - cd frontend && pnpm exec tsc --noEmit && pnpm test -- change-step-badge
constraints:
  - 主题取值单一源 frontend/src/styles/themes.ts；品牌色类名用 brand-* 语义阶
  - 移动端两副本必须同步改；quick 存量后缀本任务一并落（徽章层）
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
