---
author: flow-machine-draft
created_at: 2026-10-13T06:14:15.565Z
---
# 任务注册表（Tasks）— 2026-10-13-change-files-view-polish

- [x] task-01: CHANGE_FILE_CN 补 7 个固定产物中文名（plan/delta/module-impact/symbol-impact/apply-manifest/verify-facts/scope-audit），同步 change-file-tree.test.tsx mock 内联映射并扩展中文名断言，聚焦跑该测试文件验证
- [ ] task-02: structured-views.tsx 新增 tryParseTimeline + TimelineView（事件时刻升序竖排时间线/任务面/脚注分区，无事件时间轴区块返回 null），补解析+渲染+回落单测并聚焦验证
- [ ] task-03: structured-views.tsx 新增 tryParsePatchFiles + PatchTreeView（diff --git 切分、默认收起、展开复用 DiffView、无头返回 null），补解析+渲染+回落单测并聚焦验证
- [ ] task-04: 内联 FilePreview 与全屏 markdown/patch previewer 接线新视图分发（basename 精确匹配 + 回落），补 previewer 分发断言
- [ ] task-05: 聚焦测试收口（structured-views / change-file-tree / markdown、patch previewer 四组测试文件全绿）+ pnpm typecheck 零错误
