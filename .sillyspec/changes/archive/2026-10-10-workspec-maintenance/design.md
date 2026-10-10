---
author: qinyi
created_at: 2026-10-10 18:37:45
generated_by: sillyspec-design-init
scale: "large"  # 跨 backend/daemon/frontend 三端 + 新表迁移 + WS RPC 协议扩展，需 Wave 编排
---

# 设计文档（Design）— 2026-10-10-workspec-maintenance

## 背景

平台对 SillySpec 的集成以「镜像 + 队列 + 审批」为主：变更可浏览、单文件可编辑、进度可对账，
但**跨仓关联信息的配置维护能力为零**——工作区是严格单仓模型（`workspace.root_path` 部分唯一
约束，backend/app/modules/workspace/model.py:46-52），仓与仓之间（独立 spec 规范仓 ↔ 代码仓、
后端仓 ↔ 前端仓）没有任何关联配置入口。工具侧真正消费跨仓信息的位置有两处，平台均未触达：

1. `.sillyspec/projects/<name>.yaml` 子项目登记（scan 组件目录 / brainstorm 模块上下文 /
   workspace status 消费），由 `sillyspec workspace add` 维护；
2. 工作区 `local.yaml` 的 `repos:` 注册表（跨仓任务卡 `repo:` key 校验 / plan-postcheck /
   MultiRepoContext / scope-audit 上报消费），由 `sillyspec local register-repo` 维护。

用户定调（D-008）：平台若只做自己的登记、不落盘到这两个工具消费点，这功能没有意义；
且 sillyspec 现有命令能力已足够（查证：`workspaceAdd` 路径仅校验存在性、允许 `../` 跨目录树
相对路径，sillyspec/src/workspace.js:38-70；`register-repo` 命令现成，sillyspec/src/index.js:4972-5008）。

## 设计目标

- 平台成为跨仓关联配置的**权威源与维护入口**：工作区详情新增「关联仓」卡片，管理员维护
  共享信息（名称 / 仓库地址 / 描述 / 约定相对路径），各成员维护自己机器上的本地路径。
- **daemon 双落盘**：成员机器的 daemon 用工具现有命令把配置写到两个消费点——
  `sillyspec workspace add` → `.sillyspec/projects/<name>.yaml`（进 git 团队共享）；
  `sillyspec local register-repo` → `local.yaml` 的 `repos:` 段（gitignored 每机器私有）。
- **落盘状态回环**：落盘成功/失败/降级（工具版本不够、路径不存在）回报平台，卡片可见。
- 成员级路径适配多机（D-007）：同一关联仓在不同成员电脑上的位置各自配置。

## 非目标

- **不做** agent 会话上下文注入（AGENTS.md / 前导渲染）——D-002@v2 降级为 v2 候选；
  落盘后 CLI 自身的模块上下文与跨仓对账机制已覆盖主要场景。
- **不做** 仓库侧 yaml 的反向同步（落盘产物被手工改动后的对账/纠偏视图，v2 候选）。
- **不做** 删除关联仓时联动清理落盘产物（不 spawn `workspace remove`/不手删 yaml 与 repos: 键；
  平台侧条目与状态级联清理，产物残留为已知取舍，v2 候选联动 remove）。
- **不做** 变更级跨仓影响标记、scope-audit 主动化、多仓变更/文档聚合视图（v2 候选）。
- **不改** sillyspec 工具本身（零工具侧改动，只调用现有命令）。
- **不做** 关联仓的 clone/预取/健康巡检（local.yaml repos: 只要求路径存在且是 git 仓）。

## 拆分判断

三端（backend + sillyhub-daemon + frontend）加新表迁移与 WS RPC 协议扩展，天然按端拆波次
（backend 数据与 API → daemon 落盘链路 → frontend 卡片），非批量形态；不适用 quick/flow 收编。

## 总体方案

