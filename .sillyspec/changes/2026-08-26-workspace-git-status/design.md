---
author: qinyi
created_at: 2026-08-26 21:45:29
scale: large
status: draft
change: 2026-08-26-workspace-git-status
---

# 设计文档（Design）— 工作区 Git 状态徽标（分支/改动行数/未推送/远程更新）

## 1. 背景

上一个变更（2026-08-25-workspace-git-log，已 verify PASS）交付了工作区 Git 日志视图与完整只读数据链路（daemon host-fs 四只读 RPC + backend git_log 模块 + 前端 hooks/组件）。用户进一步要求：在「Git 日志」页面与「会话」页面**随时可见**工作区的 Git 健康状态——当前分支、未提交改动行数（新增/删除）、未推送提交数、远程是否有新提交（用户拍板：自动 fetch 语义，带超时与降级）。

## 2. 设计目标

1. 共享状态条组件 `git-status-bar`，两种形态：完整态（git-log 页 PageHeader 下）与紧凑态（会话页标题右侧）。
2. 数据四要素：分支（含 upstream 跟踪名）、ahead（未推送）/behind（远程新提交，自动 fetch 后新鲜）、未提交改动 `+新增/−删除`（staged+unstaged 合并）与文件数、untracked 计数。
3. 自动 fetch：打开页面后台 `git fetch`（15s 超时；失败降级黄条提示"显示上次同步数据"，不阻断其余字段）；两页共享 react-query 缓存，staleTime 内只 fetch 一次远程。
4. 边界形态显式建模：无 upstream（本地新分支，无 ↑↓）、detached HEAD（显示短哈希）、空仓库、非 git 工作区（沿用 git_mode 降级）。
5. 三主题 token 合规、UI 中文。

## 3. 非目标（不在范围内）

- 任何 git 写操作（fetch 是网络同步非本地写；pull/commit/push 依然不做）。
- 状态条的自动轮询（refetchInterval 不设；数据新鲜度由 staleTime + 手动刷新控制）。
- 单文件级改动明细（只展示汇总行数；明细属 git-log 页既有能力）。
- submodule / worktree 递归状态聚合。

## 4. 拆分判断

单一功能 + 既有链路增量扩展（复用 git_log 模块与 host-fs 平名通道），不拆分、不批量。规模 = large（跨三子项目约 10 文件、新增 RPC 方法与 OpenAPI 端点，四件套齐全）。

## 5. 总体方案

### 5.1 数据流

```
git-log 页 / 会话页（共享 <GitStatusBar variant="full|compact">）
  │ useGitLogStatus(workspaceId) —— queryKey ["git-log", wid, "status"]，staleTime 60s
  ▼
GET /api/workspaces/{wid}/git-log/status（新轻端点，复用模块全部链路）
  绑定解析 → probe 两态 → 平名 RPC git_status（30s 超时）→ 错误映射（同既有映射表）
  ▼
daemon host-fs git_status({root})（平名注册，第 15 方法）
  ① git fetch --quiet（FETCH_TIMEOUT=15s；失败记 fetch_error，不阻断 ②③）
  ② git status --porcelain=v2 --branch --no-show-stash
     → # branch.head / # branch.upstream / # branch.ab +A -B / 1/2/? 条目
     （Grill CC-01：--no-show-stash 为实测合法 flag，未知 `#` 头行本就被前缀过滤）
  ③ git diff HEAD --numstat --no-renames（staged+unstaged 合并；--no-renames 对齐
     git_show 纪律——Grill CC-03，默认 diff.renames=true 会输出 rename 单行破坏计数）
     → additions/deletions/files_changed（files_changed ≡ numstat 行数，单源——Grill CC-05；
       index-only 差异（staged 后 worktree 还原为 HEAD）不在本口径内，属声明排除项）
     untracked 计数来自 ② 的 "? " 条目（porcelain 仅负责 untracked）
