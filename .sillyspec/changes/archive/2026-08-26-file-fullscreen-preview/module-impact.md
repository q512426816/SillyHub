---
author: qinyi
created_at: 2026-08-26 20:20:00
updated_at: 2026-08-26 20:20:00
---

# 模块影响分析（Module Impact）— 文件全屏预览

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend | 修改 | change 子模块：service.py 提取 `_resolve_change_file` 路径守卫 helper + 新增 `read_file_raw`（50MB 上限）；router.py 新增 `GET /changes/{cid}/files/raw` StreamingResponse 端点；tests/test_router.py 增 5 用例 |
| frontend | 修改 | files 组件族：file-preview-modal.tsx 加全屏态（defaultFullscreen/fill）；previewers/index.ts 增 PreviewerProps.fill + HtmlPreviewer 导出；新增 previewers/html-previewer.tsx；六渲染器 fill 高度适配；preview-registry.ts 增 html/svg/bmp/ico 键。change-file-tree.tsx 非文本态改造 + 全屏入口。explorer/file-preview.tsx 改 antd Image + 全屏入口。lib/change-files.ts 增 fetchChangeFileRaw；lib/api-types.ts + backend/openapi.json gen:types 再生成。对应 4 组测试文件更新 |

## 未匹配文件

无（design §6 全部 16 行命中 backend/frontend 两模块路径）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新 backend 模块卡（change 子模块新增 files/raw 只读端点） | done |
| `modules/frontend.md` | 更新 frontend 模块卡（FilePreviewModal 全屏态/HtmlPreviewer/变更树与 explorer 接入） | done |
| `.sillyspec/docs/backend/modules/change.md` | 细粒度卡契约摘要文件子域补 files/raw 行 | done |
| `.sillyspec/docs/SillyHub/modules/frontend_lib.md` | 细粒度卡补 fetchChangeFileRaw 条目 | done |
| `_module-map.yaml` | 无变化（未增删模块，仅既有模块内改动） | skipped |
