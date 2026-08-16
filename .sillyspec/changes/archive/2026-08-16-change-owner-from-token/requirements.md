---
author: qinyi
created_at: 2026-08-16 07:52:00
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 变更责任人 | token 签发人，进度上行的真实身份 |
| 平台用户 | 在变更中心查看责任人/履历的开发者 |

## 功能需求

### FR-01: 上行时 owner 对齐 token 身份
覆盖决策：D-001@v1
Given 有效 shpsync_ token 上行某变更进度被接受
When ux_changes.owner_id 为 None（占位行/存量）
Then 更新为 token 用户，不产生事件

Given owner_id 不同于 token 用户
Then 同一 savepoint 内更新 owner_id 并写 owner_change 事件（detail 含 from/to 用户 ID），失败仅回滚 savepoint 不阻断上行

Given owner_id 等于 token 用户
Then 幂等跳过零写（现值判据，含 A→B→A 交替拦截）

### FR-02: 通用事件表
覆盖决策：D-002@v1
Given 任一 owner 变化
Then change_events 写入一行：event_type='owner_change'、detail JSONB={from_user_id,to_user_id}、created_by=新 owner、workspace 隔离
And 表结构通用（event_type+detail），后续事件类型零 schema 变更接入

### FR-03: 时间线合成事件条目
覆盖决策：D-003@v1
Given 变更存在 owner_change 事件
When 详情页读取
Then 事件转为时间线条目（kind='event'，name=责任人变更，output="A → B" 用户名，completed_at=事件时间），按时间序插入步骤序列，混合序列统一重编 ordering（key 唯一）
And 事件条目专属样式（前端 kind 区分），纯 steps 数据零变化

### FR-04: 用户名展示
Given 变更 owner_id 非空
Then 列表/详情显示 owner_name（display_name 优先 username fallback，批量一次 IN 查询禁 N+1）
Given owner_id 为空
Then 降级现状展示（—）

### FR-05: 履历明细不截断
覆盖决策：D-004@v1
Given 时间线条目 output 任意长度
Then 详情页全量展示（后端不截断明细、前端不 clamp 自然换行）
And 列表摘要 current_step_desc 截断保留（~200B/行性能契约）

## 非功能需求
- 兼容性：新字段全 optional；header X-SillySpec-User/last_pusher 零变化；kind 默认 'step' 旧组件不受影响。
- 可回退：事件表 append-only；回退=前端 kind 过滤。
- 可测试：幂等/首填/变化/失败容错/批量查询次数/长文本均有用例。

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | token 身份最新为准 |
| D-002@v1 | FR-02 | 独立通用事件表 |
| D-003@v1 | FR-03 | 时间线合成呈现 |
| D-004@v1 | FR-05 | 明细不截断（列表摘要保留） |