```

### 5.2 Phase 1 — daemon `git_status`

- 方法骨架对齐既有四方法（assertWithinAllowedRoots → runCmd argv → 失败结构化回传）；git_status 为 host-fs-handler **第 5 个平名 git 方法**（Grill CC-11 更正计数表述）；`root` 唯一入参（零新增注入面）。
- **fetch 降级语义**：fetch 命令单独执行（15s 超时、stdout/stderr 不外发）；**超时判定机制（Grill CC-02）**：fetch 不经 runCmd（其超时把 killed/signal 丢弃、stderr 为空串无法判别），改用本文件 runCommand（:1497）同款**局部 execFile** 读 `err.killed/signal` 判超时——超时→`fetch_timeout`，非零退出→`fetch_failed`；**no_remote 仅能靠 `git remote` 预检判定**（无 remote 时 fetch --quiet 静默 exit 0，退出码探测不到，Grill CC-07）；失败**继续**执行 ②③（behind 基于 stale tracking 数据，由 backend 标记 degraded）。
- **porcelain v2 解析**：`# branch.head main`（值为 `(detached)` → detached 形态，branch 字段返回 HEAD 短哈希 + detached=true）；`# branch.upstream origin/main`（缺失 → upstream=null）；`# branch.ab +2 -1`（缺失，即无 upstream 时 → ahead/behind=null）；`? <path>` 条目计 untracked；`1`/`2` 条目不再参与 files_changed（CC-05 单源化后 porcelain 仅负责 untracked）。
- **head_short 派生（Grill CC-04）**：取 `# branch.oid`（全长哈希）前 8 位截断；`branch.oid == '(initial)'` 兼作空仓库判据（empty=true，branch/upstream/ahead/behind/dirty 全 null）；空仓库下 `git diff HEAD` exit 128 须**容错转空态**（不走红通道，CC-07）。
- **numstat 汇总**：`git diff HEAD --numstat --no-renames` 覆盖 staged+unstaged（相对 HEAD 工作树全貌）；二进制行 `-` 计入 files_changed 不计入行数；files_changed ≡ numstat 行数（单源，无 fallback）。
- 空仓库（无 HEAD）：branch=null、全部计数 null、`empty=true`（前端空态提示"仓库还没有任何提交"）。

### 5.3 Phase 2 — backend `GET /git-log/status`

- router：`GET /workspaces/{workspace_id}/git-log/status`，WORKSPACE_READ 门控，无 query 参数。
- service `get_status`：复用 `_resolve_binding`/`_fetch_workspace`/`_probe_git_mode`/`_send_git_rpc` 既有私有方法；RPC 结果契约校验（缺字段 → GitLogContractGap 502）；no_git → 200 空态（同 commits 端点语义）。
- schema `GitLogStatusResponse`：`git_mode`（git|no_git）/ `branch`（str|null）/ `detached`（bool）/ `upstream`（str|null）/ `ahead`（int|null）/ `behind`（int|null）/ `dirty{files_changed, additions, deletions, untracked_count}`（int|null）/ `head_short`（str|null）/ `empty`（bool）/ `fetch{performed, error}`（error 为 fetch_timeout|fetch_failed|no_remote|null 代号）/ `synced_at`（ISO 时间戳 = backend 组装时刻，前端显示"已同步 · HH:MM"）。
- fetch 降级映射：`fetch.error != null` → `behind` 仍返回 stale 值但 `fetch.performed=false`；前端黄条。

### 5.4 Phase 3 — 前端

- `lib/git-log.ts`：`fetchGitLogStatus` + `useGitLogStatus(workspaceId)`（staleTime 60s 显式覆盖全局 15s、refetchOnWindowFocus 沿用全局——**>60s 后窗口聚焦会再触发一次 fetch（含远程 fetch）属预期行为**，Grill CC-09；git-log 页刷新按钮 invalidate 的 `["git-log", wid]` 前缀天然覆盖 status key，一并刷新）；queryKey 追加 `"status"` 维度。
- 新组件 `components/git-log/git-status-bar.tsx`：props `{workspaceId, variant: "full" | "compact"}`；完整态展示全要素 + 同步时间；紧凑态只展示分支/↑/↓/+−（Tooltip 展开细节）；fetch 失败黄条（完整态）/"⚠"图标（紧凑态）；主题 token（brand 徽标 / accent ↑ / warning ↓与黄条 / success + / error −），三主题亮暗档走 themes.ts 消费链；加载态骨架文案"Git 状态加载中…"。
- 挂载：git-log `page.tsx` PageHeader 下方（替换现副标题中的静态过滤文案位置为状态条+过滤文案并存）；会话页挂载点已定位——`frontend/src/components/sessions/sessions-portal.tsx`（三入口统一门户，623 行；在 title=portalTitle :415 的 PageHeader **actions 右槽**，**仅 scope.kind==="workspace" 时条件渲染紧凑态**；change/quicklog scope 虽携带 workspaceId 但语义是"围绕某变更的会话"，挂工作区健康状态偏离主题，排除——Grill CC-08）。
- `pnpm gen:types` 再生成（api-types + openapi 提交）。

