---
author: flow-machine-draft
created_at: 2026-10-13T06:14:15.565Z
---
# 设计记录（Design Record）— 2026-10-13-change-files-view-polish

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

纯前端展示优化，不动后端。两个新视图放进既有「固定结构产物可视化视图」的家 structured-views.tsx（与 JsonView/DiffView 同层）：

- **TimelineView**：tryParseTimeline 解析 timeline.md 正文（`#` 标题 / `>` 引言 / `📅` 元信息 / `── 事件时间轴 ──` 区块的 `HH:MM:SS 事件文本` 行 / `── 任务面（…）──` 区块的 `task-NN ≈时刻 描述 提交锚` 行 / 其余墙钟脚注行），事件与任务按时刻升序排序后渲染竖向时间线（时刻列 mono + 节点圆点 + 事件文本），任务面与脚注各自分区。解析不命中（无事件时间轴区块）返回 null，调用方回落既有 MarkdownText。
- **PatchTreeView**：tryParsePatchFiles 按 `diff --git` 头把 change.patch 切成文件段（路径取 `+++ b/…` 行，删除文件回退 `--- a/…`；增删数按 +/- 行计数，排除 +++/---），渲染逐文件折叠清单（默认全收起，展开单文件复用 DiffView 渲染该段——parseUnifiedDiff 本就跳过文件头行，逐段可直接喂）。无 `diff --git` 头返回 null 回落整片 DiffView。

分发点两处共用同一实现：内联 change-file-tree.tsx FilePreview（.md 分支先试 timeline、patch 分支先试 change.patch 文件树）与全屏 previewers（markdown-previewer/patch-previewer 按 meta.name basename 转发），满足 FR-04 不做两套。中文名走 lib/change-files.ts CHANGE_FILE_CN 纯映射扩展 7 键，树节点/内容标题展示逻辑零改动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

structured-views.tsx 新增导出：`tryParseTimeline(text) → TimelineData | null`、`TimelineView({ data })`、`tryParsePatchFiles(content) → PatchFileSection[] | null`、`PatchTreeView({ sections })`。lib/change-files.ts CHANGE_FILE_CN 新增 7 键：plan.md=实现计划、delta.md=变更增量、module-impact.md=模块影响分析、symbol-impact.md=符号影响面、apply-manifest.json=应用清单、verify-facts.json=验证事实、scope-audit.json=范围审计。无后端端点/DTO/数据格式改动（api-types 不涉）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/lib/change-files.ts | CHANGE_FILE_CN 补 7 个固定产物中文名 |
| 修改 | frontend/src/components/files/structured-views.tsx | 新增 tryParseTimeline/TimelineView/tryParsePatchFiles/PatchTreeView |
| 修改 | frontend/src/components/change-file-tree.tsx | FilePreview 接线 timeline.md/change.patch 分发 |
| 修改 | frontend/src/components/files/previewers/markdown-previewer.tsx | 全屏 timeline.md 转发 TimelineView |
| 修改 | frontend/src/components/files/previewers/patch-previewer.tsx | 全屏 change.patch 转发 PatchTreeView（补 meta 解构） |
| 修改 | frontend/src/components/files/__tests__/structured-views.test.tsx | 新视图解析/渲染/回落单测 |
| 修改 | frontend/src/components/__tests__/change-file-tree.test.tsx | 中文名断言扩展（含 mock 内联映射同步）+ 内联分发测试 |
| 修改 | frontend/src/components/files/__tests__/markdown-previewer.test.tsx | 全屏 timeline.md 分发/回落测试 |
| 新增 | frontend/src/components/files/__tests__/patch-previewer.test.tsx | 全屏 change.patch 分发/回落测试 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   成立。事件/任务解析后按时刻字符串升序排序（同日 HH:MM:SS 字典序即时间序），文件内乱序输入渲染仍有序；无时刻行或区块缺失时 tryParseTimeline 返回 null 回落 markdown，不依赖顺序假设。patch 文件段顺序即 diff 输出顺序，切分不依赖排序。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   视图是纯解析 + 只读渲染，无写路径；文件被 daemon 重写时由既有「选中文件 content 切换 → 重渲染」链路覆盖，新视图随 content prop 重算（useMemo/受控输入），无中间态落盘。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   折叠开合是组件局部 useState，选中文件切换时 FilePreview 重挂载自然重置，无跨文件残留；解析函数无副作用、无定时器、无订阅，卸载即净。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   不会。分发按文件 basename 精确匹配（timeline.md / change.patch）触发，workspace/change 维度无关；其他同名扩展文件（任意 .md/.patch）走既有渲染，行为不变。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：timeline.md/change.patch 是 sillyspec CLI 生成的固定格式，未来格式漂移导致解析不命中——两边都以「不命中回落既有渲染」兜底，漂移只降级不炸（与 knownJsonView 结构特征校验同一范式）。

试过但放弃的方案：按 emoji 前缀（🁢📄🔀⚠️📝✅）枚举给时间线节点逐类着色——emoji 集与 CLI 版本耦合，漂移即漏色；改为只识别「时刻开头行」的通用正则，emoji 随事件文本原样透传，节点统一品牌色圆点，不依赖枚举。
