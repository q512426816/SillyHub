---
author: qinyi
created_at: 2026-10-08 16:41:23
generated_by: sillyspec-design-init
scale: large  # 跨 backend/sillyhub-daemon/frontend 三端、17 文件、RPC 白名单+新端点+新页面，需 Wave 编排 → run plan
---

# 设计文档（Design）— 2026-10-08-platform-knowledge-graph

## 背景

SillySpec 工具仓已交付知识图引擎（变更 sillyspec/2026-10-08-knowledge-graph，已归档）：`sillyspec knowledge graph <neighbors|path|impact|orphans|dangling> --json` 五查询 + doctor 图完整性六检查，10 节点类型 / 16 边型三档强度。其 design.md 非目标第 27 行明确把平台侧三件留待本变更：**SillyHub graph-search 端点、stats 图维度指标、前端可视化页**，并钦定了原型形态（archive/2026-10-08-knowledge-graph/prototype-knowledge-graph.html，本会话浏览器实测：三栏布局、neighbors 查询高亮 dim 反馈、力场切片、4628 节点全图静态聚类渲染均有效）。

平台侧现状：backend knowledge 模块（backend/app/modules/knowledge/router.py:1-383）有条目 CRUD / 蒸馏 / hits 遥测 + stats（hits.py:270-521）/ 治理信号三族端点，**无任何 graph 端点**；治理信号 v2 已确立「daemon RPC 直采 CLI + source 标」先例（service.py:116-156）；daemon 侧已有 KnowledgeGovernanceHandler 白名单执行 CLI 的三防线（sillyhub-daemon/src/runtime-handler.ts:388-477）。前端知识页为单页堆叠（OpsDashboard/GovernanceCards/树+内容），无图谱视图。

本变更把图能力接进平台：后端图查询端点（RPC 直采单源真相）+ daemon 白名单 + 前端「知识图谱」子页签 + OpsDashboard 图维度卡。

## 设计目标

1. 平台可通过 HTTP 查询知识图五视图（neighbors/path/impact/orphans/dangling），结果与 CLI `--json` 同源同义（D-001/D-007）。
2. 图维度健康度可见：OpsDashboard 图维度卡（孤儿/悬空计数+清单），数据同 RPC 通道（D-004）。
3. 前端「知识图谱」子页签：三栏布局直译原型，查询驱动切片 + 力场（仅切片），默认 orphans 治理切片，锚点自动补全，节点深链知识库（D-002/D-003/D-006）。
4. 总览以**全图 lite**形态可见（D-008@v2）：summary 分布 + 簇代表节点（度数 top-5）+ 簇计数徽标，流量几十 KB；经 sillyspec 仓前置 `graph summary`（含 clusters）提供；平台侧能力探测降级，两段独立交付（D-005）。

## 非目标

- **在线全图力导向**：无条件排除——力场斥力 O(n²)，4628 节点每帧约 2100 万对计算，浏览器不可行；原型全图模式本就是 `PHYS=false` 预计算聚类坐标的静态渲染（prototype-knowledge-graph.html:321-323），并非力导向。
- **全图全量下发**（1.5MB 且随知识库增长只增不减）仍排除；全图视觉总览按用户裁决以 **lite 形态**（簇代表+计数徽标，几十 KB）纳入本期（D-008@v2）；「全图静态总览（dump --layout 全量预计算坐标）」为已识别后续增量路径，本期不做。
- 图编辑/写操作（图谱只读派生，真相源是 md/yaml）。
- 不改 `HitsService.stats()` 主体与 hits 数据面（图卡是独立数据源的附加卡，D-004）。
- 不新增权限枚举/菜单卡（复用 knowledge:read/write，D-002）。
- 不做跨工作区图合并。
- sillyspec 仓的 summary/nodes 子命令实现（Phase 0）是该仓内另立变更，不属本变更文件面——本设计只锁依赖契约。

## 拆分判断

跨仓两段（D-005）：知识图引擎与解析真相在 CLI 仓，平台仓是消费端。Phase 0（CLI 增量）与 Phase 1-4（平台三端）可独立交付——平台侧对 summary/nodes 探测降级（method_not_found → 隐藏总览/补全），故不合并为单仓巨型变更，也不拆成多个平台变更（端点契约/RPC 消毒/前端页面三者互相咬合，拆开会产生半残中间态）。

## 总体方案

### Phase 0 — sillyspec 仓前置（另仓变更，只锁契约）

