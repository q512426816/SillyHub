---
author: qinyi
created_at: 2026-09-24 16:16:00
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| CLI watcher（推送方） | sillyspec CLI 观测旁路，向 POST /changes/{name}/events 批量上行事件（仓外组件，本变更不改其行为） |
| 平台用户 | 变更详情页访客，只读消费观测事件与告警条 |
| 管理员 | 平台设置管理端点操作者，控制 observation-events-v3 开关 |
| 开发者 | 本变更的实现与验收执行者 |

## 功能需求

### FR-01: 写入端点批量上限与鉴权（v3）
覆盖决策：D-006@v1
承接: FR-lib-changes-016
#### 场景：开态批量接收
Given 平台设置 `observation-events-v3.enabled=true`
When POST `/changes/{name}/events` 携带 1..500 条事件、shpsync_ token 鉴权
Then 服务 MUST 接收（≤500 全部进入去重/落库流程），且 MUST NOT 从请求体读取 workspace 字段（workspace_id 必须仅从 shpsync_ token 派生）
#### 场景：关态批量拒收语义不变
Given 开关缺省（未配置/false）
When POST 携带 201..500 条事件
Then 服务 MUST 以 422 拒收（v2 批量上限 200 拒绝语义不变；错误 body 结构差异见 design R-03）
#### 场景：批超 500
When POST 携带 >500 条事件（任意开关态）
Then 服务 MUST 以 422 拒收（schema 静态 max_items=500）

### FR-02: 幂等去重（规范化 ts + 去重键复合）
覆盖决策：D-006@v1
承接: FR-lib-changes-017
#### 场景：重推跳过
Given 同一事件（`dedup_key = id or "{int(ts)毫秒}|{kind}|{stage or ''}"`，规范化 ts 为 int 毫秒）已落库
When watcher 重推该事件（任意开关态）
Then 服务 MUST 跳过不覆盖（计 deduplicated），并发撞键时 MUST 经 IntegrityError 一轮重试收敛而非整批 500（v2 骨架保留）

### FR-03: 窗口 5000 接收序剪枝（并发超删容忍）
覆盖决策：D-003@v1
承接: FR-lib-changes-018
#### 场景：开态超限剪枝
Given 开关开启且单 (workspace, change) 事件行数 >5000
When 批量插入提交（与本批同事务）
Then 服务 MUST 按 `(created_at, id)` 接收序删最旧修剪到 5000；并发批量下 MAY 出现少量超删（窗口瞬时 <5000），该取舍 MUST 在 design 风险登记如实记录（已记 R-02）
#### 场景：关态剪枝序不变
Given 开关关闭
Then 剪枝 MUST 维持 v2 `(ts, created_at, id)` 序

### FR-04: 读取端点 received_at 增量 + 缺省窗口 + detail 上限
覆盖决策：D-002@v1, D-004@v1, D-005@v1
承接: FR-lib-changes-019
#### 场景：since 基于 received_at
Given 开关开启
When GET `/changes/{name}/events?since=<ISO8601>`
Then 过滤 MUST 基于 `created_at > since`（服务端接收时间，received_at 语义）而非事件业务 ts——业务 ts 乱序晚到的事件 MUST NOT 被游标永久跳过；事件项 MUST 携带 `receivedAt` 字段（增量客户端取末条作下轮游标）
#### 场景：缺省最近 2000 条 + truncated
Given 开关开启且未传 since
When GET 未显式传 limit
Then 服务 MUST 返回最近 2000 条（`created_at DESC, id DESC` 取数后正序返回），响应 MUST 携带 `truncated = total > len(items)` 标记
#### 场景：detail 64KB
Given 开关开启
When 事件 detail 超长
Then 落库前 MUST 截断至 65536 个字符（64KB=65536 字符口径，UTF-8 下实际字节数≥字符数；执行层=service 落库截断）；spec 文本、design、实现三层对该口径与执行层 MUST 逐字对齐
#### 场景：关态读语义不变
Given 开关关闭
Then `since` MUST 维持 `ts > since`、limit 缺省 MUST 维持 500、detail 截断 MUST 维持 2000、响应 MUST NOT 携带 `truncated/v3/receivedAt` 字段（exclude_none 保证 JSON 与 v2 逐字节一致）

### FR-05: 前端 30s 全量重拉 + 告警条一次决策
覆盖决策：D-007@v1
承接: FR-lib-changes-020, FR-lib-changes-021
#### 场景：全量重拉
Given 变更详情页观测区挂载
When 30s 轮询触发
Then 前端 MUST 全量重拉列表（MUST NOT 实现增量游标）；开关开启时经探测式两段拉取升级为 limit=2000（首轮 200 探测响应 `v3:true` 后切换）
#### 场景：告警条自动展开一次
Given 开关开启且响应含 severity∈{warning, error} 事件
Then 告警条 MUST 渲染且新告警自动展开明细；每个告警（按事件 id）MUST 只自动决策一次——用户手动收起后，该告警在轮询重拉与页面刷新后 MUST NOT 再自动展开（sessionStorage 按告警 id 记忆）
#### 场景：关态前端零变化
Given 开关关闭
Then 前端 MUST NOT 渲染告警条与 truncated 提示，既有折叠卡渲染与 v2 一致

### FR-06: 功能开关与回退
覆盖决策：D-001@v1, D-008@v1, D-009@v1
#### 场景：未配置缺省关
Given 平台设置无 `observation-events-v3` 键（或值非 `{"enabled": true}`）
Then 全部端点 MUST 走 v2 路径（fail-closed），既有测试 `test_change_events.py` MUST 零改动全绿
#### 场景：回退
When 管理员 PUT `{"enabled": false}`
Then 开关 MUST 即时生效（每请求读 KV，MUST NOT 引入缓存延迟），v3 期间写入的行（含 64KB detail）在 v2 读路径 MUST 完全可读（零数据损失）；MUST NOT 依赖迁移回滚（detail 列保持 Text）

## 非功能需求
- 兼容性：未配置新功能时既有行为 MUST 不变（关态响应与 v2 逐字节一致；既有测试零改动全绿即验收）
- 可回退：回退=开关置关 MUST 零迁移零数据损失；迁移 down 仅限无 v3 数据的开发库（design R-06）
- 可测试：关态回归矩阵与开态行为矩阵 MUST 各自独立覆盖（design R-01 双锁）
- 性能：开关读取每请求一次主键 GET，SHOULD 保持无缓存（回退即时性优先；低频批量通道开销可忽略）
- 红线延续：平台 MUST NOT 基于 provisional 事件内容做流程判定（承接 FR-lib-changes-022，v3 不改动该红线）

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-06 | 原地演进落位形态（用户轮次1裁决） |
| D-002@v1 | FR-04 | since=received_at（created_at） |
| D-003@v1 | FR-03 | 接收序剪枝+超删容忍 |
| D-004@v1 | FR-04 | 缺省 2000+truncated |
| D-005@v1 | FR-04 | detail 64KB/65536 字符 service 层截断+Text 加宽 |
| D-006@v1 | FR-01, FR-02 | shpsync_ 鉴权+批上限+去重复合键 |
| D-007@v1 | FR-05 | 前端全量重拉+告警一次决策 |
| D-008@v1 | FR-06 | 开关 KV 缺省关+回退零迁移 |
| D-009@v1 | FR-06 | 方案 A 原地分支+同步剪枝（用户轮次2裁决） |
