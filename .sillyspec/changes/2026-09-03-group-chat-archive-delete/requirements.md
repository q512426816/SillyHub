---
author: qinyi
created_at: 2026-09-03 16:49:47
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 群主 | 建群用户（`AgentGroupChat.created_by`），可归档/取消归档/删除自己的群 |
| workspace admin | 工作区管理员，对群内一切群拥有与群主同等的归档/删除权 |
| 普通群成员 | 用户成员（非群主/admin），可读群/发消息，但不可归档/删除 |
| 平台审计 | 软删后的行/run/log 历史保留口径（属主 logs 端点审计只读） |

## 功能需求

### FR-01: 群归档
覆盖决策：D-01@v1

Given 群主或 workspace admin 打开会话门户，群行可见
When 点击群行 hover「归档」按钮并在确认 Modal 点「归档」
Then `agent_group_chats.archived_at = now()`，群从默认列表消失，toast 提示
「已归档『{title}』，可在筛选『已归档会话』中查看」，SSE status_changed 广播
（audience=全部用户成员），其它客户端列表秒级刷新

Given 已归档的群
When 重复调用归档
Then 无操作（幂等，行锁内早退），HTTP 204

Given 已解散（ended_at 非空）但未删除的群
When 群主归档
Then 正常归档（解散群可收纳——不占默认列表位）

### FR-02: 群取消归档
覆盖决策：D-01@v1

Given 已归档的群在「已归档会话」视图中可见（带「已归档」徽标）
When 群主/admin 点击群行 hover「取消归档」并确认
Then `archived_at = NULL`，群回到默认列表，toast 确认，SSE status_changed

Given 未归档的群
When 重复调用取消归档
Then 无操作（幂等），HTTP 204

### FR-03: 群删除（软删）
覆盖决策：D-01@v1

Given 活跃群（未解散）
When 群主/admin 点击群行 hover「删除」并在确认 Modal 点「删除」
Then 先复用 end 收口链（全部 agent 成员影子会话置 ended + 影子队列清理 +
群时间线会话置 ended + 群频道 session_ended 广播），随后**群行与群时间线
会话双置 deleted_at**，SSE deleted 广播，群从一切成员读路径消失（404），
toast 确认，若被删群是当前选中群则清选中态

Given 已解散的群
When 群主/admin 删除
Then 跳过收口直接双置 deleted_at（end_group 幂等早退）

Given 已删除的群
When 再次删除或归档/取消归档
Then 404（`_get_group` 软删过滤天然幂等边界）

Given 群软删后
When 成员访问群列表/详情/群 SSE/群 logs/影子日志解析
Then 全部 404 或从列表消失；属主经 logs 端点审计只读保留（会话侧同款现状）

### FR-04: 归档视图与列表过滤
覆盖决策：D-01@v1

Given 会话门户切到「已归档会话」筛选视图
When 群分区渲染
Then 拉取 `GET /group-chats?archived=true` 列表，群行带「已归档」徽标（muted
chip + 相对时间 title）+ 整行降调，分区头计数为已归档群数，「＋」新建按钮隐藏

Given 默认视图
When 拉取群列表
Then `GET /group-chats` 不传参 → 仅未归档群（HTTP 默认 False，防三无参消费点
泄漏）；`?archived=true` → 仅已归档；`?archived=null` → 422（FastAPI bool 解析
限制，None 全量态仅 service 层可达，design §4）

Given 已归档群在归档视图中被打开（归档≠解散，群仍可用）
When 群面板 presence 刷新
Then 在线绿点回退选中时快照（归档视图列表项自带 online_member_ids，SSE
invalidate 驱动列表重拉时刷新）；presence 30s 轮询不覆盖已归档群（已知降级
——FastAPI bool|null Query 无法显式传 null，与会话侧同款传输层限制，
design §6.2b execute 期实证修订）

### FR-05: 权限边界
覆盖决策：D-01@v1

Given 普通群成员（非群主非 admin）
When 调用归档/取消归档/删除端点
Then 403「只有群主或工作区管理员可以执行该操作。」

Given 非群成员
When 调用任一新端点
Then 404 不泄露群存在性

## 非功能需求

- 兼容性：存量群 `archived_at` NULL=未归档，零回填；会话侧既有行为零改动；
  移动端群分区零改动天然正确
- 可回退：迁移 downgrade 对称删列；软删可逆性=仅审计口径（不做恢复 UI）
- 可测试：三态过滤/幂等/权限/SSE/旁路封堵全部有测试锚点（见 design §9）
- Windows/Linux/macOS 兼容（无平台特定代码）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-01@v1 | FR-01~FR-05 | 方案 A 镜像会话（群级标志位 + 群主/admin 门 + 软删），B 按成员归档与 C 硬删否决 |