- `sillyspec knowledge graph summary [--clusters N] --json` → `{ok, stats:{nodes, edges, byType{}, byEdge{}, orphans, module_doc_gaps, changelog_danglings, dangling_refs, clusters:[{key, label, count, representatives:[{id,type,label}]}]}}`——**已交付**（sillyspec 仓 2026-10-08-graph-summary-nodes，提交 a2f725df）：四计数与 doctor 六检查同源；簇 key=(节点类型, 域)（域逐类型取值：fr/decision=attrs.domain、file=module-files 边反查、module=自身 id、doc=attrs.kind、entry=attrs.file、test=test-binding 反查、project/change/ql=id，缺省 `_unmapped`/`_tests`）；representatives=度数 top-5（度=全边入+出）；真图 883 簇——**daemon/平台侧调 summary 固定传 `--clusters 50`**（缺省全量）。
- `sillyspec knowledge graph nodes --search <模糊> [--limit N] --json` → `{ok, nodes:[{id,type,label}]}`（id/label 不区分大小写包含匹配，默认限 20）。
- 平台不依赖其发版节奏：能力探测降级（见兼容策略）。

### Phase 1 — backend（app/modules/knowledge/）

- 新文件 `graph.py`：`KnowledgeGraphService`，复刻 governance 先例——`RuntimeLiveService._resolve_binding`（runtime/service.py:129-150）绑定发现 → 懒导入 `get_daemon_ws_hub().send_rpc(daemon_id, "knowledge.graph", params, timeout=60)`（ws_hub.py:502-594）→ `resolve_root_path_for_daemon` 路径改写（workspace/service.py:82-110）。
- **无本地回退**（D-001）：不可用态统一翻译为信封 `available=false + reason`（**reason 六稳定键**，D-001@v2）：`unbound`（RuntimeNotBound→绑定引导）/ `offline`（DaemonRuntimeOffline→稍后再试）/ `timeout`（DaemonRpcTimeout 或 RemoteError.code=timeout→稍后再试）/ `upgrade_required`（code=method_unregistered 旧 daemon 或 cli_subcommand_missing 旧 CLI→升级提示）/ `invalid_input`（code=validation_rejected 消毒拒绝→输入错误）/ `rpc_error`（internal 及 DaemonRpcConflict 等兜底→服务异常）。HTTP 200 恒返回信封（前端按 available+reason 分支，不弹错）。
- **overview 组装语义**：overview 端点内部按序发 summary→orphans→dangling 三条 RPC，逐条独立容错——summary 失败（code=cli_feature_missing:summary）仅置 `summary=None`；orphans/dangling 单独失败时对应计数置 `None`（前端显示"—"，`orphans_count/dangling_count: int | None`），其余子块不受影响；全部失败时整信封按首错误 reason 降级。
- **清单截断**（实测依据：本仓 dangling 计 1807 条、CLI 输出 662KB 级）：orphans/dangling 的 items 由 daemon 解析后**裁剪 top-50 并保留 count 原值**再回传，避免 WS 大帧与前端千行清单；完整治理走 CLI/doctor。
- 三端点挂 `KNOWLEDGE_READ`，**注册序铁律**：字面量必须在 `GET /knowledge/{filename:path}` 通配之前（router.py:54-60 首注释先例）。

### Phase 2 — daemon（sillyhub-daemon/src/）

- `KnowledgeGovernanceHandler` 扩展 graph 方法（runtime-handler.ts:392-477 同款结构）：
  - 子命令白名单 `{summary, nodes, neighbors, path, impact, orphans, dangling}`；
  - **消毒面三参数共用**：anchor/anchor2/search 三个自由串过同一黑名单 sanitize（先例正则全集 `/["'` + 反引号 + `$;&|<>() %^` 与控制字符 \n\r\0]/`，即 ROOT_PATH_METACHAR_RE 超集），正常节点 id 字符集（`/ # : @ -`）零冲突放行（实测样本验证）；
  - **命令形态**：锚点是 CLI 位置参数（实测 usage `[锚点...]` 非 `--anchor` 旗标），拼串引号包裹：`sillyspec knowledge graph <sub> "<anchor>" ["<anchor2>"] --json`（引号本身在黑名单内，杜绝逃逸）；
  - `--edges` 值限定边型枚举 **∪ {all}**（实测 neighbors 缺省即 all）；`--depth` 钳 1–3；`--search` 限长 ≤200；`--limit` 钳 1–50；
  - 消毒/校验拒绝回 `RpcError('validation_rejected')`（D-001@v2，backend 译 invalid_input）；
  - `runSillyspecCmd`（runtime-handler.ts:79-110，shell:true 因 Windows .cmd shim）30s 超时；输出必须 `ok===true` 信封；**旧 CLI 探测细分**（D-001@v2）：daemon 未注册 handler→`method_unregistered`；CLI 输出含 `knowledge <`/`unknown_subcommand`（全无 graph）→`cli_subcommand_missing`；CLI 有 graph 但缺 summary/nodes→`cli_feature_missing:<sub>`；
  - orphans/dangling 结果解析后 items 裁剪 top-50（count 保留原值）；
  - root 双防线 `_guardRoot` 原样复用。