### 5.5 测试

- daemon：porcelain v2 解析单测（正常/无 upstream/detached/空仓库/untracked 混合/binary numstat 行）、fetch 降级三分支（超时/失败/no_remote）、命令构造只读断言。
- backend：集成测试六分支（正常/无 upstream/fetch 失败降级 200+error/no_git 空态/离线 502/契约缺口 502）。
- 前端：git-status-bar 组件测试（完整/紧凑两形态渲染断言、fetch 失败黄条、staleTime 下两实例单请求——用两个组件同屏断言 fetch 调用次数=1）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/host-fs-handler.ts` | +git_status 方法（fetch 降级/porcelain v2/numstat 解析）。数据流：producer=git 子进程输出 → 解析聚合 → consumer=backend git_log service |
| 修改 | `sillyhub-daemon/src/daemon.ts` | +1 行平名注册 git_status |
| 修改 | `backend/app/modules/git_log/router.py` | +1 GET 端点 /status |
| 修改 | `backend/app/modules/git_log/service.py` | +get_status 方法（复用四个既有私有方法） |
| 修改 | `backend/app/modules/git_log/schema.py` | +GitLogStatusResponse 及嵌套模型 |
| 修改 | `backend/app/modules/git_log/tests/test_router.py` | +status 六分支集成测试 |
| 修改 | `sillyhub-daemon/tests/host-fs-handler-git-log.test.ts` | +git_status 用例（解析/降级/命令构造） |
| 再生成 | `frontend/src/lib/api-types.ts` + `backend/openapi.json` | gen:types 产物随变更提交（规则 21） |
| 修改 | `frontend/src/lib/git-log.ts` | +fetchGitLogStatus + useGitLogStatus |
| 新增 | `frontend/src/components/git-log/git-status-bar.tsx` | 共享状态条（full/compact 两形态） |
| 修改 | `frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx` | 挂载完整态状态条 |
| 修改 | `frontend/src/components/sessions/sessions-portal.tsx` | 头部条件挂载紧凑态状态条（scope.kind==="workspace" 时） |
| 新增 | `frontend/src/components/git-log/__tests__/git-status-bar.test.tsx` | 组件测试 |

## 7. 接口定义

### 7.1 HTTP 端点

`GET /api/workspaces/{wid}/git-log/status`（WORKSPACE_READ）→ `GitLogStatusResponse`（§5.3 字段）。

### 7.2 daemon RPC 契约

```
git_status({root})
  → { branch: string|null, detached: bool, upstream: string|null,
      ahead: int|null, behind: int|null,
      files_changed: int|null, additions: int|null, deletions: int|null,
      untracked_count: int|null, head_short: string|null, empty: bool,
      fetch_performed: bool, fetch_error: string|null,   # fetch_timeout|fetch_failed|no_remote|null
      error: string|null }