```
[frontend 关联仓卡片]
   │ REST CRUD（共享字段 owner/admin；my-path 成员本人）
   ▼
[backend] workspace_linked_repos（共享登记） + workspace_linked_repo_paths（成员级路径）
   │ ① 配置变更 → best-effort 推送给在线 daemon（WS）
   │ ② UI「立即同步」→ 请求-响应 RPC（对齐 sillyspec-conflicts compare 先例）
   ▼
[daemon]（成员机器，cwd=该成员本机 workspace root_path）
   ├─ spawn sillyspec workspace add <name> <约定相对路径> --repo <url>
   │     → .sillyspec/projects/<name>.yaml（幂等：已有字段保留不覆盖）
   └─ spawn sillyspec local register-repo <key> <成员本机绝对路径>
         → local.yaml repos: 段（外科写入，其余内容保留）
   │ REST 回报（每仓×每层：ok / skipped(能力不足) / failed(原因)）
   ▼
[backend 落盘状态存储] → GET 状态 → [卡片状态列]
```

分层要点：

1. **共享层与机器层分离**（D-007）：`projects/*.yaml` 进 git，路径必然是团队约定的相对路径
   （如 `../platform-specs`）——由管理员登记；`local.yaml repos:` 每机器私有，用成员各自
   配置的绝对路径。两层独立落盘、独立成败：相对路径在成员机器不满足布局时 workspace add
   层失败（仅提示，不阻塞 repos: 层）。
2. **落盘一律经 CLI 命令**（工具规则：yaml 读写不手拼）：daemon spawn `sillyspec workspace add`
   / `sillyspec local register-repo`，复用 sillyspec-manager.ts 的 execFile 数组形参 spawn 基建。
   v1 不传 `--role`（数据模型无该字段）；`workspace add` 传 `--repo <url>`（repo_url 已登记时），
   产物字段集 = name/path/status（+repo 当 repo_url 传入时），与 proposal 成功标准口径一致。
3. **能力探测降级**（R-01）：daemon 心跳已有 sillyspec 版本探测（SillySpecManager），无
   `register-repo` 子命令的旧版本 → 该层 skipped + 状态回报「需升级」，不报错不重试。
4. **触发时机与双通道职责**：配置 CRUD 成功后向该工作区成员绑定的在线 daemon best-effort 推送同步指令；
   UI 提供「立即同步」按钮走请求-响应 RPC 现场跑并等待结果；两者共用同一 daemon 落盘例程。
   **落库唯一通道 = daemon REST 回报端点**（RPC 响应仅用于发起方即时反馈与 UI 提示，不写
   sync_states——避免双写分叉；best-effort 推送路径无 RPC 响应消费方，天然只经回报落库）。
   RPC 超时：base 30s + 每仓 15s，上限 180s（对齐 sillyspec_compare.py:10 显式定 timeout 先例，
   spawn N 仓×2 命令的耗时上界）。
5. **root_path 解析口径**（D-009@v1 修订）：RPC payload 中的工作区根以 backend
   下发值为唯一来源（经 resolve_root_path_for_daemon 容器→宿主改写先例）；
   缺失时 daemon 报参数错误（backend 正常路径恒下发，不做本地回退）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:backend/app/modules/workspace/linked_repos/model.py | `WorkspaceLinkedRepo` / `WorkspaceLinkedRepoPath` / `WorkspaceLinkedRepoSyncState` 表模型（三表） |