- `daemon.ts` 在 knowledge.digest/action 注册处（约 :7095-7112）追加 `ws.registerRpcHandler('knowledge.graph', ...)`。

### Phase 3 — frontend（frontend/src/）

- 新页 `app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx` 三栏（左：查询表单+预置+图例 / 中：画布 / 右：节点详情+查询结果 tab）；`workspace-tabs.tsx:8-28` TABS 数组「知识库」后追加 `{key:"knowledge-graph", label:"知识图谱", path:"/knowledge/graph"}`。
- 画布 `components/knowledge/graph-canvas.tsx`：canvas 2D 直译原型——velocity Verlet 力场（斥力<320 距离、边弹簧自然长按强弱档、阻尼 0.85、向心 0.004、速度夹 ±9、NaN 自愈）**仅切片 ≤200 节点启用；>200 节点降级为确定性静态布局**（同心圆分层：按节点类型分环、环内等角分布），mode-chip 标注「N 节点·静态布局」；拾取（半径+7 容差最近者胜）、hover 环、拖动钉位、滚轮缩放 0.3–3 光标锚点、空白拖拽平移、fitView 缩放夹 [0.08,2]；标签分级显示（缩放阈值/选中/hover）。力场与静态布局函数均导出纯函数供单测。
- **主题铁律**（D-003）：节点 10 类型色 = `themes[theme].color` 组合（brand 阶 + semantic + slate），组件级 CSS 变量注入 + `useThemeStore` 订阅（commit-graph.tsx:52-66 lanePalette 模式），禁硬编码 hex；边三档 = 实线/长虚(6,5)/点虚(2,4) + 粗细 1.6/1.1（形状区分主题无关）；卡片/边框/文字全主题 token。
- 交互：点节点 → 选中环 + 一跳邻域高亮 + dimOthers(alpha 0.06-0.1) + 右栏详情（attrs kv + 按边型分组出入邻居清单，行点击跳选）；查询后 hlSet + mode-chip + 右栏自动切结果 tab；orphans 命中红色警示环；entry 类节点 → 知识库深链 `?file=&anchor=`（page.tsx:274-279 深链惯例）；图例节点类型/边型点击过滤高亮。
- 默认视图（D-006）：首载可用态自动跑 orphans 查询；available=false 显示绑定引导卡。
- **总览 lite 数据面**（D-008@v2）：左栏数据面两模式胶囊「总览 lite / 查询切片」；**状态机钉死**：执行任何查询或点击代表节点 → 自动切「查询切片」模式（点代表节点=以该节点为锚点发起 neighbors 查询，复用查询链路）；胶囊手动切回 lite。lite 模式画布=簇气泡（视觉分组背景 + 计数徽标，hover 提示「本簇 N 节点，展示度数前 5」）+ 代表节点真实渲染（**确定性静态布局**：簇按 count 大小环形摆放、簇内代表等角分布——布局函数导出纯函数），代表节点按类型色；summary 不可用（旧 CLI，reason=upgrade_required 或 cli_feature_missing）时 lite 胶囊隐藏，默认 orphans 视图不受影响。lite 为原型未覆盖的新面（原型全图=预计算坐标静态渲染，见 R-04 如实声明）。
- 锚点自动补全：输入 debounce 300ms 调 `/graph/nodes`，datalist/下拉候选；**能力探测**：补全请求 404/不可用 → 静默禁用补全（不阻塞自由输入 + CLI 模糊解析兜底）。
- OpsDashboard 图维度卡（D-004）：指标网格加「图·孤儿」「图·悬空」卡（text-warning 主数值 + 点开清单，清单行点击 → 图谱页对应查询深链）；available=false → 卡位绑定引导。
- 数据链：`lib/knowledge.ts` 加图函数与生成类型导出；query key 进 `lib/query-keys.ts`；后端就绪后 `pnpm gen:types` 提交 `api-types.ts` + `backend/openapi.json`。

