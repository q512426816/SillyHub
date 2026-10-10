---
author: qinyi
created_at: 2026-10-10 17:09:03
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）— 2026-10-10-workspec-maintenance

## 角色
| 角色 | 说明 |
|---|---|
| 工作区管理员（owner/admin） | 维护关联仓共享信息（名称/仓库地址/描述/约定相对路径）、删除关联仓、触发同步 |
| 工作区成员 | 维护「我的本地路径」（仅本人的成员级路径行）、查看落盘状态、触发同步 |
| daemon（成员机器） | 执行双落盘（spawn sillyspec CLI）、回报逐层结果 |
| 平台 backend | 权威配置源、同步编排、落盘状态存储 |

## 功能需求

### FR-01: 关联仓共享登记（数据模型 + CRUD）
Given 一个已存在的工作区
When 管理员通过 `POST /api/workspaces/{id}/linked-repos` 提交 `{ name, repo_url?, description?, rel_path? }`
Then 平台落库 `workspace_linked_repos` 新行（`(workspace_id, name)` 唯一，重名 409），无 relation_kind 字段；
`GET` 返回列表（含当前用户的 my_path 与状态摘要），`PATCH/DELETE` 仅 owner/admin 可用，
删除级联清理成员路径行与落盘状态。

### FR-02: 成员级本地路径
Given 工作区已登记关联仓
When 成员调用 `PUT /api/workspaces/{id}/linked-repos/{rid}/my-path` 提交 `{ path }` 或 `{ path: null }`
Then 仅写入/清除该成员自己的 `workspace_linked_repo_paths` 行（`(linked_repo_id, user_id)` 唯一，upsert）；
成员不能读写他人路径行（越权 403）。

### FR-03: daemon 双落盘
Given 成员机器 daemon 在线且收到 `linked_repos_sync` RPC（payload 含 workspace、repos[] 配置快照与该成员 root_path）
When daemon 执行同步
Then 在成员本机工作区根依次 spawn：
`workspace add` 层——`sillyspec workspace add <name> <rel_path> --repo <url>`（rel_path 为空时该层 skipped）；
`register-repo` 层——`sillyspec local register-repo <name> <成员本机绝对路径>`（未配路径时 skipped）；
两层独立成败，命令经 execFile 数组形参（Windows 安全），产物由 CLI 写出（平台不拼 yaml）。

### FR-04: 落盘状态回环
Given daemon 完成或跳过/失败任一层
When daemon 调用 `POST /api/daemon/machines/{instance_id}/linked-repos-sync-result` 回报
Then backend 更新该 (workspace, machine, repo, layer) 状态（ok/skipped/failed + detail + 时间），
`GET linked-repos` 的状态摘要反映最新结果；工具版本不足时为 skipped(detail=需升级)，非错误。

### FR-05: 同步触发
Given 工作区有关联仓且用户为成员
When 用户在卡片点「立即同步」（`POST …/linked-repos/sync`）
Then backend 向该成员绑定 daemon 发请求-响应 RPC 并受理；配置 CRUD 成功后另向在线 daemon
best-effort 推送同步指令（无确认语义，不阻塞 CRUD 响应）。

### FR-06: 前端关联仓卡片
Given 用户打开工作区详情页
When 渲染「关联仓」卡片
Then 列表展示名称/仓库地址/描述/我的本地路径/逐层落盘状态；管理员可新增/编辑/删除（Modal 表单，
字段=名称必填+地址+描述+约定相对路径），成员可编辑我的本地路径（小 Modal，含「仅保存给我自己」
说明）；空态有引导文案；双主题（brand-* 语义阶）；`api-types.ts` 经 `pnpm gen:types` 再生成。

### FR-07: 降级与兼容
Given 老 daemon（无 RPC handler）或旧版 sillyspec CLI（无 register-repo 子命令）
When 触发同步
Then 分别得到「daemon 需升级」状态或该层 skipped；未配置关联仓的工作区行为与现状一致；
新旧混布（backend/daemon 两端版本错开）不劣化。

## 非功能需求
- 兼容性：Windows/Linux/macOS 三平台（spawn 数组形参、路径正斜杠化）；对既有心跳/lease 协议 additive。
- 安全：写接口权限校验（owner/admin/成员本人）；daemon 回报端点按机器身份认证（对齐既有 daemon 回调端点）。
- 幂等：重复同步不产生重复产物（workspace add 保留已有字段；register-repo 外科写入幂等）。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | 全部 | 需求本体=跨仓关联配置（非四件套编辑/非新建变更回归） |
| D-002@v2 | FR-03/04/05/06 | v1 范围=登记+落盘+回环；会话注入移非目标 |
| D-003@v2 | FR-01..FR-07 | 平台登记层 + daemon 双落盘总体路线 |
| D-004@v2 | FR-03 | projects/*.yaml 经 workspace add 复活为落盘层之一 |
| D-005@v2 | FR-03 | local.yaml repos: 经 register-repo 复活为落盘层之二 |
| D-006@v1 | FR-01/FR-06 | 无 relation_kind 字段；表单无类型选择 |
| D-007@v1 | FR-02/FR-03 | 成员级路径表与 upsert；register-repo 入参用成员路径 |
| D-008@v1 | FR-03/FR-04/FR-05 | 落盘到工具消费点为必须；工具零改动 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-06: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-07: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
