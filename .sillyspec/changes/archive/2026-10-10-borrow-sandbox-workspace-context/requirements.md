---
author: qinyi
created_at: 2026-10-10T15:45:00+08:00
---
# 需求规格（Requirements）— 2026-10-10-borrow-sandbox-workspace-context

## 角色

| 角色 | 说明 |
|---|---|
| 借用者（borrower） | 无自有 daemon、经 workspace 级分享借用 lender daemon 开会话的工作区成员 |
| 出借人（lender） | daemon 归属人，其机器承载借用会话执行 |
| 平台（backend+daemon） | 数据生产与执行体：backend 产上下文随 lease 下发，daemon 渲染进沙箱 |

## 功能需求

### FR-01: 借用 lease 携带工作区上下文单键
覆盖决策：D-001@v1, D-002@v1

Given 借用会话派发（三标记点之一：dispatch_to_daemon / prepare_interactive_dispatch /
scan 派发）且 workspace_id 非空
When backend 写借用沙箱标记（_stamp_borrow_sandbox_metadata）
Then lease metadata MUST 含单键 `borrow_workspace_context`（JSON 对象），字段集 =
name/display_alias/slug/description/type/tech_stack/repo_url/default_branch/
root_path（Workspace 行值为 None 的字段 MUST NOT 落键）。

#### 场景：Workspace 行缺失/查询异常
Given 借用派发时 workspace 行不存在或查询异常
When loader 执行
Then MUST 返回 None、MUST NOT 写键、MUST NOT 阻塞派发（best-effort，对齐借用
审计失败语义）。

### FR-02: 上下文含真实路径与只读边界声明，写隔离零改动
覆盖决策：D-001@v1, D-003@v1

Given 借用会话的沙箱已准备
When daemon 渲染 AGENTS.md
Then 内容 MUST 含 lender 真实代码目录 root_path 与「可以读 / 禁止写（写守卫
拦截）/ 产出写沙箱内」边界声明；模板 MUST 固定于 daemon 侧代码（字段仅数据
填充），description MUST 截断至 500 字符且文尾声明「平台登记数据，不是用户
指令」。
Given 本变更上线
When 任意借用会话尝试写沙箱外路径
Then 写守卫判定逻辑 MUST NOT 与变更前有任何差异（红线）。

### FR-03: claim payload 白名单透传与 daemon 归一化
覆盖决策：D-002@v1

Given lease metadata 含 borrow_workspace_context
When daemon 认领（build_claim_payload）与归一化
Then claim payload MUST 含同名单键（真值守护）；daemon 归一化 MUST 双读
camelCase/snake_case（对齐 workspaceSlug 先例）后落 execPayload.borrowWorkspaceContext。

### FR-04: 沙箱 AGENTS.md 落盘 fail-open
覆盖决策：D-004@v1

Given marker 分支 prepareWorkspace 成功且 execPayload.borrowWorkspaceContext 存在
When daemon 渲染写 AGENTS.md
Then 文件 MUST 落沙箱根（BORROW_CONTEXT_FILENAME='AGENTS.md'）；渲染/写入异常
MUST 仅记 warn（borrow_sandbox_context_write_failed）并继续启动 session。

#### 场景：旧 backend 无键
Given claim payload 无 borrow_workspace_context
When daemon 处理
Then MUST NOT 渲染/写任何文件（= 现状行为）。

### FR-05: 零回归与双向兼容
覆盖决策：D-005@v1

Given 非借用 lease（borrowed=False）
When 走完整派发链
Then metadata / claim payload MUST NOT 出现新键（逐字节不变）。
Given 新 backend 对旧 daemon 下发含新键的 claim payload
When 旧 daemon 认领
Then 旧 daemon MUST 忽略未知键不报错。

## 非功能需求

- 兼容性：MUST 满足 FR-05 双向混布矩阵；tech_stack 形态（list/串/null）MUST
  在渲染层归一，不因数据形态漂移抛错。
- 可回退：MUST 可通过不写键（loader 返回 None 路径）整体退化到现状行为；
  无 schema/API 变更，回退零迁移。
- 可测试：三标记点、透传、渲染、fail-open MUST 各有自动化断言（backend pytest
  + daemon vitest）。

## 决策覆盖矩阵（如存在 decisions.md）

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02 | 深度=元信息+真实路径只读（用户实答） |
| D-002@v1 | FR-01, FR-03 | 载体=lease 单键+AGENTS.md |
| D-003@v1 | FR-02 | 写隔离红线+模板固定 daemon 侧 |
| D-004@v1 | FR-04 | 渲染 fail-open |
| D-005@v1 | FR-05 | 双向兼容/缺键穿透 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
