---
author: flow-machine-draft
created_at: 2026-10-13T02:48:04.597Z
---
# 提案书（Proposal）— 2026-10-13-write-tool-diff

## 动机

任务原话转写：会话面板 Write 工具展开区不显示 diff（Edit 有「变更对比」而 Write 只显示全文），前端补上 Write 的 diff 渲染
成功标准：
- Write 工具展开区在有 edit_patch（structuredPatch）时渲染红删绿增 DiffView，与 Edit 分支同管线
- 无 edit_patch 时整文件按新增行全绿展示，保留复制内容按钮
- 相关前端测试通过，不改动 Edit 分支现有行为

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. Write 工具展开区在有 edit_patch（structuredPatch）时渲染红删绿增 DiffView，与 Edit 分支同管线
2. 无 edit_patch 时整文件按新增行全绿展示，保留复制内容按钮
3. 相关前端测试通过，不改动 Edit 分支现有行为

## 成功标准（可验证）

1. Write 工具展开区在有 edit_patch（structuredPatch）时渲染红删绿增 DiffView，与 Edit 分支同管线
2. 无 edit_patch 时整文件按新增行全绿展示，保留复制内容按钮
3. 相关前端测试通过，不改动 Edit 分支现有行为
