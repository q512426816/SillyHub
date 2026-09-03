---
name: 2026-09-02-changes-overview-card
created: 2026-09-02
scale: large
tier: independent
status: designing
source_ticket: docs/sillyspec/2026-09-02-agent-collab-improvements.md（P1-2，经管理员改向 B'）
---

# 工作台「活跃变更总览」卡片（B'：progress envelope 数据源）

## 1. 背景与决策链

- **起点**：跨 Agent 衔接改进工单 P1-2 原案「工单目录状态化（docs/sillyspec/ 作为数据源）」。
- **改向**：管理员质疑原案价值（docs/sillyspec 为本仓专属约定目录，硬编码进面板 = 给单一仓库做专属功能，不具平台通用性）。经 sillyspecer 建议与管理员拍板，改走 **B'**：数据源换成 SillySpec 全局进度总览 `progress show --json`（P0-1 交付 a8a100e，envelope schema 与 gate/derive 同构，设计定位即 daemon 消费）。
- **与变更中心的分工**（管理员问询后确认不重复）：变更中心（`/workspaces/[id]/changes`）是单仓读写操作台（listChanges 来源 spec 同步树，含删除/reparse）；本卡片是**跨 workspace 只读健康监控**，专亮 progress 库特有的 ghost 残留与未决同步冲突红灯，挂工作台概览层零跳转可见。卡片是入口（门铃），变更中心是操作台。
- **实证依据**：本机源码直连实测（2026-09-02 12:51 真实 envelope）：18 活跃（1 真实 + 17 ghost 持续产生中）+ 11 条未决冲突（spec 树 ×2 / 进度 ×9）——后两者在人类可读总览与变更中心页均不可见，是本卡片的核心增量价值。

## 2. 目标 / 非目标

**目标**
- FR-A 工作台概览页新增「活跃变更总览」SectionCard：健康条（活跃/ghost/冲突计数 + envelope ok/warnings/errors）+ 变更行（阶段管线 + 步骤进度 + 最近活跃）+ ghost 折叠组 + 冲突区 + 全部/需关注过滤。
- FR-B 数据链路：daemon（宿主机）周期获取 `progress show --json` envelope 摘要 → 心跳上报 backend 落库 → 前端 API 读取。
- FR-C 跨 workspace 语义（按现契约务实化，Grill B3 修订）：数据按**机器维度**分组（每台 daemon = 其绑定 workspace 的一组健康数据，Machine 列即该机器所辖仓的总览）；多仓接入=多机器各自上报，前端卡片按机器/工作区切换选择数据源。不额外做仓级路由协议（无既有先例，YAGNI）。
- FR-D 类型同步：后端 schema 变更走 `pnpm gen:types`，api-types.ts 禁止手写。

**非目标（Non-Goals）**
- 不做工单目录（docs/sillyspec/）状态化（原 P1-2 案已废弃）。
- 不做写操作（resolve 冲突 / 清理 ghost 仍在 CLI 侧完成，卡片只展示与指引）。
- 不做 @ 认领人推送（envelope 无 owner 字段；数据源侧补 owner 后另起增量，YAGNI）。
- 不实现 SillySpec CLI 发版/安装升级链（联调期走源码直连；发版由 sillyspecer 侧另行推进）。

## 3. 方案总览（三层）

```
SillySpec CLI（progress show --json，宿主机 node）
        │ ① 周期采集（daemon 内 sillyspec 运行期管理器扩展）
        ▼
sillyhub-daemon ──② 心跳载荷追加 sillyspec_status 摘要──▶ backend
                                                        │ ③ Machine 表落库（JSON 列，同构 sillyspec_update 先例）
                                                        ▼
frontend 工作台概览 ⑤ SectionCard「活跃变更总览」 ◀──④ 读取 API（daemon 模块）
```

**通路选型理由**：与 2026-08-31-machine-sillyspec-version（FR-05）完全同构——该先例已打通「daemon 探测 sillyspec → 心跳上报 → Machine 列落库 → 前端机器卡徽标」全链，本变更复用该模式仅扩载荷，无新协议。备选否决：backend 直跑 node CLI（容器需装 node+sillyspec，部署耦合）；backend 直读进度库 sqlite（Python 跨读 Node 侧 DB，耦合实现细节）。

## 4. 数据契约

**envelope（P0-1 交付，本变更只消费不定义）**：
```json
{ "schema_version":1, "ok":bool, "errors":[str], "warnings":[str],
  "generated_at":ISO8601, "data":{ "project":str, "active_changes":int,
    "changes":[{ "name":str, "ghost":bool, "current_stage":str, "stage_label":str,
                 "last_active":ISO8601, "stages":{8 阶段键:{status,steps_total,steps_completed}},
                 "steps":{total,completed} }],
    "pending_conflicts":[{ "change":str, "created_at":ISO8601, "type":"spec-tree"|"progress" }] } }
```

