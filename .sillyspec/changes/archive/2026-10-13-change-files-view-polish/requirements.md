---
author: flow-machine-draft
created_at: 2026-10-13T06:14:15.565Z
---
# 需求规格（Requirements）— 2026-10-13-change-files-view-polish

## 功能需求

### FR-01: timeline.md 预览渲染为按时间排序的竖向时间线（时刻列+节点+事件文本，任务面/统计脚注分区呈现），解析失败回落原 markdown 渲染

- 预览 timeline.md 时，必须先把正文解析为「事件时间轴」竖向时间线视图（每事件=时刻列+节点+文本，事件按时刻升序排序），「任务面」与墙钟统计脚注分区呈现；解析不命中（无「── 事件时间轴 ──」区块）时必须回落既有 MarkdownText 渲染，禁止解析失败时白屏或丢内容。

#### 场景：主路径

Given 变更目录含 sillyspec 生成的 timeline.md（含事件时间轴/任务面/脚注三段）；When 用户在变更文件树选中该文件；Then 内联预览渲染竖向时间线（时刻升序），任务与脚注各自分区。

#### 场景：格式漂移回落

Given timeline.md 缺「── 事件时间轴 ──」区块（CLI 未来格式漂移）；When 选中预览；Then 按普通 markdown 渲染，不报错。

### FR-02: change.patch 预览按文件折叠展示（每文件一行：路径+增删统计，默认收起，展开看该文件红绿 diff），无 diff --git 头回落整片 DiffView

- 预览 change.patch 时，必须按 `diff --git` 文件头切分为逐文件折叠清单（每行=文件路径+新增/删除计数，默认全部收起），展开单个文件渲染该文件的红绿 DiffView；无 `diff --git` 头时必须回落既有整片 DiffView，禁止空清单态。

#### 场景：主路径

Given change.patch 含多个文件的 unified diff；When 选中预览；Then 文件清单默认收起，点击某文件行展开仅该文件的红绿 diff。

#### 场景：单文件/无头回落

Given patch 内容无 `diff --git` 头（或非 diff 格式）；When 选中预览；Then 渲染整片 DiffView（其内部回落纯文本），行为与现状一致。

### FR-03: plan.md/delta.md/module-impact.md/symbol-impact.md/apply-manifest.json/verify-facts.json/scope-audit.json 在文件树与内容标题显示中文名+原名对照，与既有固定产物一致

- 上述 7 个固定产物文件必须加入 CHANGE_FILE_CN 映射，在文件树节点与内容标题主显中文名 + 原名小字对照（实现计划/变更增量/模块影响分析/符号影响面/应用清单/验证事实/范围审计），展示形态必须与既有固定产物（proposal.md 等）完全一致；非固定名回落原名。

#### 场景：主路径

Given 变更目录含 plan.md 等固定产物；When 文件树渲染；Then 节点主显「实现计划」等中文名，原名以 muted 小字对照。

### FR-04: 内联预览与全屏预览（previewers）共用同一套新视图，不做两套渲染

- TimelineView 与 PatchTreeView 必须定义在 structured-views.tsx 单一处，内联 FilePreview 与全屏 markdown/patch previewer 都从该处 import 消费；禁止在 previewer 内复制第二套解析/渲染实现。

#### 场景：主路径

Given 用户在内联预览点击「全屏预览」打开 timeline.md/change.patch；Then 全屏弹窗渲染与内联同一视图组件，两处呈现一致。

### FR-05: 聚焦测试通过（structured-views/change-file-tree/相关 previewer），不跑全量

- 本变更必须补齐新视图的解析/渲染/回落单测并跑聚焦测试（structured-views / change-file-tree / markdown、patch previewer 相关文件）全绿；禁止跑全量测试（留给 CI）。

#### 场景：主路径

Given 新增 TimelineView/PatchTreeView 与中文名映射；When 运行聚焦测试文件；Then 全部通过且既有用例无回归。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/files/__tests__/structured-views.test.tsx「tryParseTimeline：解析事件/任务/脚注与排序」「TimelineView：渲染时间线/任务面/脚注」「tryParseTimeline：无事件时间轴区块返回 null」
FR-02: frontend/src/components/files/__tests__/structured-views.test.tsx「tryParsePatchFiles：按 diff --git 切分文件段」「PatchTreeView：默认收起、点击展开该文件 diff」「tryParsePatchFiles：无 diff --git 头返回 null」
FR-03: frontend/src/components/__tests__/change-file-tree.test.tsx「固定产物树节点主显中文名 + 原名对照」（扩展断言覆盖新增 7 名）
FR-04: frontend/src/components/files/__tests__/structured-views.test.tsx「TimelineView/PatchTreeView 为共享导出，内联与全屏同源」（由 markdown/patch previewer 分发测试覆盖）
FR-05: 聚焦测试运行（structured-views / change-file-tree / markdown、patch previewer）——运行即绑定，无独立用例文件