| 新增 | NEW:backend/app/modules/workspace/linked_repos/__init__.py | 子模块包标识（task-01 配套） |
| 新增 | NEW:backend/app/modules/workspace/linked_repos/tests/__init__.py | 测试包标识（task-01 配套） |
| 新增 | NEW:backend/app/modules/workspace/linked_repos/tests/conftest.py | selected-metadata 引擎 + SQLite FK pragma（级联用例依赖） |
| 新增 | NEW:backend/app/modules/workspace/linked_repos/schema.py | 请求/响应 Pydantic schema（producer：router；consumer：前端 api-types） |
| 新增 | NEW:backend/app/modules/workspace/linked_repos/service.py | CRUD + 权限 + 同步触发 + 状态落库 |
| 新增 | NEW:backend/app/modules/workspace/linked_repos/router.py | /workspaces/{id}/linked-repos 路由 |
| 新增 | NEW:backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | CRUD/权限/成员路径越权/状态用例 |
| 修改 | backend/app/main.py | import linked_repos router 并 sibling include（仿 members_router 先例 backend/app/main.py:867；勿在 workspace/router.py 嵌套挂载——main.py:864-868 注释警告带 `{workspace_id}` prefix 的嵌套 include 抛 `ValueError: Duplicated param name workspace_id`） |
| 新增 | NEW:backend/migrations/versions/20261010190000_create_workspace_linked_repos.py | 建三表（含唯一约束与级联） |
| 修改 | backend/app/modules/daemon/router/machines.py | 新增 POST …/linked-repos-sync 结果回报端点（daemon 回调） |
| 修改 | backend/app/modules/daemon/router/__init__.py | _ENDPOINT_ORDER 登记 report_linked_repos_sync_result（端点顺序不变量） |
| 新增 | NEW:backend/app/modules/daemon/linked_repos_sync.py | linked_repos.sync 请求-响应 RPC 编排（收敛为新文件，不改 sillyspec_compare.py——仅参照其 timeout 先例） |
| 新增 | NEW:sillyhub-daemon/src/linked-repos-sync.ts | spawn CLI 双落盘 + 结果归一（ok/skipped/failed）+ 回报 |
| 修改 | sillyhub-daemon/src/hub-client.ts | 加 postLinkedReposSyncResult 回报方法（REST 落库唯一通道的 daemon 侧腿，task-04 execute 修订） |
| 修改 | sillyhub-daemon/src/sillyspec-manager.ts | export resolveSillySpecBinDefault 一行（bin 解析单一源复用，task-04 execute 修订） |
| 修改 | sillyhub-daemon/src/protocol.ts | RpcRequest 新方法类型 `linked_repos_sync`（payload 含配置快照） |
| 修改 | sillyhub-daemon/src/daemon.ts | RPC handler 注册 + cwd 解析（成员本机 root_path） |
| 新增 | NEW:sillyhub-daemon/tests/linked-repos-sync.test.ts | 命令拼装/幂等/降级/失败归一用例 |
| 新增 | NEW:frontend/src/components/workspace/linked-repos-card.tsx | 关联仓卡片（列表/我的路径 Modal/状态列/立即同步） |
| 新增 | NEW:frontend/src/components/workspace/linked-repos-form.tsx | 共享字段表单 Modal（名称正则/编辑锁定/exclude_unset 提交） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/page.tsx | 挂载卡片 |
| 新增 | NEW:frontend/src/lib/linked-repos.ts | API 封装（list/create/update/remove/saveMyPath/syncNow） |
| 新增 | NEW:frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | 卡片渲染/Modal 交互/状态列/空态测试（对齐 proposal 变更范围） |
| 重新生成 | frontend/src/lib/api-types.ts | `pnpm gen:types`（CLAUDE.md 规则 21） |
| 重新生成 | backend/openapi.json | `pnpm gen:types` 同源产物，随 api-types.ts 一并提交（CLAUDE.md 规则 21） |

## 接口定义

- `GET /api/workspaces/{id}/linked-repos`（工作区成员可读）→ 裸数组 `[{ id, name, repo_url, description, rel_path, my_path, sync_status_summary }]`
  （D-009@v1：返回裸数组非 {items} 包装，与前端/生成类型自洽；`sync_status_summary`
  聚合口径：普通成员=当前用户绑定机器的最新逐层状态；owner（workspace 建者）/
  platform admin=全部机器逐层状态）
