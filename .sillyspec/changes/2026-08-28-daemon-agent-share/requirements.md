---
author: qinyi
created_at: 2026-08-28 00:38:14
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| lender（共享人/开发人员） | 在工作区打开「共享我的守护进程」开关的成员 |
| 业务成员（business_member） | 工作区角色，持 `daemon:borrow` 权限，无自有 daemon 的主要受益者 |
| 工作区 owner | 查看/撤销工作区内共享的管理者 |
| 平台管理员（platform admin） | 配置平台共享智能体（档案+自己名下 runtime+源码工作区） |
| 普通用户（全体） | 含无 daemon 用户，可使用平台共享智能体开会话 |
| 守护进程 owner | daemon 的注册者，配置/信息修改的唯一授权人（+platform admin） |

## 功能需求

### FR-01: 共享守护进程页面可见
覆盖决策：D-001@v1, D-006@v1, D-013@v1

Given lender 在工作区 W 打开共享开关（grants 表存在 workspace 级行、enabled=true、daemon 在线）
And 用户 U 是 W 的成员且持 `daemon:borrow` 权限
When U 打开守护进程页面（/runtimes）
Then 「共享给我的」区块显示该机器（共享人显示名、来源工作区 W、在线状态、共享徽标）

Given 共享机器离线
When U 查看守护进程页面
Then 区块显示该机器但「会话」按钮禁用

Given U 不满足成员资格或权限任一条件
When U 拉取 machines/runtimes-page
Then 响应不含该机器的 shared_to_me 数据

### FR-02: 共享守护进程会话钉定可用
覆盖决策：D-001@v1, D-006@v1

Given FR-01 前提成立（授权 + 在线）
When U 以该机器的 runtime_id 创建交互式会话
Then 会话创建成功（AgentSession.user_id=U、runtime=lender 的 runtime、写借用审计行含 grant_id）

Given U 无授权（非成员/无权限/grant 停用/daemon 离线）
When U 以该 runtime_id 创建会话
Then 维持现有 404 语义不泄露存在性

Given lender 关闭共享开关（grant enabled=false）
When U 再以该 runtime_id 创建会话或查看页面
Then 会话 404 / 页面不再显示

### FR-03: 修改类操作保持 owner-only
覆盖决策：D-001@v1

Given U 通过共享获得会话使用权
When U 调用别名/可写目录/升级/禁用/移除/清理任一修改类端点
Then 后端维持现状 owner-or-platform-admin 校验（403/404），前端共享卡片不渲染这些入口

### FR-04: 平台共享智能体（管理员配置 + 全体可用 + 源码只读·指定目录可写）
覆盖决策：D-002@v2, D-003@v1, D-006@v1, D-007@v1, D-008@v1, D-012@v1

Given 用户是平台管理员
When 其创建共享智能体（agent_profile_id + pinned_runtime_id + source_workspace_id + writable_dir）
Then 校验通过：runtime 属管理员自己名下且在线、档案存在（非 platform 可见则按参数显式升级）、源码工作区存在、writable_dir ⊆ 管理员 runtime 的 allowed_roots；生成 grantee_type=platform 的 grant

Given 任意登录用户（含无 workspace/无 daemon 用户）
When 其以共享档案的 agent_profile_id 创建会话（不传 runtime_id/provider 亦可）
Then 服务端在二选一校验前检测到共享档案，强制 pinned_runtime + cwd=source_workspace.root_path + 写约束（allowed_roots_overlay=[writable_dir] 下推）；请求中的 runtime_id/workspace 参数被覆写，不可放宽

Given 共享会话中 agent 读源码工作区文件（Read/Glob/Grep）
Then 读取不受限（可基于源码回答平台功能问题）

Given 共享会话中 agent 写文件（生成文档/原型图等）
Then 写路径限制在 writable_dir 内（Write/Edit 走 daemon PolicyEngine fail-closed 强制）；writable_dir 外的写被拒绝

