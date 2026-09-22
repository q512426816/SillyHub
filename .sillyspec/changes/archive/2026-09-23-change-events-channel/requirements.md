---
author: qinyi
created_at: 2026-09-22 20:11:04
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| sillyspec watcher（CLI 推送方） | detached 观测旁路进程，向平台批量 POST provisional 事件（Bearer shpsync_ token） |
| 面板查看者 | 浏览器用户（JWT/shk_live_），在变更详情页查看观测事件时间线 |
| 平台（本件交付物） | 事件消费端点 + 存储 + 面板展示，对事件零业务消费 |

## 功能需求

### FR-01: 批量接收事件
Given watcher 持有效 shpsync_ token
When POST `/api/changes/{name}/events` body `{events: [...]}`（每条 kind/ts 必填，ts 为 epoch 毫秒，stage/detail/rule/severity/id/provisional 可选，未知字段忽略）
Then 逐条落库 `platform_change_events`（provisional 恒存 True，workspace 由 token 派生），响应 200 `{accepted, deduplicated}`；批量 >200 条 422；无凭据 401，shk_live_/JWT 凭据有效也 403

### FR-02: 幂等去重
Given 同一 (workspace, change_name) 已存事件
When 重复推送同 dedup_key 事件（带 id 用 id；否则 ts|kind|stage 拼键）
Then 跳过不重复落库，计入 deduplicated 响应字段；重放推送响应幂等

### FR-03: 上限保护
Given 单变更事件数超过 5000
When 新事件插入
Then 同事务按 (ts, created_at) 删最旧修剪回 5000 条（截断而非拒绝），新事件不丢

### FR-04: 增量拉取
Given 面板查看者具备读权限（CHANGE_READ scope）
When GET `/api/changes/{name}/events?since=<iso8601>&limit=<int>`
Then 返回 `{items, total}` 按 ts 正序（ts ASC, id ASC 稳定排序），仅含 ts > since 的行；无事件 200 空列表；since 无效格式 422

### FR-05: 面板观测事件折叠区
Given 变更详情页打开
When 事件区挂载
Then 组件 GET 一次 + 30s 轮询刷新；缺省收起；有 severity=warning 事件时默认展开且标题角标显示 warning 计数；拉取失败静默隐藏不阻断详情主内容

### FR-06: 时间线展示
Given 事件列表非空
When 渲染
Then 时间线行展示时间/事件类型/规则/详情；severity=warning 行琥珀高亮；全部行带 provisional 徽标（悬停说明"旁路观测信号，非流程真相"）；空态显示"暂无观测事件"

### FR-07: 零业务消费（红线）
Given 平台侧收到任意 provisional 事件
When 全链路处理（存储/读取/展示）
Then 不触发通知、不写 progress、不影响审批门控、不做任何流程状态判定

## 非功能需求
- 兼容性：老版本 CLI（无 id/rule/severity 字段）推送照常接收；CLI watcher 对 404 本就静默降级，上线前后行为不变
- 测试：backend pytest 五组（收/取/去重/鉴权/上限）；frontend vitest 四组（渲染/告警高亮/空态/角标计数）
- 构建：后端 schema 变更联动 `pnpm gen:types` 再生成 api-types.ts + openapi.json 随提交（CLAUDE.md 规则 21）
- 跨平台：无 OS 相关逻辑（纯 HTTP + SQL）

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01/FR-04 | 端点落 platform_sync 模块（鉴权同款复用） |
| D-002@v1 | FR-02 | dedup_key 服务端生成 + 唯一约束，跳过不覆盖 |
| D-003@v1 | FR-01/FR-04 | ts 归一 DateTime，since ISO 严格大于比较 |
| D-004@v1 | FR-01/FR-07 | provisional 恒 True 落库；零业务消费红线 |
| D-005@v1 | FR-03 | 截断最旧非拒绝，5000 条/变更 |
| D-006@v1 | FR-05 | aside 自取数组件 + 30s 轮询 + 折叠行为 |
| D-007@v1 | FR-01/FR-06 | 宽松 schema（可选字段扩展面）+ severity 高亮 |
