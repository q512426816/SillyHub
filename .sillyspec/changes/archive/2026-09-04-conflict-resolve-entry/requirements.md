---
author: qinyi
created_at: 2026-09-04 22:06:01
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 机器所有者 | 绑定该 workspace 的 daemon 归属账号，最清楚机器现场，可执行裁决/清理 |
| 平台管理员 | is_platform_admin，兜底可操作所有机器的裁决/清理 |
| 普通成员 | 非上述两者，只读冲突/ghost 清单与计数 |
| daemon | 机器侧守护进程，接收 WS 指令、执行 sillyspec CLI、心跳回传结果 |
| backend | 平台服务，权限校验、指令下发、结果落库、机器视图透出 |

## 功能需求

### FR-01: 变更中心展示平台同步处理区
覆盖决策：D-002@v1
Given workspace 已绑定 daemon 且机器 sillyspec_status 含未决冲突（pending_conflicts）或 ghost 残留（ghost_count > 0）
When 用户打开变更中心页
Then 「解析警告」卡之后渲染「平台同步」卡片：冲突行（类型徽章 spec 树/进度、变更名、活跃警示徽章）与 ghost 区（计数+清单+清理按钮）按原型 prototype-conflict-resolve.html 呈现

Given workspace 未绑定 daemon 或 sillyspec_status 缺失
When 用户打开变更中心页
Then 卡片不渲染，页面与现状一致

### FR-02: 冲突一键裁决（保本地/取平台）
覆盖决策：D-001@v1, D-002@v1, D-003@v1
Given 用户具备操作权限（FR-04）且机器在线
When 点击冲突行的「保本地」或「取平台」并在确认弹窗中确认
Then backend 经 WS 下发 `daemon:sillyspec_resolve`（payload 含 change + strategy keep_local/take_platform），daemon 执行 `sillyspec platform resolve --change <名> --keep-local|--take-platform`，行按钮置「已下发 · 等待机器回报」

Given 冲突对应的变更是活跃变更（冲突名出现在 sillyspec_status.changes[]）
When 打开确认弹窗
Then 弹窗显示加重警示文案（另一会话可能正在推进），但不阻止执行（D-003：不硬禁）

Given 机器离线或 WS 下发失败
When 提交裁决
Then 端点返回 504，前端提示机器离线，按钮恢复可重试

### FR-03: ghost 一键清理
覆盖决策：D-002@v1
Given 用户具备操作权限（FR-04）且 ghost_count > 0
When 点击「一键清理 ghost」并在确认弹窗（如实写明波及范围：幽灵记录 + 超 7 天空壳目录）中确认
Then daemon 依次执行 `sillyspec doctor --cleanup-ghosts --confirm` 与 `sillyspec platform sync`（平台侧终态/墓碑收敛），结果经 FR-05 回显

Given ghost_count = 0
When 卡片渲染
Then 清理按钮禁用

### FR-04: 操作权限
覆盖决策：D-003@v1
Given 当前用户是机器所有者（machine.owner.user_id === user.id）或平台管理员
When 查看平台同步卡片
Then 可见并可用操作按钮

Given 当前用户非上述两者
When 查看平台同步卡片
Then 仅显示只读清单（无按钮）；直调 REST 端点返回 404（backend `_get_owned_instance` 越权与不存在同语义）

### FR-05: 执行结果心跳回显
覆盖决策：D-001@v1, D-004@v1
Given 指令已下发且 daemon 执行完毕
When 下一次心跳（默认 15s）到达
Then daemon 携带 `sillyspec_command_result`（action/change/strategy/state/exit_code/error/executed_at），backend 按**两态**语义落 `daemon_instances.sillyspec_command_result`（对象=整包直写、键不出现=置 NULL 清除；register 恒清），`GET /machines` 透出；前端按 action+change 匹配回显：成功 toast + 行随快照 ≤60-75s 消失，失败红字摘要 + 恢复按钮

Given 下发后 150s（执行上限 120s + 一个心跳周期）无匹配回报（如旧 daemon 静默忽略）
When 到达超时
Then 按钮恢复可重试，提示可能需升级 daemon

Given daemon 同一时刻已有 sillyspec 命令在执行（含 npm 升级）
When 新指令到达
Then 立即记 failed（error='another sillyspec command is running'）回显，不排队

## 非功能需求

- 兼容性：旧 daemon 对新 WS 消息 default 分支 warn 后忽略，无副作用；心跳新字段遵循两态语义（不出现=清除），与 sillyspec_status 现状一致；无绑定 workspace 行为不变
- 可回退：前端隐藏卡片即回现状；backend 端点无调用方；daemon case 无消息源；CLI 手工路径保留
- 可测试：三端均有先例测试模式可仿（backend 端点/心跳用例、daemon execFile mock 用例、前端组件用例）；WS payload 与心跳字段有 JSON 契约示例（design §7）
- 安全：change 名 backend 正则白名单 + 禁 `..`，daemon execFile 数组参数不经 shell，CLI assertSafeChangeName 三重防线（R-04）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02, FR-03, FR-05 | 通道=机器级即时 WS 指令（fire-and-forget + 心跳结果回传），不建队列表 |
| D-002@v1 | FR-01, FR-02, FR-03, FR-04 | 范围=冲突裁决 + ghost 清理一并；abort 不上页面 |
| D-003@v1 | FR-04 | 权限=机器所有者+平台管理员；活跃变更警示不硬禁 |
| D-004@v1 | FR-05 | 心跳结果字段两态清除语义 + register 恒清（Grill X-04 修订） |

全部当前版本决策（D-001@v1 ~ D-004@v1）均有 FR 覆盖，无剩余风险决策。
