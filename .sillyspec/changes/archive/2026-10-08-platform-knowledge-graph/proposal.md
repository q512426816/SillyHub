---
author: qinyi
created_at: 2026-10-08 17:05:00
---
# 提案书（Proposal）

## 动机

SillySpec 工具仓已交付知识图引擎（`sillyspec knowledge graph <neighbors|path|impact|orphans|dangling> --json`，10 节点类型/16 边型三档强度，变更 sillyspec/2026-10-08-knowledge-graph 已归档），其设计非目标第 27 行明确把平台侧三件留待本变更：**graph-search 端点、stats 图维度指标、前端可视化页**。当前平台知识模块六族端点无任何图能力，doctor 图完整性检查报出的真实发现（孤儿决策、模块文档缺口、changelog 悬空）在平台侧不可见、不可查。

## 关键问题

1. **图能力不可达**：图查询/影响面/孤儿悬空分析只在 CLI 本地可用，平台用户（Web UI）与平台服务（HTTP 消费方）无入口。
2. **图健康度不可见**：OpsDashboard 只有使用率面（覆盖率/死条目/密度/生效速度），无结构面（孤儿/悬空计数与清单）。
3. **锚点探索成本高**：知识条目间关系（决策↔FR↔模块↔变更）要靠人脑在文件树里串，无可视化一跳邻域/推理链。

## 变更范围

- **后端**：knowledge 模块新增三读端点（graph/query 五查询统一入口、graph/overview 图概览含 lite 簇代表、graph/nodes 锚点搜索），daemon RPC 直采 CLI 单源真相，信封 `{available, reason, source, data}` 规范化 DTO，无本地回退（D-001/D-007/D-008）。
- **daemon**：`knowledge.graph` RPC 方法——子命令白名单、锚点黑名单消毒、参数钳制、旧 CLI 探测（D-005，R-01 注入面）。
- **前端**：「知识图谱」子页签（workspace-tabs 注册，权限复用 knowledge:read/write，D-002）三栏页面直译归档原型：查询驱动切片 + canvas 力场（仅切片，三主题 token，D-003）+ 默认 orphans 治理切片（D-006）+ 总览 lite 数据面（簇代表+下钻，D-008@v2）+ 锚点自动补全；OpsDashboard 图维度指标卡（D-004）。
- **跨仓前置（外部依赖，非本变更文件面）**：sillyspec 仓另立变更交付 `graph summary`（含 clusters 簇代表）与 `graph nodes --search` 两个子命令；本变更以能力探测降级对接（D-005），两段独立交付。

## 不在范围内（显式清单）

- 在线全图力导向（O(n²) 不可行）与全图全量下发（1.5MB 只增不减）——lite 形态覆盖总览需求（D-008@v2）。
- 全图静态总览（dump --layout 全量预计算坐标）——已识别的后续增量路径。
- 图编辑/写操作（图谱是 md/yaml 真相源的只读派生）。
- `HitsService.stats()` 主体与 hits 数据面改动（图卡是独立数据源附加卡）。
- 新权限枚举/新菜单卡（复用 knowledge:read/write 与 knowledge 菜单卡）。
- 跨工作区图合并。

## 成功标准

- 平台工作区「知识图谱」页签可查五视图（neighbors/path/impact/orphans/dangling），结果与 CLI `--json` 同源同义；未绑定/离线/旧 CLI 时页面按六键 reason 显示对应引导而非报错白屏。
- OpsDashboard 出现「图·孤儿」「图·悬空」指标卡，点开清单（top-50 + 真实 count）且可跳转图谱页。
- 绑定 daemon 的真实环境下，orphans 默认视图 3 秒级出图，力场切片流畅（≥30fps 观感），三主题换肤即时生效无硬编码色。
- daemon 消毒层拦下全部注入尝试（含引号逃逸），正常节点 id（含 /#:@）全放行——handler 用例与端到端实测双证。
- daemon/后端/前端三端相关测试全绿；既有 knowledge 六族端点与 stats() 行为零回归。