### Phase 4 — 测试

- backend：`tests/test_graph.py`——五查询 RPC mock（复用 test_governance.py:192-225 `_FakeHub` 范式）、六键 reason 全态、权限 403、路由序（字面量不被通配吞）、overview/nodes 端点（含 summary 子块独立降级与 items 截断）。
- daemon：handler 用例——白名单外子命令拒绝、**anchor/anchor2/search 三参数注入尝试**（元字符·控制字符）拒绝、正常节点 id（/#:@）放行、edges 枚举外拒绝（含 all 放行）、depth/limit 越界钳制、旧 CLI 三态探测（method_unregistered/cli_subcommand_missing/cli_feature_missing）、消毒拒绝回 validation_rejected、清单裁剪 top-50（全注入不发真子进程）。
- frontend：graph-canvas 几何/力场/静态布局**纯函数单测**（力场一步步进、拾取最近者、fitView 包围盒、>200 降级触发、lite 簇摆放）；page 三态（pending/available=false 六 reason/可用渲染）与 lite↔切片状态机；ops-dashboard 图卡三态与 `?? []` 防御；vitest + jsdom（canvas 交互不可测部分以纯函数导出覆盖，commit-graph 先例）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:backend/app/modules/knowledge/graph.py | KnowledgeGraphService：绑定发现→RPC 直采→信封构造；无本地回退 |
| 修改 | backend/app/modules/knowledge/schema.py | 图端点 DTO：GraphEnvelope{available,reason,source,data} + data 分型（五查询/overview/nodes） |
| 修改 | backend/app/modules/knowledge/router.py | 三读端点（graph/query、graph/overview、graph/nodes），注册在 {filename:path} 通配前 |
| 新增 | NEW:backend/app/modules/knowledge/tests/test_graph.py | RPC mock 五查询 + unavailable 降级 + 权限 + 路由序用例 |
| 修改 | sillyhub-daemon/src/runtime-handler.ts | KnowledgeGovernanceHandler 扩展 graph：白名单/黑名单消毒/枚举钳制/超时/旧 CLI 探测 |
| 修改 | sillyhub-daemon/src/daemon.ts | 注册 knowledge.graph RPC handler |
| 修改 | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | graph handler 用例（全注入） |
| 修改 | sillyhub-daemon/tests/runtime-handler.test.ts | 方法名集合钉子 6→7（knowledge.graph 注册的合法存量更新，execute 期实证） |
| 新增 | NEW:frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx | 图谱页三栏 + 默认 orphans 视图 + 绑定引导 |
| 新增 | NEW:frontend/src/components/knowledge/graph-canvas.tsx | 画布组件：力场（切片）/拾取/绘制/三主题 token；几何力场函数导出纯函数 |
| 新增 | NEW:frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | 纯函数单测 |
| 新增 | NEW:frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx | 页面三态/查询交互 mock 用例 |
| 修改 | frontend/src/lib/knowledge.ts | 图 API 函数 + 生成类型导出 |
| 修改 | frontend/src/lib/query-keys.ts | 图查询 key |
| 修改 | frontend/src/components/workspace-tabs.tsx | TABS 数组加「知识图谱」 |
| 修改 | frontend/src/components/knowledge/ops-dashboard.tsx | 图维度卡（孤儿/悬空+清单+绑定引导） |
| 修改 | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | 图卡三态用例 |
| 生成 | backend/openapi.json + frontend/src/lib/api-types.ts | `pnpm gen:types` 产物随变更提交 |

Phase 0（sillyspec 仓，非本清单）：src/knowledge-graph.js 扩 summary/nodes、CLI 路由与测试——由该仓另立变更交付。

## 接口定义

本变更接口面：3 端点 + 1 RPC 方法 + 0 数据库变更。