Given 共享会话中 agent 尝试使用 Bash / NotebookEdit 工具
Then 在工具白名单 gate 直接拒绝（D-009：allowed_tools 不含 Bash，防正则提取逃逸）

Given 管理员停用（enabled=false）或删除共享
When 用户再以该档案创建会话
Then 回到普通档案语义（不再强制钉定/写约束）

Given 用户直接以 platform grant 的 pinned_runtime_id 创建会话（不带共享档案）
When create_session（runtime_id 直传，非 owner 短路路径）
Then 404（D-012：共享智能体唯一入口=共享档案检测路径，绕过强制项的直接钉定封堵）

### FR-05: 共享机器/智能体进入会话选择器（用户显式选择）
覆盖决策：D-004@v2, D-007@v1

Given FR-01 前提成立（共享授权 + 在线）
When 用户在会话创建（门户/悬浮助手//runtimes 弹窗）打开机器选择器
Then 候选列表含共享机器（共享徽标 + 共享人标识），用户显式选择后创建会话（FR-02 放行）

Given 存在生效的平台共享智能体
When 用户打开档案选择器
Then 共享智能体可选（platform 可见性既有行为，带共享标识）；选中后 FR-04 强制项生效，会话头显示「平台共享」徽标

Given 用户未显式选择共享机器/智能体
When 悬浮助手解析默认机器
Then 默认解析行为与现状完全一致（不做任何自动回退到共享资源）

## 非功能需求

- 兼容性：grants 空表时全部现有行为逐字节不变（owner 会话/自动借用/修改端点/
  页面渲染）；agent-run 借用语义等价迁移（存量测试全量回归）。
- 可回退：`shared` 列双写保留 UI 缓存；授权判定单源 grants，无双轨歧义。
- 可测试：授权矩阵（owner/成员/非成员/无权限/停用/离线×workspace/platform）
  全覆盖单测；「请求参数被服务端覆写」「只传共享档案」为必测 case。
- 安全：platform 会话只读物制走 lease tool_config → daemon 白名单，双层防线；
  404 不泄露存在性语义保持。
- 平台兼容：迁移 DDL 兼容 PG16（NULLS NOT DISTINCT）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02, FR-03 | 沿用现有共享机制补缺口（用户重问轮追认） |
| D-002@v2 | FR-04 | 源码只读 + writable_dir 指定目录可写（supersedes v1，用户重问轮实答） |
| D-003@v1 | FR-04 | 共享 daemon 限管理员自己名下（用户重问轮追认） |
| D-004@v2 | FR-05 | 用户在会话选择器显式选择共享机器/智能体（supersedes v1，用户重问轮实答） |
| D-005@v1 | 全部 | 单变更不拆分（组织决策） |
| D-006@v1 | FR-01, FR-02, FR-04 | 方案 B 统一授权表（用户实选） |
| D-007@v1 | FR-04, FR-05 | 档案检测前置 + platform 不写借用审计 |
| D-008@v1 | FR-01, FR-04 | 唯一约束 NULLS NOT DISTINCT + 迁移跳过空 daemon_id |
| D-009@v1 | FR-04 | 共享会话 allowed_tools 不含 Bash（R-08 实证定案） |
| D-010@v1 | FR-04 | overlay 收紧作用域 task-05 实证（R-09） |
| D-012@v1 | FR-04 | platform grant 的 pinned runtime 直传钉定 404（验收审查 gap-2 封堵） |
| D-013@v1 | FR-01 | 共享机器可见性=成员资格+daemon:borrow 双条件（验收审查 gap-1 补过滤） |

当前生效版本决策（D-001@v1、D-002@v2、D-003@v1、D-004@v2、D-005~D-010@v1、D-012@v1、D-013@v1）均已覆盖；D-002@v1/D-004@v1 已 superseded 不再生效；D-011@v1（daemon 写守卫增量，spike-02 裁决）属实现层决策未单列 FR 映射。
