---
author: qinyi
created_at: 2026-10-06 14:25:00
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在「我的供应商」维护凭证并在会话/档案中选用供应商 |
| 会话引擎 | claude/codex/pi 等运行时，消费 provider_config 注入 |
| daemon | 按 provider_config.agent_kind 选注入器（契约不变方） |

## 功能需求

### FR-01: 供应商引擎集合多选
覆盖决策：D-001@v1, D-004@v1
Given 供应商创建/编辑表单
When 用户勾选多个引擎（≥1）保存
Then 行 agent_kinds 存为引擎数组，同一条凭证可服务集合内全部引擎的会话

#### 场景：多引擎命中
Given 一条供应商勾选 claude+pi
When 分别创建 Claude 会话与 Pi 会话（会话级或默认链解析）
Then 两个会话都命中该供应商，下发的 provider_config.agent_kind 分别为 claude 与 pi（daemon 注入器分发不变）

### FR-02: 存量迁移等价
覆盖决策：D-002@v1
Given 存量单值 agent_kind 行
When 迁移执行
Then 每行转为 [旧值] 单元素数组，未编辑供应商的全部解析/默认/校验行为与单值时代逐项等价；MUST NOT 合并或清理存量重复行

### FR-03: 默认全引擎生效与互斥
覆盖决策：D-003@v1, D-006@v1
Given 多引擎供应商设为默认
When 保存
Then 其勾选的每个引擎都视它为默认；设默认/扩张引擎集合时 MUST 清对应引擎的兄弟默认行（互斥粒度 (user_id, 引擎) 恒成立，MUST NOT 出现同引擎双默认）；收缩引擎致默认空缺时不自动转移

### FR-04: 组合禁配
覆盖决策：D-005@v1
Given 供应商 api_format=openai_chat
When 勾选集合含 pi
Then 后端 MUST 422 拒绝（LlmProviderKindFormatForbidden 语义沿用）；前端表单 MUST 前置禁用 pi 项并提示

### FR-05: 解析链集合化与契约保持
覆盖决策：D-005@v1
Given 任一解析路径（claim 注入 / 会话级绑定校验 / 附件能力门控 / MCP 配额池 / 热切换扇出）
When 按引擎解析供应商
When 热切换推送（notify_provider_switch）
Then 匹配语义为「引擎 ∈ agent_kinds」；下发/推送的 provider_config.agent_kind MUST 恒为该会话引擎值；session.provider 为 NULL 的活跃会话跳过扇出并告警（best-effort）；daemon 仓 MUST NOT 有任何改动

## 非功能需求

- 兼容性：未编辑存量行为逐项等价（迁移测试锁定值域不变性）；API 无过渡期（单仓同批收口，规则 11 授权）
- 可回退：迁移提供对称 downgrade（数组→取首元素）；无数据丢失路径
- 可测试：后端 llm_provider/daemon 解析/附件门控/配额池/热切换五域用例 + 前端表单/列表/过滤/mock 字段 + tsc 编译期门

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 多选立项 |
| D-002@v1 | FR-02 | 存量仅新数据生效 |
| D-003@v1 | FR-03 | 默认全引擎生效 |
| D-004@v1 | FR-01, FR-02 | 单列改数组 |
| D-005@v1 | FR-04, FR-05 | 解析包含 + agent_kind 盖会话引擎 + 组合校验 |
| D-006@v1 | FR-03, FR-05 | 扩张清兄弟默认 + 热切换按引擎扇出 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
