---
id: task-08
title: site-wide-bg-white-to-bg-card-cleanup
title_zh: '全站 bg-white→bg-card 清理（23 文件，表面场景替换/品牌底保留）'
author: 'qinyi'
created_at: 2026-08-23 23:17:51
priority: P1
depends_on: ['task-01', 'task-02', 'task-03']
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/components/agent-log/run-error-item.tsx
  - frontend/src/components/agent-log-viewer.tsx
  - frontend/src/components/agent-log/tool-renderers.tsx
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/app/(dashboard)/runtimes/[id]/audit/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/approvals/page.tsx
  - frontend/src/app/(dashboard)/ppm/workbench/page.tsx
  - frontend/src/app/m/ppm/workbench/page.tsx
  - frontend/src/app/(auth)/login/page.tsx
  - frontend/src/app/error.tsx
  - frontend/src/components/team-progress.tsx
  - frontend/src/components/daemon/runtime-card.tsx
  - frontend/src/components/daemon/machine-card.tsx
  - frontend/src/components/workspace/hero-header.tsx
  - frontend/src/components/workspace-switcher.tsx
  - frontend/src/components/ui/confirm-captcha.tsx
  - frontend/src/components/change-file-tree.tsx
  - frontend/src/components/ask-user-dialog-card.tsx
  - frontend/src/components/top-bar.tsx
  - frontend/src/components/mission-summary-card.tsx
  - frontend/src/components/error-boundary.tsx
  - frontend/src/components/agent-run-panel.tsx
goal: >
  清理全站 23 个文件残留的 bg-white 硬编码底色，表面场景替换为语义 bg-card
  （浅色两主题下 #FFFFFF 观感零回归，dark 自动 slate-800），品牌底场景保留，
  使 dark 主题全站无残留纯白大色块。
implementation:
  - 先在 frontend/src 全量 grep bg-white 按文件归档实况（以实际处数为准，design §5.3 分文件计数有小误，23 文件清单已核实）
  - 逐处按 design §5.3 口径判断——卡片/面板/气泡/输入底等表面场景改 bg-card，品牌色块/渐变头图上的白底白字（border-white、hero 区）保留原样
  - 大头文件先行（agent-log 系列、runtimes 页、team-progress、daemon 卡片、login 页），再清 1-2 处的小文件
  - 每文件改完双主题走查——浅色观感不变、dark 无残留白块
acceptance:
  - dark 主题下 23 文件无残留纯白大色块，仅品牌底场景保留 bg-white/border-white
  - 浅色两主题观感与清理前一致（bg-card 在浅色下渲染为纯白）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test（className 改动不破坏既有组件测试断言）
constraints:
  - 只改 className 字符串，不改组件结构/逻辑/props
  - 不动 border-white 与品牌底场景（design §5.3 保留口径）
  - 测试扩展统一在 task-10，本卡不新增测试
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
