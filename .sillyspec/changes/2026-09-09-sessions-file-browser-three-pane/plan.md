---
plan_level: full
---

# 实现计划（Plan）— 会话页三分屏：会话 ⇄ 工作区文件浏览器

## Spike 前置验证

无——复用组件签名已经 Design Grill 独立审查逐一对码（panel-resizer.tsx:21-30 / file-explorer.tsx:54-59 / file-preview.tsx:341-346 / api-types.ts:14825），无技术不确定性。

## Wave 1（并行，无依赖）

- task-01
- task-02

依赖说明：task-01（壳组件+常量+新测试）与 task-02（headerExtra 插槽）互不依赖可并行；都为 task-03 的输入。

## Wave 2（依赖 Wave 1）

- task-03

依赖说明：task-03（portal 接线：状态机/上下文快照/三栏布局/测试）消费 task-01 的壳组件与常量、task-02 的插槽。

## Wave 3（依赖 Wave 2，收尾验收）

- task-04

依赖说明：task-04 只读验收（静态检查/六文件回归/浏览器实拍/模块文档），依赖 task-03 完成。

## 风险对照（摘 design §9）

- R-01 布局高度链 → task-03 用例 + 既有 39 用例 + 实拍兜底
- R-04 mock 分层 → task-01 mock lib/explorer、task-03 mock explorer 两组件
- R-05 深链异步 → task-03 深链翻转载入用例

## 需求覆盖（FR → Wave）

- FR-01 左栏二模切换 → Wave 1（task-02 插槽）+ Wave 2（task-03 状态机与切换）
- FR-02 两入口与上下文解析 → Wave 2（task-03 selectedWorkspaceId 六写入点）
- FR-03 右侧文件内容列 → Wave 1（task-01 预览壳）+ Wave 2（task-03 开列/关列/保留）
- FR-04 三栏拖拽调宽 → Wave 2（task-03 两把 PanelResizer 接线，常量出自 task-01）
- FR-05 代码结构与质量 → Wave 1（task-01 壳组件+测试）+ Wave 2（task-03 测试）+ Wave 3（task-04 静态检查与零回归）
