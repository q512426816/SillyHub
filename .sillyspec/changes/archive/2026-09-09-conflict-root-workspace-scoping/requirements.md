---
author: qinyi
created_at: 2026-09-09 20:54:48
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户（工作区成员） | 在变更中心查看 sillyspec 冲突对比、下发裁决指令 |
| daemon（本机守护进程） | 维护 wsId→主仓根映射（claim 学习 + 落盘恢复），执行快照读取与 sillyspec CLI |
| backend（平台 API） | compare 端点编排 RPC、resolve 端点下发 WS 指令、权限校验 |

## 功能需求

### FR-01: 对比/裁决全链携带 workspace_id
覆盖决策：D-001@v1

Given 用户在变更中心打开某工作区的冲突对比/裁决
When 前端发起 compare（查询参数已有）或 resolve（请求体新增必填 workspace_id）
Then backend → daemon 的 RPC params / WS payload 均携带 `workspace_id`；
缺省（旧客户端）时 daemon 按 legacy 单槽位处理

### FR-02: daemon 按工作区映射取根，未命中不回退
覆盖决策：D-001@v1

Given daemon 内存映射 `_sillyspecStatusRoots` 中存在该 workspace_id
When 对比 RPC / 裁决指令带该 workspace_id 到达
Then 用映射中的主仓根执行（不受单槽位投毒影响）

Given 映射中不存在该 workspace_id（含 LRU 淘汰后）
When 对比 RPC / 裁决指令带该 workspace_id 到达
Then 对比抛 RpcError `workspace_root_unknown`（提示「该工作区尚未被本机会话
认领，请先在该工作区发起一次会话」）；裁决记 `state=failed` 同语义 error 且
**不 spawn** 进程；两者均**不得回退单槽位**

### FR-03: legacy 调用保留单槽位语义
Given 不带 workspace_id 的旧调用形态
When 对比 / 裁决到达 daemon
Then 沿用单槽位（`_statusCwd()`）读路径；单槽位为空时对比抛 `no_spec_root`
（现状不变）

### FR-04: 无 workspaceId 的 claim 不再覆盖单槽位（辅防）
Given claim 到达且 workspaceId 为 null/undefined、rootPath 任意（含 Temp）
When daemon 执行 `_noteSillySpecStatusRoot`
Then 单槽位值与落盘文件**均不变**；合法 UUID 的 claim 仍「映射+单槽位」双写
（洗白机制保留）；非 UUID 已有 warn+return 守卫不变

### FR-05: resolve 端点补 workspace 成员校验
Given 用户已通过机器归属校验（owner/admin）
When 对非本人成员的 workspace_id 下发裁决
Then 403 `PermissionDenied`（文案区分「查看」（compare）/「下发裁决」（resolve）
动作词）；成员判定复用 `ensure_workspace_member`（原 `_ensure_workspace_member`
公开 + 可选 action 参数）

### FR-06:（可选）502 网关文案按 daemon_code 分叉
Given 对比 RPC 因 daemon 业务错误返回 502
When daemon_code = workspace_root_unknown / conflict_record_missing
Then 用户可见文案分别为「该工作区尚未被本机认领…」/「冲突记录已失效，请刷新
列表」（替代「请稍后重试」）

## 非功能需求

- 兼容性：Windows/Linux/macOS 无新增平台面（纯参数透传 + Map 查询）；ESM import
  带 `.js` 后缀惯例；前端类型经 `pnpm gen:types` 生成不手写。
- 可回退：本 change 不承诺跨版本兼容（项目未上线）；新 backend + 旧 daemon /
  旧 backend + 新 daemon 的交错窗口靠「未知字段忽略 + 缺省 legacy」容错。
- 可测试：三端既有测试套件内新增断言（daemon vitest / backend pytest /
  frontend vitest），错误语义表（design §8）逐行可测。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 / FR-02 / FR-03 / FR-04 / FR-05 | 方案 A 全要素：全链强制 workspace_id + 映射查根 + 不回退 + 辅防封投毒 + 成员校验 |
