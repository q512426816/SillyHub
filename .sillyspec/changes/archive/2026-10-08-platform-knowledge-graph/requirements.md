---
author: qinyi
created_at: 2026-10-08 17:05:00
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 经 Web UI「知识图谱」页签查询/浏览知识图，经 OpsDashboard 看图健康度 |
| 绑定 daemon | 持有活仓库 `.sillyspec`，执行 `sillyspec knowledge graph` CLI 图引擎（单源真相） |
| sillyspec CLI ≥3.32.1 | 图引擎本体（五查询）；summary/nodes 子命令为跨仓前置增量 |

## 功能需求

### FR-01: 图查询五视图端点
覆盖决策：D-001@v2, D-007@v1
Given 用户已绑定 daemon 且 daemon 可达
When `GET /api/workspaces/{ws}/knowledge/graph/query?sub=<neighbors|path|impact|orphans|dangling>&anchor=...[&anchor2=][&edges=][&depth=]`
Then 返回 HTTP 200 信封 `{available: true, source: "daemon-rpc", data: <按 sub 分型的规范化 DTO>}`，语义与 CLI `--json` 同源同义（neighbors 一跳邻域、path 强边最短路推理链、impact 强边闭包深度≤2、orphans 零度+无路由、dangling 悬空引用）；权限 KNOWLEDGE_READ；MUST NOT 落任何本地计算图路径

#### 场景：不可用态六键 reason（D-001@v2）
Given 未绑定/离线/超时/旧 CLI·旧 daemon/消毒拒绝/服务异常任一态
When 同端点调用
Then 仍 HTTP 200，`available=false` 且 `reason` 为六稳定键之一（`unbound`→绑定引导 / `offline`·`timeout`→稍后再试 / `upgrade_required`→升级 daemon·sillyspec 提示 / `invalid_input`→输入错误提示 / `rpc_error`→服务异常），`data=null`，前端按 reason 键渲染对应文案

### FR-02: 图概览端点（轻量，含 lite 簇代表）
覆盖决策：D-004@v1, D-008@v2, D-005@v1, D-001@v2
Given 同 FR-01 可用态
When `GET /api/workspaces/{ws}/knowledge/graph/overview`
Then 返回 `data.summary={nodes,edges,byType,byEdge,orphans,module_doc_gaps,changelog_danglings,dangling_refs,clusters:[{key,label,count,representatives(度数top-5)}]} | None`（summary 子命令已交付——sillyspec 仓 2026-10-08-graph-summary-nodes；daemon 调用固定 `--clusters 50`，真图 883 簇）+ `data.orphans_count` + `data.dangling_count`（**轻量：不内联清单 items**——清单由前端点开时经 FR-01 query 端点获取，items daemon 裁剪 top-50 且 count 保真）；daemon 回 code=cli_feature_missing:summary 时 summary=None 而 orphans_count/dangling_count MUST 仍可用

### FR-03: 锚点搜索端点
覆盖决策：D-005@v1
Given 同 FR-01 可用态且 CLI 已含 nodes 子命令
When `GET /api/workspaces/{ws}/knowledge/graph/nodes?search=<模糊>&limit=<1-50>`
Then 返回 `data.nodes=[{id,type,label}]`（id/label 不区分大小写包含匹配，默认限 20）；旧 CLI 无该子命令时 MUST 返回 available=false 且不阻塞其他端点

### FR-04: daemon RPC 白名单与消毒
覆盖决策：D-001@v2, D-005@v1
Given daemon 收到 `knowledge.graph` RPC
Then 子命令 MUST 在白名单 {summary,nodes,neighbors,path,impact,orphans,dangling}；**anchor/anchor2/search 三个自由串参数 MUST 过同一黑名单 sanitize**（shell 元字符与控制字符全集，正常节点 id 含 / # : @ 全放行）；锚点按 CLI 位置参数形态引号包裹拼串；edges MUST 限定边型枚举 ∪ {all}；depth 钳 1-3、limit 钳 1-50、search 限长 ≤200；root 双防线复用；CLI 执行 30s 超时；旧 CLI 探测 MUST 细分回码（method_unregistered=旧 daemon / cli_subcommand_missing=CLI 无 graph / cli_feature_missing:<sub>=缺该子命令）；消毒拒绝回 validation_rejected；orphans/dangling 的 items MUST 裁剪 top-50 且 count 保真

