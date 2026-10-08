---
author: qinyi
created_at: 2026-10-08 17:13:30
---

# 决策台账 — 2026-10-08-platform-knowledge-graph

> 本文件是本变更的决策台账。对话式探索/方案选择步的增量落盘未触发（CLI 增量规则漏网），
> 按「写设计文档并自审」步操作 3 从零补写；后续修正走 D-xxx@v2 + supersedes。

---

## D-001@v2

- type: architecture
- status: confirmed
- source: design-grill
- question: unavailable reason 分型如何在四份文档统一、且让 backend 可判别旧 daemon / 旧 CLI / Phase 0 缺件 / 消毒拒绝？
- answer: reason 收敛为 6 个稳定键（unbound/offline/timeout/upgrade_required/invalid_input/rpc_error）；daemon RpcError code 细分（method_unregistered / cli_subcommand_missing / cli_feature_missing:<sub> / validation_rejected / timeout / internal）作为判别信号
- normalized_requirement: 信封 reason 为稳定键枚举：`unbound`（RuntimeNotBound→绑定引导）、`offline`（DaemonRuntimeOffline→稍后再试）、`timeout`（DaemonRpcTimeout 或 RemoteError.code=timeout→稍后再试）、`upgrade_required`（code=method_unregistered〔旧 daemon〕或 cli_subcommand_missing〔旧 CLI〕→升级提示）、`invalid_input`（code=validation_rejected 消毒拒绝→输入错误提示）、`rpc_error`（internal 及 DaemonRpcConflict 等兜底→服务异常）。daemon 侧消毒拒绝回 validation_rejected（用户 4xx 语义，不并入升级文案）。overview 端点 summary 子块独立降级判据 = code=cli_feature_missing:summary|nodes。清单类查询（orphans/dangling）items 由 daemon 解析后裁剪 top-50 并保留 count 原值（完整治理走 CLI/doctor）
- impacts: [FR-01, FR-02, FR-04, FR-08, task-02, task-03, task-04]
- evidence: Grill 视角A F-02/F-03（reason 3/4/3 计数矛盾、method_not_found 过载）+ 视角B B-2（timeout/forbidden/internal 无归属）；ws_hub.py:532-594 异常族实证；runtime-handler.ts:430-433 RpcError code 先例
- priority: P1
- 锚点: backend/app/modules/knowledge/graph.py（NEW）
- 模块域: backend, sillyhub-daemon
- supersedes: D-001@v1
- 故障面: reason 键拼错时前端走 rpc_error 兜底文案；daemon 版本落后于 code 细分契约时 backend 归入 upgrade_required
- 退役判据: daemon/CLI 全量升级后 upgrade_required 分支仅剩历史库触发

## D-001@v1

- type: architecture
- status: confirmed
- source: user
- question: 平台侧图查询的数据从哪来（RPC 直采 / Python 重建 / 混合）？
- answer: 用户拍板 daemon RPC 直采 CLI（governance v2 同款先例）；不做 Python 本地回退
- normalized_requirement: 图查询/图维度数据一律经绑定 daemon 的 knowledge.graph RPC 直采 `sillyspec knowledge graph --json`；未绑定/离线/旧 CLI 时端点返回 available=false + reason（前端绑定引导），不落任何本地计算图数据的代码路径
- impacts: [FR-01, FR-02, FR-03, task-后端服务层]
- evidence: backend/app/modules/knowledge/service.py:116-156（governance RPC 先例）；用户问答轮次 1
- priority: P1
- 锚点: backend/app/modules/knowledge/graph.py（NEW）
- 模块域: backend
- 否决理由: （status=confirmed 不适用）
- 复潮条件: （status=confirmed 不适用）

## D-002@v1

- type: architecture
- status: confirmed
- source: user
- question: 知识图谱前端页挂载形态（新子页签 / 页内视图切换）？
- answer: workspace-tabs 新增 /knowledge/graph 子页签（与知识库并列，上游归档原型钦定形态）
- normalized_requirement: 前端新增 app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx 路由页；workspace-tabs.tsx TABS 数组在「知识库」后追加「知识图谱」项；菜单权限复用既有 knowledge 菜单卡（knowledge:read/write），不新增菜单卡与权限枚举
- impacts: [FR-05, task-前端页面]
- evidence: frontend/src/components/workspace-tabs.tsx:8-28；frontend/src/lib/menu-permissions.ts:181-197；用户问答轮次 1
- priority: P1
- 锚点: frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx（NEW）
- 模块域: frontend

## D-003@v1

- type: architecture
- status: confirmed
- source: user
- question: 图谱画布实现技术（自绘 canvas / React Flow / echarts）？
- answer: 自绘 canvas 直译归档原型（velocity Verlet 力场仅查询切片 ≤ 百级节点；拾取/hover/拖拽/缩放/fitView）
- normalized_requirement: 画布为自绘 canvas 组件，力场模拟与绘制直译原型 step()/draw()；只在查询结果切片（≤百级节点）启用物理，不做全图在线力导向；节点 10 类型色取自 themes[theme] 并以组件级 CSS 变量注入（git-log commit-graph lanePalette 同款），禁硬编码 hex；边三档强弱用实线/长虚/点虚 + 粗细区分（形状区分天然主题无关）；几何/力场计算函数导出为纯函数供单测
- impacts: [FR-05, FR-06, task-前端画布]
- evidence: frontend/src/components/git-log/commit-graph.tsx:52-66（CSS 变量注入先例）；sillyspec 仓 archive/2026-10-08-knowledge-graph/prototype-knowledge-graph.html:338-369（step() 原型）；用户问答轮次 1 + 原型浏览器实测
- priority: P1
- 锚点: frontend/src/components/knowledge/graph-canvas.tsx（NEW）
- 模块域: frontend

