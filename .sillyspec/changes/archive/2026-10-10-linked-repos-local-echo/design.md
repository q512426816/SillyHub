---
author: qinyi
created_at: 2026-10-10 23:02:30
generated_by: sillyspec-design-init
scale: "large"  # 跨三端（daemon/backend/frontend）但紧凑：4 任务无新表，参照 2026-10-10-workspec-maintenance 同域架构
---

# 设计文档（Design）— 2026-10-10-linked-repos-local-echo

<!-- 由 sillyspec design-init 生成的骨架（2026-10-10-linked-repos-local-echo）——逐节填散文后删除本注释；存量手写路径不受影响 -->
<!-- 引用规范：全文源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## 背景

2026-10-10-workspec-maintenance 交付了关联仓的**下行**链路（平台登记 → daemon 双落盘
projects/*.yaml 与 local.yaml repos:）。对偶方向缺失：成员在本地**手工**配置的这两类
sillyspec 配置（不经平台），平台关联仓卡片完全看不到——用户期望「本地已配置好的关联仓，
平台页面能看到回显」（D-001）。工具侧读取能力已具备：`sillyspec workspace status --json`
读 projects 登记面（name/path/role/state）、`sillyspec config cat` 输出 local.yaml 全文
（repos: 键值可解析）。

## 设计目标

- **只读快照上行**：daemon 按需读本地两处配置归一为快照（不写任何文件，D-005）。
- **对照展示**：卡片「本机已有配置」区按三态对照（两边一致/仅本地有/仅平台有）。
- **一键导入**：「仅本地有」条目勾选导入为平台登记（复用 create_repo/upsert_my_path，
  重名跳过幂等，D-004），导入后走既有下行同步链路闭环。
- 手动刷新现拉（D-003）：daemon 离线/超时结构化降级，不阻塞列表加载。

## 非目标

- 不做快照持久化/自动轮询/WebSocket 推送（D-003/D-005：手动刷新即弃）。
- 不做本地配置的**写/纠偏**（改本地仍属下行落盘链路或用户手改；快照只读）。
- 不做跨成员聚合视图（快照=当前用户绑定机器；owner 看自己机器，不拉他人快照）。
- 不替用户过滤「哪些本地条目算关联仓」——照实展示（含工作区根自身的子项目条目），
  导入与否由用户勾选（D-002 边界）。
- 不动 sillyspec 工具本身（零工具侧改动，只调用既有读命令）。

## 拆分判断

三端各一层、单链路无分叉，4 任务串行（daemon 快照 → backend 两端点 → 前端 → types）；
非批量形态。与 2026-10-10-workspec-maintenance 同域共生（复用其卡片/编排/任务卡基建），
代码不重叠（本变更只加只读面与导入面，不改下行链路）。

## 总体方案

```
[前端关联仓卡片 ·「本机已有配置」区]
   │ ①「刷新本机现状」按钮 → GET /api/workspaces/{id}/linked-repos/local-snapshot
   ▼
[backend] local_snapshot 端点（成员可调，WORKSPACE_READ）
   │ ② 请求-响应 RPC linked_repos_snapshot（超时 15s，conflict_snapshot 先例；
   │    按当前用户绑定机器路由；离线/超时 → 结构化降级响应而非 5xx）
   ▼
[daemon]（cwd=成员本机工作区根，只读）
   ├─ spawn sillyspec workspace status --json → projects 登记（name/path/role/state）
   └─ spawn sillyspec config cat --spec-dir <工作区根>（钉住定位防父目录漂移）→ 解析 repos: 段（key→path，最小面）+ projects: 块（相对路径，R-01 兜底）
   └─ 归一 { projects:[{name,path,role,state,detail}], repos:[{key,path}], fetched_at }（role 空串→null）
   ▼
[backend 对照计算]（内存，不落库）
   先按 key 合并双源：projects 与 repos 同名条目 → 单条对照条目
   （rel_path 取 projects 源 path，abs_path 取 repos 源 path——Grill Gap A 修复：
   一次导入同时落 rel_path 与 my_path，消除「第二条重名被跳过丢 my_path」矛盾）
   合并后 × 平台 workspace_linked_repos（按 name 对照）
   → 三态：both（两边一致）/ local_only（可导入）/ platform_only（提示落盘未完成或手删）
   ▼
[前端] 三态徽标 + local_only 勾选框
   │ ③「导入所选」POST …/linked-repos/import {entries:[{source,name,path}]}
   ▼
[backend import 端点]（owner/admin——写共享登记）逐条（对照条目已双源合并）：
   create_repo(name, rel_path?) 建行 +（条目含 abs_path 时）upsert 当前用户 my_path——
   一条对照条目一次导入同时落 rel_path 与 my_path；
   与平台已有同名 → skipped（幂等，不重不丢）；响应逐条 {name, result: imported|skipped|failed, detail?}
```

分层要点：

1. **只读铁律**：daemon 快照不写任何文件（区别于下行落盘链路的写）；spawn 只跑
   `workspace status --json` 与 `config cat` 两条只读命令，execFile 数组形参。
2. **对照口径**：本地条目键 = projects.name / repos.key；平台键 = 登记行 name。三态判定
   纯内存比对；快照响应含 fetched_at 与对照结果（backend 侧算好，前端零业务逻辑）。
3. **导入权限分层**：建共享登记行=owner/admin（WORKSPACE_MEMBER_MANAGE，与既有 CRUD 一致）；
   my_path 写当前操作者本人（成员级语义天然对位——导入发起人就是本机路径的主人）。
4. **降级路径**：daemon 离线（DaemonRuntimeOffline 504 家族）→ 前端本机现状区显示
   「守护进程离线，无法读取本机配置」占位，不阻塞列表主体。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:sillyhub-daemon/src/linked-repos-snapshot.ts | 只读快照（spawn workspace status --json + config cat，归一 projects/repos/fetched_at） |
| 修改 | sillyhub-daemon/src/daemon.ts | 注册 linked_repos_snapshot RPC handler（平名，protocol 零改动） |
| 新增 | NEW:sillyhub-daemon/tests/linked-repos-snapshot.test.ts | 命令拼装/解析归一/降级/只读断言（mock exec） |
| 修改 | backend/app/modules/daemon/linked_repos_sync.py | local_snapshot RPC 编排 + 对照计算 + import 编排（同域文件，避免新文件碎片） |
| 修改 | backend/app/modules/workspace/linked_repos/router.py | GET …/local-snapshot 与 POST …/import 两端点 |
| 修改 | backend/app/modules/workspace/linked_repos/schema.py | LocalSnapshotResponse/LocalEntry/ImportRequest/ImportResultItem schema |
| 修改 | backend/app/modules/workspace/linked_repos/service.py | import 的逐条落库（复用 create_repo/upsert_my_path） |
| 修改 | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | 快照对照/导入幂等/权限/降级用例 |
| 修改 | backend/app/modules/daemon/tests/test_linked_repos_sync.py | RPC 编排/对照三态用例 |
| 修改 | frontend/src/components/workspace/linked-repos-card.tsx | 「本机已有配置」区（三态徽标/刷新/勾选导入/离线占位） |
| 修改 | frontend/src/lib/linked-repos.ts | fetchLocalSnapshot/importSelected API 封装 |
| 修改 | frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx | 本机现状区渲染/三态/导入交互用例 |
| 重新生成 | frontend/src/lib/api-types.ts | `pnpm gen:types`（CLAUDE.md 规则 21） |
| 重新生成 | frontend/src/lib/provider-caps.ts | gen:types 同源产物（gen-provider-caps.mjs）一并提交 |
| 重新生成 | backend/openapi.json | gen:types 同源产物一并提交 |

## 接口定义

- `GET /api/workspaces/{id}/linked-repos/local-snapshot`（WORKSPACE_READ，成员可调）
  → `{ status: "ok" | "daemon_offline" | "daemon_unsupported" | "binding_missing", fetched_at?, entries: [{ key, sources: ["projects","repos"], rel_path?, abs_path?, role?, state?, detail?, match: "both"|"local_only"|"platform_only", platform_repo_id?, platform_rel_path? }] }
  （entries 为双源合并后的对照条目：sources 信息性标注来源；rel_path 取 projects 源、abs_path 取 repos 源）`
  （对照三态 backend 侧算好；platform_only 的平台条目不逐条镜像——附 `platform_only_names: [name]` 摘要即可）
- `POST /api/workspaces/{id}/linked-repos/import`（WORKSPACE_MEMBER_MANAGE，owner/admin）
  body `{ entries: [{ name, rel_path?, abs_path? }] }`
  → `{ results: [{ name, result: "imported"|"skipped"|"failed", detail? }] }`
  （rel_path→登记行 rel_path；abs_path→当前用户 my_path；重名 skipped——Grill A 合并条目语义）
- WS RPC：`linked_repos_snapshot`（backend→daemon，payload `{workspace_id, root_path}`，
  响应 `{ projects:[{name,path,role,state,detail}], repos:[{key,path}], fetched_at }`；超时 15s；workspace status 同款 `--spec-dir` 钉住在 plan 实测确认）

## 生命周期契约表

本变更含 daemon/RPC 邻接关键词，矩阵如下：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| local_snapshot 拉取 | UI | backend | workspace_id, actor | 无状态（快照即弃，D-005） |
| linked_repos_snapshot RPC | backend | daemon | workspace_id, root_path | 请求-响应；daemon 只读零落盘 |
| import 提交 | UI | backend | workspace_id, entries[] | 建登记行/写 my_path（复用既有链路）+ 触发既有 best-effort 推送 |

无新增 lease/claim/心跳语义；协议 additive（平名注册，protocol.ts 零改动）。

## 数据模型

无 schema 变更（D-005 快照不落库；导入复用 workspace_linked_repos / paths 既有两表）。

## 兼容策略（brownfield 必填）

- 未点刷新：卡片行为与本变更前一致（本机现状区显示引导文案，零请求）。
- 老 daemon（无 snapshot handler）：method_not_found → status=daemon_unsupported 占位，
  不报错（对齐既有 FR-07 降级家族）。
- 成员未绑定机器（无 WorkspaceMemberRuntime 行）：status=binding_missing → 卡片显示
  「请先绑定守护进程」引导占位，**不 409 冒泡**（Grill Gap B 修复）。
- 老 sillyspec CLI（无 workspace status --json / config cat 子命令）：该源 skipped 标注，
  另一源照常；两源全缺 → status=ok 但 entries 空 + detail 说明。
- 导入中途失败：逐条独立成败（failed 条目带 detail，不回滚已 imported 条目——幂等重入）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | workspace status --json 的 path 常态缺失（本仓实测 scanned 条目 5/5 为 "?"——非偶发异常） | P1 | daemon 侧兜底：从 config cat 同次输出的 local.yaml `projects:` 块取相对路径（零额外 spawn）；两级兜底后仍缺失（"?"/空）置 null 展示 + 该条目导入按钮禁用并标注「路径未知」——scanned 条目预期体验 |
| R-02 | config cat 输出含敏感段（local.yaml 可能有 token 类键） | P1 | daemon 侧解析只提取 repos: 段的 key→path 对与 projects: 块的相对路径（R-01 兜底），其余内容不进快照（最小面原则） |
| R-03 | 快照与列表非原子（刷新间隙平台登记变化） | P2 | 对照结果带 fetched_at；导入时后端按当下登记重算重名（幂等兜底） |
| R-04 | 与下行落盘链路的时序交叠（导入→同步→再刷新） | P2 | 教育性文案：导入成功提示「已登记，可点立即同步落盘」；快照三态自然反映落盘后状态 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 背景（上行回显需求本体） | 已覆盖 |
| D-002@v1 | 设计目标（展示+导入形态）、总体方案③ | 已覆盖 |
| D-003@v1 | 总体方案①（手动刷新现拉）、兼容策略（未点刷新零请求） | 已覆盖 |
| D-004@v1 | 总体方案③（导入复用/重名跳过/权限分层） | 已覆盖 |
| D-005@v1 | 总体方案分层要点 1（只读铁律）、数据模型（无 schema 变更） | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-005 全覆盖）
- [x] 生命周期契约表已填（daemon/RPC 邻接关键词）
- [x] UI 原型：本变更是既有卡片内的增量区块（复用 2026-10-10-workspec-maintenance 的
  prototype-workspace-linked-repos.html 设计语言，三态徽标/勾选框为标准 antd 形态），
  不另出原型——已在风险登记外显式声明
- [x] 组合裁定推演：D-003（手动拉）×D-004（导入重算重名）组合——刷新后用户拖延导入期间
  他人新登记同名条目 → 导入时按当下登记重算 skipped（R-03 兜底），无死锁格
- Design Grill 自查（Step 7）：X-001 import 权限分层与 my_path 归属一致性（owner 导入=
  owner 本机路径写 owner my_path，语义自洽）；X-002 成员可见快照/导入按钮禁用与端点
  权限对齐（FR-04 已声明）；X-003 platform_only 摘要形态（platform_only_names）避免
  镜像全量平台列表——无矛盾，无 P0/P1 未决项
