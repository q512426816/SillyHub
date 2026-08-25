---
author: WhaleFall
created_at: 2026-08-25 10:55:00
---

# 模块影响分析（Module Impact）— 会话附件与文件统一在线预览

> 首版生成于 plan 阶段（基于 design.md §6 文件变更清单 + plan.md 任务列表）；execute/verify
> 阶段按实际代码变更更新，archive 阶段终审。

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| frontend_components | 新增 | 新建 `components/files/` 目录：file-preview-modal / preview-registry / use-object-url / previewers/ 六渲染器 / index.ts（plan task-02/03/05/06/07/08） |
| frontend_components | 修改 | `components/daemon/attachment-chips.tsx`（chips 全部可点击弹预览，task-09）；`components/daemon/file-message-card.tsx`（卡片主体可点击预览，task-10）；`components/file-viewer.tsx`（非图片项加预览入口，task-10） |
| frontend_lib | 修改 | `lib/api/session-attachments.ts` 新增 `fetchAttachmentBlob` 导出 + 401 单飞刷新对齐（task-04） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| frontend/package.json + pnpm-lock.yaml | 新增依赖 docx-preview（npm）与 xlsx（SheetJS 官方源 tarball，D-005@v1）；项目级配置文件，不归属单一模块，module-map 无需变更 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/frontend_components.md` | 更新前端组件层模块卡（新增 files/ 统一预览组件族、三入口组件行为变化） | pending |
| `modules/frontend_lib.md` | 更新 lib 模块卡（session-attachments.ts 新增 fetchAttachmentBlob 导出） | pending |
| `_module-map.yaml` | 无变化（未增删模块，新增文件均落入现有 paths glob） | skipped |