- `POST /api/workspaces/{id}/linked-repos`（owner/admin）body `{ name, repo_url?, description?, rel_path? }`
- `PATCH /api/workspaces/{id}/linked-repos/{rid}`（owner/admin）
- `DELETE /api/workspaces/{id}/linked-repos/{rid}`（owner/admin；级联删成员路径与状态行）
- `PUT /api/workspaces/{id}/linked-repos/{rid}/my-path`（成员本人）body `{ path: string | null }`（null=清除）
- `POST /api/workspaces/{id}/linked-repos/sync`（成员）→ 触发 RPC，200 受理即返（D-009@v1：非 202）；结果经回报端点落库后由 GET 轮询
- `POST /api/daemon/machines/{instance_id}/linked-repos-sync-result`（daemon 回调；路径参数名对齐 machines.py 既有 `{instance_id}` 风格）body `{ workspace_id, results: [{ repo_name, layer: projects_yaml|repos_registry, status: ok|skipped|failed, detail? }] }`——落盘状态落库唯一通道
- WS RPC：`linked_repos_sync`（backend→daemon，payload `{ workspace_id, root_path, repos: [{ name, rel_path?, repo_url?, abs_path? }] }`，响应含逐层结果）

表结构（数据模型节详述）：`workspace_linked_repos(id, workspace_id FK, name, repo_url?, description?, rel_path?, created_at/updated_at…)`，`(workspace_id, name)` 唯一；
`workspace_linked_repo_paths(id, linked_repo_id FK, user_id FK, root_path)`，`(linked_repo_id, user_id)` 唯一；
`workspace_linked_repo_sync_states(id, linked_repo_id FK, machine_id, layer, status, detail?, synced_at)`，`(linked_repo_id, machine_id, layer)` 唯一——落盘状态建简单表（Grill X-001 修正：FK 级联删除天然满足「删除后状态清理」，不挂内存/机器视图）。

## 生命周期契约表

本变更含 daemon/RPC/heartbeat 邻接关键词，矩阵如下：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| linked_repos CRUD 成功 | UI | backend | workspace_id, actor | 配置版本 +1，标记待同步 |
| 配置变更推送（best-effort） | backend WS | 在线 daemon | workspace_id, 配置快照 | daemon 排队执行落盘，无确认语义 |
| linked_repos_sync RPC | backend | daemon | workspace_id, root_path 解析, repos[] | 请求-响应：daemon 回逐层结果 |
| 落盘结果回报 | daemon | backend REST | instance_id, workspace_id, results[] | 状态存储更新 → UI 可见 |
| 心跳能力探测 | daemon | backend（既有） | sillyspec 版本（既有） | 无新键；版本不足时落盘层 skipped 的判定依据 |

无新增 lease/claim 语义；不改变既有心跳协议字段（additive）。

## 数据模型

见接口定义节两表。要点：

- 无 `relation_kind` 字段（D-006 用户否决类型枚举）。
- `rel_path`：约定相对路径（如 `../platform-specs`），可空——为空则该仓只落 repos: 层。
- `workspace_linked_repo_paths.root_path`：成员本机绝对路径（D-007），register-repo 的
  落盘入参；空/未配置时该成员的 repos: 层 skipped（detail=本机路径未配置）。
- 级联：删共享登记行 → 级联删成员路径行；落盘状态随之失效（下次同步覆盖）。
- 本项目未上线（CLAUDE.md 规则 11），无需历史数据回填。

## 兼容策略（brownfield 必填）

- 未配置任何关联仓的工作区：卡片显示空态，daemon 落盘例程零调用，一切行为与现状一致。
- 旧 daemon ↔ 新 backend：`linked_repos_sync` RPC 无 handler → RPC 报 unknown method，
  backend 状态显示「daemon 需升级」，CRUD 不受影响。
