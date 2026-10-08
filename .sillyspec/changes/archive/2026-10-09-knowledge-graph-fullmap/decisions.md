---
author: qinyi
created_at: 2026-10-09 00:39:06
---

# 决策台账 — 2026-10-09-knowledge-graph-fullmap

> 承接归档变更 2026-10-08-platform-knowledge-graph：用户看实际效果后推翻两条裁决——本变更记录新版本
> 决策（跨变更 supersedes 链）。

---

## D-001@v1

- type: architecture
- status: confirmed
- source: user
- question: 知识图谱页默认视图展示什么（旧裁决 D-006@v1=orphans 治理切片，实测 4 节点太空）？
- answer: 默认=全图星空总览（预计算坐标静态渲染）；点任意节点下钻该节点 neighbors 切片（力场）
- normalized_requirement: 图谱页首载（可用态且 dump 在场）默认加载并渲染全图星空静态总览（不启力场）；点节点自动切「查询切片」模式并以该节点为锚点发起 neighbors；胶囊手动回全图。dump 不可用（旧 CLI）时默认回退 orphans 视图（探测降级，cli_feature_missing:dump 先例）
- impacts: [FR-04, FR-05, task-前端页面]
- evidence: 用户裁决原话「设计裁决差异 1 想更有内容」（2026-10-08 会话）；supersedes 归档变更 D-006@v1（跨变更承接，非同仓版本号）
- priority: P1
- 锚点: frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx
- 模块域: frontend

## D-002@v1

- type: architecture
- status: confirmed
- source: user
- question: 全图形态用什么（旧裁决 D-008@v2=lite 簇气泡；原型=预计算坐标星空）？
- answer: 全图星空（预计算聚类坐标静态渲染，替换 lite）；坐标由 CLI `graph dump --layout` 离线算好下发，浏览器零布局计算
- normalized_requirement: CLI 新增 `sillyspec knowledge graph dump --layout --json`：输出全量 {nodes:[{id,type,label,x,y}], edges:[{s,t,type,strength}], stats}，坐标为确定性聚类布局（簇按 count 降序主环摆放+簇内黄金角散布，算法从归档原型 prototype-data-gen.cjs 移植，同输入同输出）；daemon 白名单加 dump（--layout 必带）；backend GET /knowledge/graph/dump 端点信封透传不裁剪、仅该端点手动 gzip 压缩（Content-Encoding 头，SSE/WS/既有端点零接触——Grill F-00）；分组口径=原型 comm() 粗分组（非 summary 细簇）；前端全图渲染直译原型全图分支（无力场/标签只在大节点或高缩放/点节点下钻）；lite 渲染分支移除（liteClusterLayout 纯函数与其单测保留）
- impacts: [FR-01, FR-02, FR-04, FR-05, 全部任务]
- evidence: 用户裁决原话「想要星空效果全图」；触发归档变更 D-008@v2 复潮条件（"用户裁决升级为全图静态总览"）
- priority: P1
- 模块域: backend, sillyhub-daemon, frontend
- 故障面: dump 全量 1.5-2MB 经 daemon WS 单帧回传——uvicorn ws 默认上限 16MB 余量足但需实测钉；旧 CLI 无 dump 时全图胶囊隐藏默认回退（不阻塞五查询）
- 退役判据: 知识库规模增长到 dump gzip >1MB 或 WS 实测不稳时，回退分层加载（分页 dump/按簇懒加载）

## D-003@v1

- type: architecture
- status: confirmed
- source: design
- question: dump 坐标在算（CLI 每次现算 vs 落盘缓存）？
- answer: 每次现算（内存派生，沿图不落盘铁律 D-003 同款）
- normalized_requirement: dump 布局在 CLI 进程内从 buildKnowledgeGraph 现算（确定性算法保证幂等），不落缓存文件不引失效问题；耗时与 summary 同量级（毫秒级坐标计算）
- impacts: [FR-01, task-01]
- evidence: 归档变更 D-003「图=解析时内存派生不落盘」铁律延续
- priority: P2
- 模块域: sillyspec
