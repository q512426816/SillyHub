---
author: qinyi
created_at: 2026-10-06 21:40:00
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在「我的供应商」维护模型列表并在会话中选模型 |
| 会话引擎 | claude/pi/codex 等，消费 provider_config 折算键（形态不变） |
| 附件门控 | 按生效模型的多模态标记判定会话附件能力 |

## 功能需求

### FR-01: 供应商模型列表
覆盖决策：D-001@v1, D-002@v1, D-005@v1
Given 供应商创建/编辑表单
When 用户添加多条模型条目（名称 + 多模态三态 + 可选角色标记 + one_m）
Then 行 models 列表存储条目数组（条数不限）；Claude 角色可多标；其它引擎不标角色

#### 场景：条目角色标记
Given 一条模型标了 sonnet 角色
When Claude 会话解析该供应商
Then ANTHROPIC_MODEL 与 ANTHROPIC_DEFAULT_SONNET_MODEL 指向该模型（one_m 按 [1m] 后缀语义）

### FR-02: 多模态下沉模型级
覆盖决策：D-003@v1
Given 附件门控判定
When 会话生效模型在供应商 models 列表内
Then 按条目 multimodal 三态判定（auto 走模型名启发式 / true / false）；列表未命中保守 false

### FR-03: 会话选模型
Given 会话配置条模型下拉
When 用户选择模型
Then 选项来自供应商 models 列表；选列表外模型 MUST 422（带可用模型提示）；主模型派生 = sonnet 首条 ?? 列表首条

### FR-04: 注入折算契约保持
覆盖决策：D-002@v1
Given claim/切换下发 provider_config
Then model 与 default_fallback_model 两键同值 = 会话所选 ?? 主模型；model_role_mappings 键形态与 daemon 消费面逐字一致（由条目 roles+one_m 折算）；新增 models 原始列表键；daemon 仓 MUST NOT 改动

### FR-05: 存量自动折算
覆盖决策：D-004@v1
Given 迁移执行
Then [model] + [default_fallback_model] + 4 槽值去重折算成列表（多模态标 auto、角色归并、one_m 透传、display 丢弃）；四旧列删除；downgrade 对称反折

## 非功能需求

- 兼容性：存量行为等价面（唯一变化=旧显式 multimodal 标记折算后 auto，D-004 接受）；API 无过渡期（规则 11）
- 可回退：迁移对称 downgrade（四旧列重建 + 反折）
- 可测试：迁移折算四形态/折算器归并规则/门控三态×命中/注入契约逐字断言

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-05 | 彻底重构删旧字段 |
| D-002@v1 | FR-01, FR-04 | 列表内标角色 + 契约保持 |
| D-003@v1 | FR-02 | 三态下沉 |
| D-004@v1 | FR-05 | 自动折算 |
| D-005@v1 | FR-01 | JSON 列 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
