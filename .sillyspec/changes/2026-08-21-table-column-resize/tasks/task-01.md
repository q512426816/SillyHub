---
id: task-01
title: 'use-resizable-columns.ts hook（header.cell 真手柄+3px 阈值+拖中禁选中）+ globals.css 手柄样式'
title_zh: 'use-resizable-columns.ts hook（header.cell 真手柄+3px 阈值+拖中禁选中）+ globals.css 手柄样式'
author: 'qinyi'
created_at: 2026-08-21 02:49:21
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-XX]
decision_ids: [D-XXX@vN]
allowed_paths:
  - frontend/src/components/layout/use-resizable-columns.ts
  - frontend/src/app/globals.css
goal: >
  一句话说明这个 task 要做什么、为什么。
implementation:
  - useResizableColumns(columns, onColumnsResize) 返回包装 columns+components.header.cell（th 渲染手柄 span data-col-key）
  - 仅 typeof width === number 的列挂手柄（string/无 width 跳过，D-502@v2）
  - 手柄 mousedown 记 pageX+当前宽，document mousemove 改本地 widths state，mouseup 收尾回调（key=dataIndex ?? title）；3px 阈值内不算拖拽
  - 拖拽中 body 加 sh-col-resizing（user-select none+col 光标），结束移除
  - globals.css 追加 sh-resize-handle（右缘 w-1.5 cursor-col-resize hover/active brand-400 高亮）与 sh-col-resizing
acceptance:
  - number width 列渲染手柄
  - string/无 width 列无手柄
  - 拖中禁文本选中
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 边界约束 1（如：不加测试）
  - 边界约束 2（如：不修改传入参数）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
