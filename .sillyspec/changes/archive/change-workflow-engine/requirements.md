---
author: hermes
created_at: "2026-05-31T15:30:00"
---

# 变更工作流引擎 - 需求文档

## 角色定义

| 角色 | 职责 |
|------|------|
| 业务人员 | 创建变更、提供需求、执行业务验收 |
| 审核人员 | 审核设计、批准进入 ready_for_dev |
| Agent (AI) | 仅在 ready_for_dev→technical_verification 阶段执行开发 |
| 系统 | 自动阶段转换、执行门禁检查 |

## 功能需求

### FR-01: 创建变更自动进入 clarifying 阶段

- **Given** 业务人员创建一条新变更记录
- **When** 系统保存该变更
- **Then** 变更阶段自动设为 `draft`，随后立即转换为 `clarifying`

### FR-02: 状态机转换必须遵循合法转换规则

- **Given** 变更当前处于某阶段
- **When** 请求转换到目标阶段
- **Then** 系统依据 TRANSITIONS 表校验转换是否合法，非法转换予以拒绝

合法转换表 (TRANSITIONS):

```
draft → clarifying
clarifying → designing
designing → ready_for_dev
ready_for_dev → technical_verification
technical_verification → business_review
business_review → archived | clarifying (分类驳回)
archived → (终态)
```

### FR-03: Agent 仅在 ready_for_dev 阶段可启动执行

- **Given** 变更处于 `ready_for_dev` 以外的任意阶段
- **When** Agent 请求启动执行
- **Then** 系统返回 403 Forbidden

- **Given** 变更处于 `ready_for_dev` 阶段
- **When** Agent 请求启动执行
- **Then** 变更进入 `technical_verification` 阶段，Agent 开始工作

### FR-04: 业务验收必须选择反馈分类

- **Given** 变更处于 `business_review` 阶段
- **When** 业务人员提交验收反馈
- **Then** 必须选择以下分类之一：

| 分类 | 含义 | 后续动作 |
|------|------|----------|
| A | 完全通过 | → archived |
| B | 小问题，可发布后修复 | → archived（附待办） |
| C | 需修改后重新验证 | → clarifying |
| D | 严重问题，需重新设计 | → clarifying |

未选择分类时系统拒绝提交。

### FR-05: 归档必须通过 6 项门禁检查

- **Given** 变更请求进入 `archived` 阶段
- **When** 系统执行归档前置检查
- **Then** 以下 6 项必须全部通过：

1. 需求文档已填写
2. 设计文档已填写
3. 技术验证已通过
4. 业务验收已完成（分类为 A 或 B）
5. 无未关闭的关联问题
6. 变更描述非空

任一项不通过则拒绝归档并返回具体失败原因。

### FR-06: 旧数据兼容迁移

- **Given** 存在旧版 status 字段的数据
- **When** 系统加载该数据
- **Then** 按以下映射转换为 stage：

| 旧 status | 新 stage |
|-----------|----------|
| draft | draft |
| active | clarifying |
| archived | archived |

迁移后旧字段保留但不参与状态机逻辑。