**心跳载荷摘要 `sillyspec_status`**（daemon→backend，heartbeat 追加字段）：envelope 全量或截断版——`{ok, errors_count, warnings_count, generated_at, active_changes, healthy_count, ghost_count, conflict_count, conflict_types, changes[](截断至 N=50, 字段含 name/ghost/current_stage/stage_label/last_active/steps，envelope 另有 readable/command 字段不透传), pending_conflicts[]}`。体量控制（Grill B2 修订：心跳 REST 通道无 8KB 级既有限制——8KB 是 run_sync bash_chunk 的 Redis pub/sub 单条截断，不同通道）：**自设载荷预算 32KB**（依据：changes 截断 N=50 × 每项 ~300B ≈ 15KB + conflicts ×N + envelope 计数字段，32KB 留一倍余量），超预算降级为纯计数模式（卡片显示"列表过大，仅计数"）。

**读取 API**：daemon 模块现有 machines 端点扩展（机器视图嵌套 sillyspec_status，对齐 sillyspec_update 嵌套先例）；无独立轮询端点，前端 TanStack Query 轮询心跳数据（心跳周期即数据新鲜度）。

## 5. 分层设计

**daemon（sillyhub-daemon/src）**
- sillyspec 运行期管理器（daemon.ts 注入；sillyspec-manager.ts 已存在）扩展：周期执行 `progress show --json`（spawn `node <sillyspec-bin> progress show --json`，execFile 数组形参防路径空格问题，cwd=**workspace.root_path 主仓根固定锚定**——daemon 不在 worktree 内执行 CLI，规则 22；采集间隔独立配置，默认 60s）。
- **三态降级矩阵**（Grill B3 修订）：
  | 采集结果 | 上报动作 | 前端表现 |
  |---|---|---|
  | ① 成功（exit 0 + 合法 JSON） | 上报新快照 | 正常渲染 |
  | ② CLI 能力缺失（spawn ENOENT=未安装 / 输出非 JSON=旧版本无 --json，warn 一次后同类静默） | 上报 `null`（清除语义） | 「总览不可用（sillyspec 未安装/版本过低）」占位 |
  | ③ 瞬态失败（spawn 超时——复用 runtime-handler.ts SILLYSPEC_TIMEOUT_MS 先例设采集超时常量 / 非零退出） | **保留上次快照上报**（不清除） | 基于 generated_at 显示「数据可能过期」标记 |
- 心跳组装处（daemon.ts register/heartbeat sillyspec 载荷段，L77-124 先例）追加 `sillyspec_status`。

**backend（backend/app/modules/daemon）**
- model.py：Machine 追加 `sillyspec_status: dict | None`（JSON 列，注释注明 B' / 本变更，落库语义同 sillyspec_update）。
- 新迁移：add_machine_sillyspec_status。
- schema.py：心跳载荷 Pydantic 模型 + 机器视图嵌套读取模型。
- service.py / runtime 心跳处理：载荷落库（Grill B1 修订：**None=清除**语义，与 sillyspec_update 权威注释一致——router.py L307-310 / model.py L106-110；载荷含 sillyspec_status=null 时置 NULL，前端据 null 显示「总览不可用」占位；采集瞬态失败不上报 null 而是保留上次快照，见 daemon 三态矩阵）。
- router.py：机器视图端点透出嵌套 sillyspec_status。

**frontend（frontend/src）**
- `components/workspace/changes-overview-card.tsx`（新）：信息架构=原型 v2（已按真实 envelope 验证）：卡头健康条（🟢活跃/🔴ghost/🔴冲突 + ok/warnings/errors mono 徽标）→ 变更行（名称 mono + stage_label 徽标 + 6 点主管线 scan→archive（quick/explore 旁路徽标）+ steps 进度条 + last_active 相对时间）→ ghost 折叠组（默认折一行 + 清理指引 code 样式）→ 冲突区（type 徽标 spec/进度 + change 名 + resolve 指引）→ 过滤 tab 全部/需关注。样式遵守 FRONTEND_PAGE_STYLE（§0.5 双主题 brand-* 语义阶、antd Badge/Tag、SectionCard 宿主、空值 —）。
- `/workspaces/[id]/page.tsx`：挂载卡片（WorkspaceStatsRow / SectionCard 网格区，与 WorkspaceConfigCard 并列；点击卡片引导跳变更中心）。
- `lib/daemon.ts`：机器数据读取扩展 sillyspec_status 类型（gen:types 生成）。
- api-types.ts：`pnpm gen:types` 再生成（node_modules 健康预检）。