```
GET /api/workspaces/{workspace_id}/knowledge/graph/query
     ?sub=<summary|nodes|neighbors|path|impact|orphans|dangling>&anchor=<str>&anchor2=<str|可选:path终点>
     [&edges=<边型>][&depth=<1-3>]                      → GraphQueryOut
GET /api/workspaces/{workspace_id}/knowledge/graph/overview → GraphOverviewOut
GET /api/workspaces/{workspace_id}/knowledge/graph/nodes?search=<str>[&limit=<1-50>] → GraphNodesOut
（全部 KNOWLEDGE_READ；HTTP 200 恒返回信封，available=false 时 data=null）

GraphEnvelope<T>:  { available: bool, reason: str | None, source: "daemon-rpc", data: T | None }
                     # reason 六稳定键（D-001@v2）：unbound/offline/timeout/upgrade_required/invalid_input/rpc_error
GraphQueryOut.data（按 sub 分型，规范化自 CLI --json，派生规则见注）:
  neighbors: { anchor, nodes: [{id,type,label}], edges: [{s,t,type,strength}] }   # 节点 dir/edge_type 由前端从 edges 派生（s→t 定方向）
  path:      { from, to, found: bool, reason: str, hop_count: int, hops: [{s,t,type}] }  # hops 按 CLI 实测 {s,t,type}；reason=不可达文案（强边子集寻路，UI 需展示）
  impact:    { key, closure: [str], modules: [str], decisions_and_frs: [{id,type,status}], rejected_reachable: [{id,title,reason}] }  # 按 CLI 实测形状归一（execute 期实证）
  orphans:   { count, items: [{id,type,kind}] }      # items daemon 裁剪 top-50，count 保留原值
  dangling:  { count, items: [{id,type,kind,detail}] }  # 同上；四键映射=id 引用方节点/type 边型/kind 强度档/detail 缺失目标
GraphOverviewOut.data: { summary: {nodes,edges,byType{},byEdge{},
                                  orphans,module_doc_gaps,changelog_danglings,dangling_refs,
                                  clusters:[{key,label,count,representatives:[GraphNodeRef]}]} | None,  # code=cli_feature_missing:summary → None（daemon 调 summary 固定 --clusters 50）
                         orphans_count: int | None, dangling_count: int | None }  # 轻量：只回计数（子块失败→None），清单点开走 query 端点（top-50）
GraphNodesOut.data:    { nodes: [{id,type,label}] | None }           # 旧 CLI → None，前端禁用补全
GraphNodeRef: { id, type, label }
RPC knowledge.graph: { workspace_id, root（daemon 兼容双收 root/root_path）, sub, anchor?, anchor2?, edges?, depth?, search?, limit? }
                      回包 { graph: <CLI 完整信封 JSON> }；cli_feature_missing:<sub> 在 query 端点归 rpc_error 兜底、在 overview 由 summary 子块吸收为 None（不出信封）
                     → daemon 白名单+消毒（anchor/anchor2/search 同一 sanitize）后拼
                       `sillyspec knowledge graph <sub> "<anchor>" ["<anchor2>"] [--edges <型|all>] [--depth N] --json`
```

## 生命周期契约表

本变更不涉及生命周期契约面：无 session/lease/agent_run/daemon 状态转换/heartbeat——knowledge.graph RPC 是一次性请求-响应（daemon 内 `runSillyspecCmd` 子进程 30s 超时杀树，runtime-handler.ts 既有机制，不新增长驻资源）。

## 数据模型

无 schema 变更：图数据是 daemon 侧活仓库 `.sillyspec` 解析时内存派生（不落盘无缓存），平台侧不存储图数据（信封透传），无新表无迁移。

## 兼容策略（brownfield 必填）

