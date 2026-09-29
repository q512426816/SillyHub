---
author: flow-machine-draft
created_at: 2026-09-29T08:25:19.927Z
---
# 设计记录（Design Record）— 2026-09-29-change-detail-timeline-files-polish

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-change-detail-timeline-files-polish 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
三处纯展示层优化，不动数据链路：
1. 时间线卡（change-timeline-card.tsx）：事件轴从 border-dashed 平铺改为「节点圆点 + 连线」竖向时间轴结构（借用 primer Timeline 的视觉语言但行距收紧，事件密集场景 primer 本体 pb-5 太占空间，不直接复用）；卡内容区限高 max-h 内部滚动；事件超过 30 条默认只渲染最近 30 条 + 「展开全部」切换（useState）。
2. watcher-events.jsonl 预览：后端 _TEXT_SUFFIXES 补 .jsonl（当前被判非文本，内容预览完全不可用，这是用户诉求的根因）；前端 structured-views.tsx 新增 tryParseJsonl + JsonlView（通用逐行视图）+ watcher-events.jsonl 专用表格视图（时刻/kind 中文徽章/阶段/详情，ts epoch ms 转本地时刻）；preview-registry EXT_MAP 加 jsonl 键、新建 jsonl-previewer、file-preview-modal RENDERER_MAP 注册、JsonPreviewer 对 .jsonl 文件名兜底转发（防后端 mime 报 application/json 时走 json 分支）、change-file-tree FilePreview 加 jsonl 分支（内联）。
3. 中文名映射：change-file-tree.tsx 内置固定产物名 → 中文映射表（proposal.md→变更提案 等 14 项，按近三日 49 个变更目录统计）；树节点主显中文名 + muted 小字原名，内容区标题同理；下载/全屏预览 meta.name 保留原文件名（下载文件不被改名）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-change-detail-timeline-files-polish 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
- 后端：ChangeService._TEXT_SUFFIXES 增加 ".jsonl"——变更文件列表 is_text 判定变化（watcher-events.jsonl 从非文本→文本），content 端点对其可读；无新端点、无 DTO 变化（openapi.json 不变，无需 gen:types）。
- 前端 structured-views.tsx 新导出：tryParseJsonl(text) / JsonlView / knownJsonlView（纯新增，既有导出签名不变）。
- preview-registry.ts：RendererKey 联合类型加 "jsonl"，EXT_MAP 加 jsonl 键（纯扩展，既有映射不变）。
- file-preview-modal.tsx：RENDERER_MAP 加 "jsonl" 条目。
- change-file-tree.tsx / change-timeline-card.tsx：组件内部渲染调整，Props 签名不变。
对外可见行为：变更文件弹窗中 watcher-events.jsonl 可预览（内联 + 全屏）；固定产物文件显示中文名；时间线卡视觉变化 + 限高 + 折叠。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-change-detail-timeline-files-polish 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到到达：时间线数据来自后端聚合接口（正序投影），前端只读渲染无排序假设；watcher-events.jsonl 逐行渲染保持文件原序，不排序不聚合，乱序输入按原样呈现（观测语义，红线 D-004 延续：只展示不消费）。
2. 并发写：全部为只读展示组件；useQuery 30s 轮询与既有范式一致，无 mutation；折叠开关是纯 UI 本地 state，数据刷新不重置也无碍（展开态以已渲染列表为准）。
3. 切换/生命周期：切换变更（changeId 变化）时组件因 key/queryKey 变化重新挂载/取数，折叠态随之重置，属预期；限高滚动容器无全局状态。
4. 作用域：中文名映射按文件 basename 精确匹配（不含路径前缀），同目录下任意子路径中的同名固定产物也会命中映射——SillySpec 变更目录结构里这些文件名即语义身份，跨工作区不串台（映射是无副作用常量表）。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-change-detail-timeline-files-polish 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：现有时间线卡测试断言行级 className（text-amber-700 醒目态）与 testid——重构 DOM 结构时须保住这两个锚点；jsonl 预览的 mime 不确定性（后端 guess_type 对 .jsonl 在不同平台可能返回 None/application/json/text-plain）已用三层兜底（EXT_MAP + JsonPreviewer 名字转发 + 解析失败回落纯文本）覆盖。
试过放弃的方案：直接复用 primer Timeline 组件做事件轴——放弃：其节点 h-7 + pb-5 行距是稀疏事件范式（GitHub 活动流），事件密集的留痕时间线用它会把卡片撑得更高，与「限高防撑爆」目标矛盾；只借其「节点+连线+tone」视觉语言自建紧凑行。另放弃在 openFullscreenPreview 里把 meta.name 换成中文名——下载文件会得到中文名文件，破坏本地对照能力。