- 新 daemon ↔ 旧 backend：daemon 不主动发起，回报端点 404 时静默（对齐 spec-sync 降级惯例）。
- 工具版本不足：spawn 前探测 `sillyspec --version` / 子命令存在性，不足则 skipped 不报错。
- 不改变既有 API 与表结构；新增端点/表均为 additive。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 成员机器 sillyspec 版本无 register-repo/workspace add 能力 | P2 | 版本探测降级为 skipped + UI「需升级」提示，不阻塞其它层 |
| R-02 | 成员目录布局不满足约定相对路径（workspace add 路径不存在） | P2 | 该层 failed 仅提示；repos: 层用成员绝对路径独立落盘不受影响 |
| R-03 | 平台 DB 与落盘产物漂移（yaml 被手改/他机提交） | P2 | v1 不做反向对账（非目标）；状态列展示最近落盘时间，v2 候选对账视图 |
| R-04 | spawn CLI 失败（非 git 仓/权限/命令异常） | P1 | 失败归一 failed + detail 回报，UI 展示原因；立即同步可重试（CLI 幂等） |
| R-05 | 与活跃变更 2026-10-10-borrow-sandbox-workspace-context 并行期的文件冲突 | P2 | 该变更 context.py 触点本变更已避开（不注入会话）；daemon.ts/protocol.ts 触点 execute 前确认其已收口归档 |
| R-06 | Windows 路径分隔符/空格导致 spawn 参数错乱 | P1 | 沿用 sillyspec-manager.ts execFile 数组形参先例（不经 shell 拼接）；路径统一正斜杠化对齐工具口径 |
| R-07 | 同机并发写 local.yaml 竞态（daemon 落盘 spawn 与成员机器上正在跑的 sillyspec 进程同时外科写） | P2 | daemon 侧对 register-repo 落盘串行队列化（同机一次一条），失败自动重试一次；写盘原子性由 CLI 自身保证，竞态窗口收敛到进程级 |
| R-08 | daemon 重试叠加后单层最坏 2×60s，多仓多层可超 RPC 超时上限 180s（发起方 504） | P3 | 复审 r2 登记：daemon 完成后仍经 REST 回报落库，状态回环不破坏；504 仅发起方即时反馈损失，用户可再点同步查看状态（v1.1 可调超时公式吸收重试时长） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 背景（术语澄清=跨仓关联配置，非四件套编辑） | 已覆盖 |
| D-002@v2 | 非目标（会话注入移出本期）、设计目标（登记+落盘+回环） | 已覆盖 |
| D-003@v2 | 总体方案（平台登记层保留 + daemon 双落盘为核心） | 已覆盖 |
| D-004@v2 | 总体方案第 1 层（projects yaml 经 workspace add 复活为落盘层） | 已覆盖 |
| D-005@v2 | 总体方案第 2 层（local.yaml repos: 经 register-repo 复活为落盘层） | 已覆盖 |
| D-006@v1 | 数据模型（无 relation_kind 字段）、卡片表单 | 已覆盖 |
| D-007@v1 | 数据模型（成员级路径表）、接口（my-path 端点）、分层要点 1 | 已覆盖 |
| D-008@v1 | 背景与设计目标（落盘必须）、总体方案（双落盘+状态回环） | 已覆盖 |

无未解决决策；剩余风险见 R-01~R-07。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（D-001@v1/D-002@v2/D-003@v2~D-005@v2/D-006@v1/D-007@v1/D-008@v1）
- [x] 生命周期契约表已填（含 daemon/RPC/heartbeat 关键词）
- [x] UI 原型分级核对（前端有卡片/弹窗交互 → 已生成 prototype-workspace-linked-repos.html，含双主题与成员级路径交互）
- [x] 无「⚠️ 自审存疑」项
- 组合裁定推演：D-007（成员级路径）×D-008（双落盘）组合——成员未配路径时 repos: 层 skipped、
  projects 层仍可成功（相对路径存在时）；两裁定无互斥状态。D-006（无类型）×D-008（双落盘）
  无组合约束（落盘命令不需要类型参数）。未发现死锁格。
- Design Grill 交叉修正（Step 7）：X-001 状态存储由「内存/机器视图」改为简单表
  `workspace_linked_repo_sync_states`（FK 级联满足删除清理成功标准）；X-002 daemon 回报端点
  路径风格对齐 machines.py 既有先例（无改）；X-003 root_path 解析口径定为 backend 下发为准、
  daemon 本地解析兜底；X-004 去掉 workspace add 的 `--role` 传参（数据模型无对应字段）；
  X-005 删除不联动清理落盘产物（非目标显式声明，v2 候选）。