- **旧 daemon**（无 knowledge.graph 方法）：RPC 回 code=method_unregistered → 信封 reason=`upgrade_required`（文案提示升级 daemon）。
- **旧 CLI**（无 graph 子命令，sillyspec < 3.32.1）：daemon 探测回 code=cli_subcommand_missing → 同 reason=`upgrade_required`（文案提示升级 sillyspec）。
- **CLI 缺 summary/nodes**（Phase 0 未交付/未升级）：daemon 回 code=cli_feature_missing:<sub> → graph/overview 的 summary=None（lite 胶囊隐藏）、graph/nodes 信封 unavailable——五查询与图卡计数主链路不受阻（D-005 独立交付保证）。
- **消毒拒绝**：daemon 回 code=validation_rejected → reason=`invalid_input`（用户输入错误提示，非升级文案）。
- **未绑定 daemon**：RuntimeNotBound → reason=`unbound` + 绑定引导（与治理卡 v2 未绑定 UX 一致）。
- 既有端点/表结构零改动：knowledge 模块现有六族端点与 hits 数据面不动（graph 端点纯增量）；前端知识库页主体不动（仅 ops-dashboard 加卡 + workspace-tabs 加一行）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 锚点/参数注入：runSillyspecCmd shell:true 拼命令，节点 id 含 `/#:@` 天然带元字符面 | P1 | anchor/anchor2/search 三自由串共用黑名单 sanitize（先例正则全集含 `" ' \` $ ; & \| < > ( ) % ^` 与控制字符，见 Phase 2）+ 子命令/边型枚举白名单 ∪{all} + depth/limit/search 钳制 + 引号包裹拼串；handler 用例全覆盖注入尝试（含引号逃逸） |
| R-02 | CLI 解析耗时与输出体量：五查询输出以小切片为主但 depth≤3 大闭包可超百节点；dangling 实测 1807 条/662KB | P2 | 本仓实测 orphans 1.79s（30s/60s 双层超时余量 >16 倍）；items daemon 裁剪 top-50 + count 保真；切片 >200 节点前端静态布局降级；实现期复测 WS 大帧传输 |
| R-03 | 跨仓两段依赖时序：Phase 0 未交付时平台半可用 | P2 | 能力探测降级（summary/nodes 缺失只隐藏对应 UI 面），主链路不依赖 Phase 0（D-005） |
| R-04 | 复用上游归档原型、未按项目 prototype 管线另做高保真原型；**原型覆盖面如实声明**：已实测验证的是三栏布局/五查询高亮/力场切片；总览 lite（簇气泡+代表静态布局）为原型未覆盖的新面，无实测 | P3 | 已验证面生产直译（三主题 token 化）；lite 布局与 >200 静态布局均导出纯函数 + Phase 4 专用用例兜底 |
| R-05 | gen:types 并行会话守卫中止（生成物未提交时） | P3 | 后端端点合入后第一时间单独跑 gen:types 并提交，再动前端消费面 |
| R-06 | 全图 lite 簇代表语义：度数 top-5 可能漏用户关心的低度数节点 | P3 | 簇计数徽标 hover 明示「展示度数前 5」；完整探索靠五查询切片兜底（D-008@v2 故障面）；summary 缺失（旧 CLI）时 lite 胶囊隐藏主链路不受阻 |
| R-07 | 无长驻进程/外部资源，生命周期面不适用（「死亡面」自检显式留痕） | — | 子进程随 runSillyspecCmd 超时杀树（既有机制），无新增后台任务/句柄/锁 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v2 | FR-01/FR-02/FR-04/FR-08；总体方案 Phase 1 六键信封/Phase 2 细分探测/接口定义/兼容策略；R-02 | 已覆盖（v1 被 supersedes——其 RPC 直采无回退主旨不变，reason 契约细化） |
| D-002@v1 | FR-05；总体方案 Phase 3；文件清单 workspace-tabs/page.tsx | 已覆盖 |
| D-003@v1 | FR-05/FR-06；总体方案 Phase 3 画布；graph-canvas.tsx | 已覆盖 |
| D-004@v1 | FR-07；总体方案 Phase 3 图卡；ops-dashboard.tsx | 已覆盖 |
| D-005@v1 | FR-02/FR-03/FR-08；拆分判断；Phase 0；兼容策略「CLI 缺 summary/nodes」条目 | 已覆盖 |
| D-006@v1 | FR-05；Phase 3 默认视图 | 已覆盖 |
| D-007@v1 | FR-01；接口定义信封+分型（含派生规则注） | 已覆盖 |
| D-008@v2 | FR-02/FR-05；非目标；Phase 0 clusters 契约（逐类型域定义+度数口径）；Phase 3 lite 数据面与状态机；接口定义；R-06 | 已覆盖（v1 被 supersedes） |

多裁定组合推演：D-001（无本地回退）×D-005（能力探测降级）×D-007（DTO 规范化）——无组合死锁面：三者共同落在「RPC 失败→信封 available=false」，降级粒度按端点独立（overview 内 summary 子探测不拖垮 orphans/dangling 子块），已在接口定义 GraphOverviewOut.summary|None 显式分离。无其余组合约束。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期豁免/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale——scale 留待 Step 8 评估落值）
- [x] 引用所有当前版本 D-xxx@vN（D-001@v2 + D-002~D-007@v1 + D-008@v2；被 supersedes 的 v1 留档不删）
- [x] 生命周期关键词命中但无状态转换——紧邻豁免声明已写
- [x] UI 原型分级核对：复用上游归档原型（sillyspec 仓 archive/2026-10-08-knowledge-graph/prototype-knowledge-graph.html），跳过原因记入 R-04
- [x] ⚠️ 自审存疑清零：D-008 已由用户裁决为全图 lite（v2），非目标/Phase 0/Phase 3/接口定义/R-06 已同步
