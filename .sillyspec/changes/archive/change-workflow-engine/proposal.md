---
author: hermes
created_at: "2026-05-31"
---

# 变更中心工作流引擎

## 动机

当前变更中心缺少结构化的工作流管控。变更创建后直接"启动执行"，没有需求澄清、设计审核、业务验收等环节。实际业务流程需要两个闭环：

1. **需求质量闭环**：业务提需求 → AI追问/头脑风暴 → 业务补充 → 人工审核 → 需求冻结
2. **交付质量闭环**：Agent开发 → 技术验证 → 业务验收 → 反馈分类 → 归档

当前 `current_stage` 只有简单的字符串（`created`, `executing`），没有状态机约束转换规则，也没有角色权限控制。Agent被允许在任何阶段启动，缺少边界。

## 范围

### 核心改造
1. **工作流状态机**：10阶段状态模型 + 合法转换规则
2. **Agent权限边界**：Agent只能操作 `ready_for_dev → technical_verification` 阶段
3. **业务验收反馈分类**：A(实现bug)/B(需求错误)/C(需求歧义)/D(新需求)
4. **归档门禁**：6项条件全部满足才允许归档

### 不在范围
- AI 头脑风暴/追问的对话式UI（后续迭代）
- 知识库人工筛选界面（后续迭代）
- Agent内部SillySpec编排逻辑（已有coordinator）

## 阶段模型

```
draft → clarifying → design_review → ready_for_dev → in_dev → technical_verification → business_review → accepted → archived
                                                                                      ↘ rework_required ↗
```

### 转换规则

| 从 | 到 | 触发者 | 条件 |
|---|---|---|---|
| draft | clarifying | 业务/系统 | 变更创建自动进入 |
| clarifying | design_review | AI | 无阻塞问题 |
| clarifying | draft | 业务 | 补充信息后重新提交 |
| design_review | ready_for_dev | 人工 | 审核通过 |
| design_review | clarifying | 人工 | 需回业务确认 |
| ready_for_dev | in_dev | Agent | Agent开始执行 |
| in_dev | technical_verification | Agent | 代码完成+测试通过 |
| technical_verification | business_review | 系统 | 技术验证通过 |
| business_review | accepted | 业务 | 验收通过 |
| business_review | rework_required | 业务 | 验收不通过+反馈分类 |
| rework_required | in_dev | Agent/系统 | A类bug→quick修复 |
| rework_required | design_review | 人工 | B类需求错误→改需求 |
| rework_required | clarifying | 人工 | C类歧义→回业务 |
| accepted | archived | 系统 | 归档门禁全部通过 |

### 归档门禁

1. 无未解决业务反馈
2. 所有验收标准(AC)已确认
3. 技术验证通过
4. 业务验收通过
5. 反馈已分类
6. 变更产物完整：proposal / design / tasks / verification / audit

## 成功标准

- 变更创建后自动进入 `clarifying` 阶段
- Agent 无法跳过 `design_review` 直接开发
- 业务验收反馈必须选择分类(A/B/C/D)
- 不满足归档门禁无法归档，返回具体原因
- 现有变更数据兼容（`status` 字段映射到新阶段）
