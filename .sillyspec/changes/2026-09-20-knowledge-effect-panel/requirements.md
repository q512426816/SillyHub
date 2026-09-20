---
author: qinyi
created_at: 2026-09-20 13:14:36
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| workspace 成员（KNOWLEDGE_READ） | 查看运营指标/使用率榜/统一卡片流 |
| 知识管理员（KNOWLEDGE_WRITE） | 同上 + 死条目清单引导的人工清理 |
| daemon（平台注册实例） | hits 增量上报方（鉴权自带归属） |

## 功能需求

### FR-01: hits 多端汇聚上行
覆盖决策：D-003@v1, D-007@v1
Given 多用户各自机器的 daemon 对同一 workspace 产生本地 hits 文件
When daemon spec 同步流程触发
Then 豁免读取 `.runtime/knowledge-hits.jsonl` 按本地 offset 完整行断点增量上报（≤2000 行/批）；服务器按 (workspace_id, line_hash) 唯一约束幂等落库，行带 daemon_id 归属；重装/offset 丢失全量重报计数不变；上报失败不阻塞同步主流程

### FR-02: 运营指标仪表盘
覆盖决策：D-009@v1
Given workspace 已有 hits 数据
When 打开知识库页
Then 顶部四指标卡：知识覆盖率（被命中条目/全部条目+按周趋势迷你图）、死条目（90 天零命中，点击展开清单抽屉）、每任务命中密度（inject 按 change 去重任务数的均值）、新知识生效速度（近 30 天新增条目已被使用比例）；无数据显示「暂无使用数据」态

### FR-03: 使用率榜
覆盖决策：D-008@v3
Given 条目命中计数与条目存在期间任务总数（任务=inject 行 change_name 去重，含变更与 quick）
When 渲染使用率榜
Then 全量条目按每任务触发率降序滚动展示（主数值 % 格式：<10% 两位小数、≥10% 一位小数，D-008@v3），绝对次数作副信息，不截断条数

### FR-04: 全 zone 统一条目渲染器
覆盖决策：D-004@v2
Given 知识库任一文件（手册/decisions/fr/generated/INDEX）
When 用户点开
Then 默认卡片流按文件形态分发：手册=## 小节逐条正文卡（条目级 🔥 徽标）；决策/FR=结构化字段卡（ID/标题/状态徽标/字段行/理由摘要/取代链/依据决策跳决策库/全文→归档 requirements/最近确认 commit）；INDEX=分类段+路由行可点击导航；generated=单条目卡；rejected 置顶+防复潮横幅；superseded 折叠置灰；「原文」tab 切回 md 视图

### FR-05: fr 独立 zone
覆盖决策：D-005@v1
Given knowledge/fr/ 目录存在条目
When 知识库列表加载
Then fr 条目归「需求规则」组独立展示（决策库组后），zone 值 "fr" 透传

### FR-06: 使用徽标
Given 命中聚合计数
When 列表与卡片渲染
Then 文件行挂文件级 🔥 徽标；手册小节卡挂条目级徽标（锚点=文件#小节标题对齐）

## 非功能需求
- 兼容性：老 daemon 不上报零影响；新端点纯增量；回退=隐藏运营入口
- UI 中文 + AI-Native 主题
- 兼容 Windows/Linux/macOS
- 前端类型经 gen:types 生成提交

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | 全部 | 三件套范围 |
| D-002@v3 | FR-02/03/06 | 口径={inject, fr-inject} |
| D-003@v1 | FR-01 | daemon 豁免通道 |
| D-004@v2 | FR-04/06 | 统一渲染器三形态 |
| D-005@v1 | FR-05 | fr zone |
| D-006@v2 | 全部 | 方案 A |
| D-007@v1 | FR-01 | 多端汇聚 |
| D-008@v3 | FR-03 | 全量榜次/任务+%格式显示 |
| D-009@v1 | FR-02 | 四指标替代热力图 |