#### 场景：注入尝试
Given anchor/anchor2/search 任一含 `; rm -rf`、反引号、`$()`、`"`、换行或控制字符
When RPC 调用
Then sanitize 拒绝并回 validation_rejected（backend 译 reason=invalid_input），MUST NOT 到达 shell 拼接层

### FR-05: 知识图谱页签与页面
覆盖决策：D-002@v1, D-006@v1
Given workspace 顶部页签栏
When 渲染
Then 「知识库」后出现「知识图谱」页签（`/knowledge/graph`），权限复用 knowledge 菜单卡（knowledge:read 可见）；页面三栏（左查询表单+预置+图例 / 中画布 / 右节点详情+查询结果）；首载可用态 MUST 自动执行 orphans 查询（红色警示环+右栏孤儿清单）；不可用态显示绑定引导卡

#### 场景：节点详情与深链
Given 画布中点击节点
Then 选中环+一跳邻域高亮+其余降暗（alpha 0.06-0.1），右栏显示 attrs 与按边型分组的出入邻居（行点击跳选）；entry 类节点提供知识库深链 `?file=&anchor=`

### FR-06: 画布力场与三主题
覆盖决策：D-003@v1
Given 查询结果切片 ≤200 节点
When 画布渲染
Then canvas 力场（velocity Verlet：斥力/边弹簧按强弱档/阻尼/向心，直译原型参数）+ 拾取（半径+7 容差）+ hover 环 + 拖动钉位 + 滚轮缩放 0.3-3 + 平移 + fitView；节点 10 类型色 MUST 取 themes[theme] 并 CSS 变量注入（禁硬编码 hex），blue/ai-native/dark 三主题即时换肤；边三档实线/长虚/点虚+粗细；几何与力场计算函数 MUST 导出纯函数供单测；切片 >200 节点 MUST 降级为静态布局（不启力场）

### FR-07: OpsDashboard 图维度指标卡
覆盖决策：D-004@v1
Given 知识页 OpsDashboard
When overview 可用
Then 指标网格新增「图·孤儿」「图·悬空」卡（text-warning 主数值+点开清单，清单行点击跳图谱页对应查询）；available=false 时卡位显示绑定引导；字段读取 `?? []` 防御；既有四指标卡与 stats() 行为零改动

### FR-08: 能力探测降级（跨仓两段独立交付）
覆盖决策：D-005@v1, D-008@v2, D-001@v2
Given Phase 0（sillyspec 仓 summary/nodes）未交付或 CLI 未升级
When 平台侧调用 overview/nodes
Then daemon 回 cli_feature_missing:<sub> → summary=None / nodes 信封 unavailable，前端隐藏 lite 总览胶囊并静默禁用锚点补全；五查询、图卡 orphans_count/dangling_count、默认 orphans 视图 MUST 不受任何影响

## 非功能需求

### NFR-01 性能
RPC 平台侧 60s / daemon 侧 30s 双层超时；lite 总览载荷（summary+clusters+代表）≤100KB 量级；力场仅切片启用（≤200 节点）。

### NFR-02 安全
锚点黑名单消毒 + 枚举白名单 + 数值钳制（FR-04）；全部端点 KNOWLEDGE_READ；无 DB 写面。

### NFR-03 主题与文案
三主题 token 合规（FR-06）；全中文文案；等价 CLI 提示条与 CLI 命令面同源。

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-06: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-07: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-08: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