```

### 7.3 数据结构（schema.py）

见 §5.3 `GitLogStatusResponse` 字段清单（backend 侧改名 fetch_performed→fetch.performed 嵌套，snake_case 全程）。

## 7.4 生命周期契约表

生命周期契约：无（N/A——本变更为无状态只读查询扩展，不新增 session/lease/agent_run 状态流转；fetch 为网络同步不落本地状态，经 daemon host_fs RPC 一次性请求-响应，无租约/心跳/claim 语义）。

## 8. 数据模型

无表结构变更（纯只读查询扩展，无 SQLModel/Alembic 改动）。

## 9. 兼容策略

- 全部为既有模块的纯增量（新方法/新端点/新组件），不改任何既有端点、schema 字段、组件行为；旧 daemon 下新端点 → method_not_found → 422 提示升级（既有映射复用）。
- 回退：状态条组件移除挂载即回退，无数据残留。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | git fetch 网络慢/凭证失败拖垮页面 | P0 | fetch 单独执行 15s 超时；失败降级标记，不阻断 ②③；前端 staleTime 60s 防重复 fetch；页面首渲不等 status（骨架态） |
| R-02 | porcelain v2 解析边界（detached/无 upstream/中文路径/重命名条目） | P1 | 解析纯函数单测覆盖六类；条目按前缀字节严格匹配；路径不参与行数统计只计数 |
| R-03 | ahead/behind 在 stale tracking 下误导用户 | P1 | fetch 失败显式黄条"显示上次同步数据"+fetch.error 代号；upstream 缺失时置 null 不显示 ↑↓ |
| R-04 | 会话页头部组件树挂载点不确定（薄壳页） | P2 | TaskCard 阶段精确化到实际头部组件文件；组件自治取数不侵入会话列表逻辑 |
| R-05 | 大仓库 git diff HEAD --numstat 慢 | P2 | daemon 侧整体 30s 超时兜底；正常仓库毫秒级；超限走既有 timeout 504 |
| R-06 | gen:types worktree editable-install 坑复发 | P2 | 沿用上一变更验证过的 PYTHONPATH 方案（backend.md 已登记） |

## 11. 决策追踪

| 决策 | 内容 | 覆盖 |
|---|---|---|
| D-001@v1 | 自动 fetch 语义（打开页面后台 fetch 一次，15s 超时降级）——用户 AskUserQuestion 拍板 | §2.3 / §5.2 / R-01 |
| D-002@v1 | 方案 A：git_log 模块扩展独立轻端点（否决并入 commits 响应/独立模块）——用户拍板 | §5.1/§5.3 |
| D-003@v1 | 状态条双形态共享组件（full=git-log 页 / compact=会话页），react-query staleTime 60s 两页共享缓存 | §5.4 |

继承上一变更全部决策（D-001~D-006 of workspace-git-log：自研泳道/方案A链路/只读边界/lane 后端算/Grill 修正）——本变更不违反任何一条。

## 12. 自审（Self-Review）

- [x] 章节齐全（12 章节）+ frontmatter（author/created_at 秒级/scale=large）；
- [x] 生命周期关键词（daemon/session）命中 → §7.4 紧邻豁免声明「生命周期契约：无（N/A…）」；
- [x] 文件清单含对外字段 → producer→consumer 数据流标注（§6 首行/§7.2）；
- [x] 原型已生成（组件级新增，建议生成级）：prototype-git-status-bar.html 五形态双主题；
- [x] 用户三项澄清全部落位（分支/行数/ahead/behind + 自动 fetch）；
- [x] 无 DB 变更（§8）与回退路径（§9）明确；接口对齐既有模式（复用四私有方法/错误映射/门控）。

⚠️ 自审存疑（交 Grill）：① sessions 页头部实际挂载组件未最终定位（R-04）→ **Grill 已核实可行（CC-08：sessions-portal.tsx:415 PageHeader actions 槽，R-04 属伪风险，已消除）**；② `git diff HEAD` 的 files_changed 口径 → **Grill 已裁定单源化（CC-05：files_changed ≡ numstat 行数，index-only 差异声明排除）**。

**Design Grill 修正记录（2026-08-26，独立子代理 12 项交叉点实测审查）**：CC-01（P0）`--show-stash=no` 为非法 flag 实测 exit 129 → 改 `--no-show-stash`；CC-02 fetch 超时判定不经 runCmd（killed/signal 被丢弃）→ 局部 execFile（runCommand :1497 先例）；CC-03 numstat 补 `--no-renames`（默认 rename 检测破坏计数）；CC-04 head_short=branch.oid 前 8 位、'(initial)' 兼作 empty 判据；CC-05 files_changed 单源化+口径排除声明；CC-07 空仓库 diff exit 128 容错转空态、no_remote 仅靠预检；CC-08 挂载点核实+change/quicklog scope 排除理由；CC-09 聚焦重取后果与刷新联动写明；CC-10/11 分支口径与"第 5 个平名 git 方法"计数更正。全部机械修复，无用户决策项，Unresolved Blockers 清空。
