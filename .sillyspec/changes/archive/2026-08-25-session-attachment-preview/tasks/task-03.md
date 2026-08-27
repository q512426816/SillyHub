---
id: task-03
title: 'add-preview-registry'
title_zh: 'preview-registry 格式匹配（blob.type > meta.mime > 扩展名）+ 单测'
author: 'WhaleFall'
created_at: 2026-08-25 01:29:35
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: []
provides: [{contract: matchRenderer, fields: [RendererKey]}]
allowed_paths:
  - frontend/src/components/files/preview-registry.ts
  - frontend/src/components/files/__tests__/preview-registry.test.ts
goal: >
  新建 preview-registry 提供 matchRenderer(mime, filename)，按 blob.type 高于 meta.mime 高于扩展名的优先级解析六类 RendererKey，供 Modal 与渲染器分发消费（FR-03）。
implementation:
  - 新建 frontend/src/components/files/preview-registry.ts，导出 RendererKey 类型（image、pdf、docx、xlsx、markdown、fallback 六值）与 matchRenderer(mime, filename) 纯函数
  - 匹配优先级 blob.type 高于 meta.mime 高于扩展名兜底（会话附件 marker 无 mime，blob.type 是唯一可靠来源），MIME 覆盖图片、pdf、wordprocessingml、spreadsheetml 常见值，扩展名兜底覆盖 png、jpg、jpeg、webp、gif、pdf、docx、xlsx、md、markdown，未命中返回 fallback
  - 新建 __tests__/preview-registry.test.ts 覆盖六类 key 与边界（无 mime 加未知扩展名、mime 与扩展名冲突时 mime 优先）
acceptance:
  - 无 mime 且未知扩展名返回 fallback，.md 与 .markdown 均返回 markdown
  - .docx 扩展名与 application/vnd.openxmlformats-officedocument.wordprocessingml.document 均返回 docx
  - mime 与扩展名指向不同类型时以 mime 为准（FR-03 优先级），六类 key 各有正向用例
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- preview-registry
constraints:
  - 纯函数无副作用且不依赖 React，不 import 任何渲染器组件（渲染器属后续 Wave）
  - 不做 pptx 与旧格式 Office 匹配（非目标，一律 fallback）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
