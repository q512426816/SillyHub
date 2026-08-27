---
id: task-11
title: '三主题适配核查 + 全量回归（typecheck/test/lint）'
title_zh: '三主题适配核查 + 全量回归（typecheck/test/lint）'
author: 'WhaleFall'
created_at: 2026-08-25 01:29:35
priority: P0
depends_on: [task-09, task-10]
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-004@v1, D-006@v1]
allowed_paths:
  - frontend/src/components/files/file-preview-modal.tsx
goal: >
  收尾回归：核查三主题（blue、ai-native、dark）下预览弹窗走主题 token 无硬编码
  hex，静态验收 D-006（markdown 渲染器未裸用 @uiw），跑全量 typecheck、test、lint
  确认无回归，产出三入口手动冒烟清单供 verify 对照（FR-07）。
implementation:
  - 切换三主题逐一核查预览窗壳、加载态、错误态、fallback 的色值均走 brand-* 与主题 token
  - grep files 目录确认无硬编码 hex 颜色（主题外新样式仅允许白纸预览区保持浅底并注明）
  - 静态验收 D-006：grep markdown-previewer.tsx 确认未直接 import @uiw/react-markdown-preview
  - 产出三入口六格式手动冒烟清单（图片、pdf、docx、xlsx、md、pptx fallback）写入 verify-result 备查
acceptance:
  - 三主题下预览窗无样式破损，新增样式无硬编码 hex
  - markdown-previewer 无 @uiw 直接 import（D-006 静态验收）
  - typecheck、test、lint 三项全绿
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test
  - cd frontend && pnpm lint
constraints:
  - 回归卡原则上不改源码，发现真实缺陷单独立项处理而非顺手改
  - 不改前端以外的子项目（backend、daemon 本次无变更）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