## 6. 文件变更清单（File Changes）

| 文件 | 动作 | 说明 |
|---|---|---|
| sillyhub-daemon/src/daemon.ts | 修改 | 心跳 sillyspec 载荷段追加 status 摘要；运行期管理器注入采集器 |
| sillyhub-daemon/src/config.ts | 修改 | 采集间隔配置项（默认 60s） |
| sillyhub-daemon/tests/（新测试文件） | 新增 | 采集器 spawn/降级/摘要截断用例（daemon 测试惯例为根级 tests/ 平铺） |
| backend/app/modules/daemon/model.py | 修改 | Machine.sillyspec_status 列 |
| backend/app/modules/daemon/service.py（或心跳处理所在文件） | 修改 | 载荷落库 |
| backend/app/modules/daemon/router.py | 修改 | 机器视图透出 |
| backend/migrations/versions/20260903090000_add_machine_sillyspec_status.py | 新增 | 迁移（down_revision 取执行时 alembic heads 唯一 head，撞车 re-parent） |
| backend/app/modules/daemon/tests/（扩展现有 machine sillyspec 测试） | 修改 | 载荷落库/读取/空覆盖保护用例 |
| frontend/src/components/workspace/changes-overview-card.tsx | 新增 | 总览卡片组件 |
| frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx | 新增 | 渲染/过滤/空态/降级占位用例 |
| frontend/src/app/(dashboard)/workspaces/[id]/page.tsx | 修改 | 挂载卡片 |
| frontend/src/lib/api-types.ts | 再生成 | pnpm gen:types |
| backend/openapi.json | 再生成 | 随迁移/schema 变更 |

### 不修改文件

- backend/app/modules/daemon/schema.py：心跳/机器视图 DTO 按模块既有内联先例落 router.py（心跳内联 DTO :230 先例 / 机器视图 :603-609 「不动 schema.py」边界注释），本变更 schema.py 零改动。

## 7. 生命周期契约

生命周期契约：无/N/A —— 复用既有 daemon `heartbeat` 事件（2026-08-31-machine-sillyspec-version FR-05 载荷通道），仅在其载荷中追加 `sillyspec_status` 字段；不新增事件类型、不新增状态迁移、不触及 session/lease/agent_run 生命周期。Machine 行为不变（载荷落库语义与 sillyspec_update 完全同构）。

## 8. 测试与验收

- daemon：三态矩阵全覆盖用例——①成功落快照 / ②CLI 缺失（ENOENT）与旧版无 --json → 上报 null / ③瞬态失败（spawn 超时保留上次快照不清除）/ 超限截断降级计数模式。
- backend：心跳载荷落库、**null 载荷清除置 NULL（None=清除语义）**、机器视图嵌套读取、迁移可逆。
- 前端：卡片渲染（真实 envelope fixture）、ghost 折叠组、冲突区、过滤 tab、null 占位态；工作台挂载快照。
- 验收：本地起 backend+daemon+frontend，工作台卡片数据**与同刻 CLI 直连 `progress show --json` 结果一致**（不断言具体计数——ghost/冲突为动态数据，实测 13:16 已从 17/11 变为 1/0，验收口径只认一致性）。fixture 需含 envelope 的 readable/command 字段（真实 schema 字段，卡片不透传但解析需容忍）。
- 回归影响：心跳载荷追加字段需确认既有心跳消费者（ws_hub/机器卡）不受未知字段影响（Pydantic 默认忽略未知字段，风险低但需用例覆盖）。

## 9. 风险

- sillyspec 未发版（ahead 4 未 push）：联调走源码直连 spawn 路径；生产化依赖发版（sillyspecer 侧，另线）。
- 心跳体量：change 数大时全量可能超 32KB 自设预算 → 摘要截断（N=50）+ 计数降级已设计。
- Windows spawn：node 子进程路径含空格（C:\Users\qinyi\IdeaProjects\...）需引号/args 数组传参，跨平台用 execFile 数组形参。

## 10. 自审（Self-Review）

- 初稿自审（step 6）：FR/Non-Goals/风险/验收齐全性通过；两轮 Design Grill（独立子代理，初审 fail → 修订 → 复核双 pass）确认 3 个 Blocker 全解决：空值落库语义统一 None=清除、载荷预算改自设 32KB（8KB 系 pub/sub 通道论据错置已纠正）、三态降级矩阵+机器维度分组+主仓根锚定补全。
- 复核后残留三处文字不一致（§8 用例旧短语/§9 旧口径/缺三态③用例）已在 docHash 定稿前修复。
- 判级提示确认：integration-critical 为真实等级（改动 daemon 心跳 + backend），不申请覆盖——verify 阶段按真实集成证据门控执行（本地三端联调验收）。
