---
author: flow-machine-draft
created_at: 2026-10-13T02:48:04.597Z
---
# 任务注册表（Tasks）— 2026-10-13-write-tool-diff

- [x] task-01: 测试先行——tool-args-detail.test.tsx 增 Write 展开区用例（有 editPatch 走红删绿增 DiffView；无 editPatch 整文件全绿新增 + 复制内容按钮），跑新用例确认先红。验证：`pnpm exec vitest run src/components/daemon/__tests__/tool-args-detail.test.tsx` 新用例失败（实测 2 failed 先红，10:52）
- [x] task-02: 实现——tool-args-detail.tsx WriteArgsDetail 接 editPatch（parseStructuredPatch→DiffView 红删绿增），无 patch 回退整文件全绿新增行，argsDetailOf Write 分支传 segment.editPatch；Edit 分支零改动。验证：同测试文件全绿（17/17，10:52:40）；另同步 turn-segment-views 两个旧 Write 渲染契约用例到新契约（pre→diff 行、5 万字符截断→2000 行护栏）+ DiffView 截断提示改中性文案
- [x] task-03: 回归——tool-args-detail.test.tsx + turn-segment-views.test.tsx（Edit 接线既有断言）全绿。验证：两文件 `pnpm exec vitest run` 89/89 全绿（10:54:57）+ `pnpm typecheck` 零错误
