---
id: task-06
title: 'docx/xlsx 渲染器（动态 import、异常降级、2000 行截断保护）+ 测试'
title_zh: 'docx/xlsx 渲染器（动态 import、异常降级、2000 行截断保护）+ 测试'
author: 'WhaleFall'
created_at: 2026-08-25 01:29:35
priority: P0
depends_on: [task-01, task-03]
blocks: [task-08]
requirement_ids: [FR-02]
decision_ids: [D-001@v1, D-005@v1]
provides:
  - contract: PreviewerProps
    fields: [blob, url, meta]
expects_from:
  task-03:
    - contract: matchRenderer
      needs: [RendererKey]
allowed_paths:
  - frontend/src/components/files/previewers/docx-previewer.tsx
  - frontend/src/components/files/previewers/xlsx-previewer.tsx
  - frontend/src/components/files/__tests__/previewers-office.test.tsx
goal: >
  实现 docx 与 xlsx 两个渲染器（统一消费 PreviewerProps）：docx 经 docx-preview 动态
  import 渲染进容器并异常降级，xlsx 经 SheetJS 读取渲染多 sheet 表格并做 2000 行截断
  保护，覆盖用户需求的 office 在线预览（D-001@v1）。
implementation:
  - docx-previewer 用 useRef 容器加 useEffect，await import docx-preview 后 renderAsync 将 blob 的 arrayBuffer 渲染进容器，try/catch 异常置错误态并附下载引导（R-01），unmount 时清空容器
  - xlsx-previewer 用 useMemo 从 blob 的 arrayBuffer 经 xlsx read 解析 workbook，sheet_to_html 逐表转 HTML 表格，sheet 名渲染 tab 切换；单表超 2000 行时截断并提示完整内容请下载（R-03）
  - 新建 __tests__/previewers-office.test.tsx，mock docx-preview 与 xlsx（jsdom 环境）验证渲染调用与 2000 行截断、异常降级路径
acceptance:
  - docx 渲染异常时显示错误态加下载引导，不白屏
  - xlsx 多 sheet 可切换，超 2000 行的表截断并显示提示
  - docx-preview 与 xlsx 均为动态 import，不进首屏静态包
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- previewers-office
constraints:
  - 依赖由 task-01 已安装，本卡不改 package.json 与 lock 文件
  - 仅支持 OOXML（docx、xlsx），旧格式 doc 与 xls 不渲染走 fallback（非目标）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