## D-004@v1

- type: feature
- status: confirmed
- source: user
- question: 知识 stats 运营面板（OpsDashboard）是否加图维度指标卡？
- answer: 加——孤儿/悬空计数 + 点开清单模式（复用死条目卡惯例）；未绑定 daemon 时卡位显示绑定引导
- normalized_requirement: OpsDashboard 指标网格新增图维度卡（孤儿数/悬空数，text-warning 主数值，点开 max-h overflow-y-auto 清单）；数据走 /knowledge/graph/overview 端点；available=false 时卡位降级为绑定引导文案；新字段读取一律 `?? []` 运行时防御；不改 HitsService.stats() 主体（图卡是独立数据源的附加卡）
- impacts: [FR-07, task-前端图卡]
- evidence: frontend/src/components/knowledge/ops-dashboard.tsx:157/266-295（子卡与清单惯例）；用户问答轮次 1
- priority: P2
- 锚点: frontend/src/components/knowledge/ops-dashboard.tsx
- 模块域: frontend

## D-005@v1

- type: architecture
- status: confirmed
- source: user
- question: 总体方案（A 平台仓最小闭环 / B CLI 仓协作全体验）？
- answer: 方案 B——sillyspec 仓先行补 graph summary 与 graph nodes --search 两个子命令，平台仓全量对接（含总览分布面板 + 锚点自动补全）
- normalized_requirement: 跨仓两段施工：阶段 1 在 sillyspec 仓（另立其仓内变更，非本变更文件面）交付 `knowledge graph summary --json`（nodes/edges 总数 + byType/byEdge 分布 + 专项计数）与 `knowledge graph nodes --search <模糊> --json`（id/label 过滤限 20）；阶段 2 本变更对接。平台侧对 summary/nodes 做能力探测降级：daemon 返回 method_not_found（旧 CLI）时隐藏总览面板与补全，主链路（五查询/图卡 orphans+dangling）不受阻——保证两段可独立交付
- impacts: [FR-02, FR-03, FR-08, task-后端端点, task-daemon]
- evidence: sillyspec 仓 archive/2026-10-08-knowledge-graph/design.md:27（阶段三范围定义）；用户问答轮次 2
- priority: P1
- 模块域: backend, sillyhub-daemon
- 故障面: 阶段 1 未交付/未升级 CLI 时平台功能降级（总览/补全缺失），探测逻辑错判会误隐藏或误报错——由 FR-08 能力探测用例覆盖
- 退役判据: sillyspec CLI 全量部署版本 ≥ summary/nodes 引入版本后，探测降级分支可简化移除

## D-006@v1

- type: feature
- status: confirmed
- source: user
- question: 图谱页首次进入的默认视图（空态引导 / 预置 orphans 治理切片）？
- answer: 预置 orphans 治理切片——进页自动跑 orphans 查询（红色警示环 + 右栏孤儿清单）
- normalized_requirement: 图谱页首载（可用态）自动发起 orphans 查询并渲染结果切片（warn 红环、右栏切查询结果 tab、mode-chip 显示）；available=false 时不发起并显示绑定引导
- impacts: [FR-05, task-前端页面]
- evidence: 用户问答轮次 2
- priority: P2
- 锚点: frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx（NEW）
- 模块域: frontend

## D-008@v2

- type: architecture
- status: confirmed
- source: user
- question: 要不要全图总览（1.5MB 全量下发）？以什么形态？
- answer: 全图 lite（簇代表+下钻）——不下发全量节点，下发每簇代表大节点（度数 top-N）+ 簇计数，流量几十 KB；点代表节点下钻切片查询
- normalized_requirement: 全图视觉总览以 lite 形态纳入本期：summary 子命令输出 clusters（簇 key=(节点类型,域)、count、representatives=度数 top-5 节点 GraphNodeRef，度数口径=全边型入+出）；overview 端点透传；前端图谱页数据面加「总览 lite」模式（簇气泡=视觉分组+计数徽标，代表节点=真实可点节点静态布局；状态机：执行查询或点代表节点→自动切切片模式，胶囊手动回 lite）；全量 1.5MB 下发与在线全图力导向仍无条件排除
- impacts: [FR-02, FR-05, Phase 0 契约, task-前端画布]
- evidence: 用户裁决轮次 4（三选项呈报：维持不做/全图静态总览/全图 lite——选 lite）
- priority: P1
- 模块域: backend, frontend
- supersedes: D-008@v1
- 故障面: 簇代表选择（度数 top-N）可能漏掉用户关心的低度数节点——簇计数徽标 hover 明示「展示度数前 N」，完整探索靠查询切片兜底
- 退役判据: 用户裁决升级为全图静态总览（dump --layout）时本 lite 模式可保留为快速总览或移除

## D-007@v1

- type: architecture
- status: confirmed
- source: user
- question: 后端响应契约采用 CLI JSON 原样透传还是平台 DTO 规范化？
- answer: DTO 规范化——统一信封 {available, reason?, source, data}，data 按子命令分型收拢
- normalized_requirement: 图端点响应为平台自有 Pydantic schema：外层信封（available: bool / reason: str | None / source: "daemon-rpc"）+ data 按查询类型分型（五查询各自的规范化字段 + overview/nodes 型）；OpenAPI 可生成前端类型；不把 CLI 的 JSON 原样透传给前端（避免前端处理随 CLI 演进的原始形状）
- impacts: [FR-01, FR-02, FR-03, task-后端 schema]
- evidence: 分段设计展示（用户确认轮次 3）；frontend/src/lib/knowledge.ts:9-28（生成类型导出惯例）
- priority: P1
- 锚点: backend/app/modules/knowledge/schema.py
- 模块域: backend
