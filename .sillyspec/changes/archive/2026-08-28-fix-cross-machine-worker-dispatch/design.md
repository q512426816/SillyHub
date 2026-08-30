---
author: WhaleFall
created_at: 2026-08-28 15:04:11
scale: large
tier: independent
---

# 设计文档（Design）— 修复跨机器分身派发：工作区绑定机器唯一钉定 + allowed_roots 双重校验 + daemon 拒建不存在目录

## 背景

生产环境出现跨机器派发缺陷：mission owner 名下有任意在线 daemon 时，分身子会话被钉定到 **owner 自己的机器**，而目标工作区的代码副本（worktree）却经 host_fs 通道在**目标工作区绑定的机器**上创建——会话与工作副本分裂在两台机器。随后 owner 机器的 daemon 认领 lease，发现 cwd 不存在，因 gap-8 修复引入的无差别 `mkdir(cwd, {recursive:true})`（daemon.ts:3862）在错误机器上**静默创建空目录**，分身在空目录里"成功"执行任务——灾难性静默失败。

根因三要素（均有代码实证）：

1. **选机错**：`mcp_tools.py:1108` `placement_svc._get_online_runtime(owner_id)` 纯查 `daemon_runtimes` 表（用户级 first-online），完全不看 `workspace_member_runtimes`。DB 实证：QM小程序 工作区 → crrcdt-hubin 机器的绑定行已存在，但该选机路径从未读它；owner 自有机器在线即抢占，绑定机器仅作 owner 无在线机器时的兜底（mcp_tools.py:1108-1118）。
2. **校验缺**：allowed_roots 白名单校验现状只在 daemon 端 host_fs RPC 通道有（host-fs-handler.ts:906-907 等全方法第一道守卫）；backend 派发链路零校验；**daemon 交互会话 cwd（认领→spawn）既无白名单校验也无存在性预检**。且 host_fs 的 forbidden 经 `_via_rpc_or_degrade` 降级通道被笼统的 `worktree_create_failed + "rpc unavailable"` 掩盖（delegate.py:73-78/387）。
3. **掩盖错**：daemon.ts:3852-3869 gap-8 修复本意是解决 daemon-client 无 workspace 会话的 cwd 兜底目录不存在问题，但实现为无差别 mkdir——错机派发时把"本应失败"的场景变成"在错机上建空目录继续跑"。

对照：batch 派发路径（`dispatch_to_daemon` → `_resolve_dispatch_runtime`，placement.py:1120-1274）已按目标工作区绑定路由，无此缺陷；普通交互会话（create_session 非钉定路径）属另一语义域，本次不动。

## 设计目标

1. 分身派发选机恒钉定**目标工作区绑定机器**（`workspace_member_runtimes` 解析），绑定机器不在线即明确拒绝（422），绝不静默换机。
2. allowed_roots 白名单**双重校验**：backend 派发前预检（fail-fast、可诊断错误信息）+ daemon 认领时终检（权威裁决）。
3. daemon 对 workspace 绑定会话**拒建不存在目录**：cwd 缺失 fail-loud 报错，不再 mkdir；仅保留无 rootPath 兜底路径（daemon-client 会话）的 gap-8 mkdir。

## 非目标

- 不改 batch 派发路径（已按工作区绑定路由）。
- 不改普通交互会话（create_session / prepare_interactive_dispatch 非钉定分支）的选机语义。
- 不新增 host_fs mkdir/ensure RPC，不改 host_fs 既有十五方法。
- 不改表结构、不新增对外 API 字段（拒绝走既有 4xx 错误路径与 notifyRunResult 通道）。
- 不解决 worktree 过期租约 GC（知识库已知独立问题）。
- 不做路径指纹/内容校验（同路径异机同名的极端配置错配由 daemon 存在性检查+白名单兜底）。

## 拆分判断

单主题修复（一个根因三道防线），三处改动同属一条派发链路强耦合（选机语义变更决定预检与 daemon 守卫的判定输入），拆分会造成中间态不自洽（如先上 daemon 拒建而选机未修 → 正常跨区派发被误杀），不拆分、不走批量模式。

## 总体方案

三道防线按「派发前 → 认领时」时序布防，选机修复是治本，两道校验是纵深防御：

### Wave A：backend 选机唯一钉定 + 白名单预检

**A1. 预检两段式 provider 解析**（mcp_tools.py `_dispatch_worker_core`）
现预检 `resolve_representative_binding(..., provider=None)` 升级为两段式：先 `provider=target_provider` 严格解析（target_provider = ws.default_agent or "claude"，需将 ws 取行挪到预检之前）；严格无果再 `provider=None` 回退任意在线 binding，打 `placement_provider_fallback` 同款 warning。两段均无果 → 既有 422 中文引导不变。对齐被删除的 own_rt 路径的 provider fallback 语义（placement.py:1508-1520），不引入新拒绝路径（D-002@v1）。

**A2. 删 own_rt 优先分支，恒 binding 钉定 + 双源同序收敛**（mcp_tools.py:1098-1118）
删除 `_get_online_runtime(owner_id)` 抢占分支；恒以预检 binding 钉定：`pinned_runtime_id = binding["id"]`、`pinned_skip_owner_check = True`、`lease_provider = binding.provider or target_provider`。绑定机器不在线已被预检 422 拦截；钉定复查（`_query_pinned_online_runtime`）竞态掉线仍走 NoOnlineDaemonError 收敛（既有语义，Grill C-01 零回归）。

多成员多机绑定的确定性（Design Grill D-1.1/F-1.2 修订，D-005@v1）：钉定解析（`resolve_representative_binding`）与 worktree 路由（`resolve_daemon_instance_for_workspace`，host_fs delegate 内部调用）是两个独立查询，原均为 `LIMIT 1` 无 ORDER BY——可分叉导致 worktree 建 A 机、lease 钉 B 机。修法：两查询统一补**全序** `ORDER BY daemon 心跳 DESC, daemon_id ASC`（queries.py 两处），相同候选集上必收敛同机。残余形态（两机绑定的在线性差异、心跳完全同刻）→ worktree RPC 失败或 daemon cwd_not_found，fail-loud 不静默。常态兼容：单绑定工作区（绝大多数）钉定结果与旧行为一致（D-001@v1）。

**A3. backend allowed_roots 预检**（新 helper + mcp_tools 接线）
钉定后、建 sub_session/run 行**之前**：校验 daemon 视角路径 ⊆ 钉定机器 allowed_roots。数据源 = `DaemonInstance.allowed_roots ∪ 该 instance 名下全部 daemon_runtimes.allowed_roots`（binding.daemon_instance_id 查 instance 一行 + runtimes 多行取并集，对齐 daemon `_effectiveAllowedRoots` = 本地 config（≈instance 注册值）∪ PolicyCache 全部 runtime 根的同机全量语义）。路径 = `effective_worktree_path or resolve_root_path_for_daemon(ws.root_path)`（容器前缀改写后的宿主路径，与 worktree 创建同源）。

拒绝规则（Design Grill B-1 修订，D-003@v2——只拒**可判定**越界）：并集中存在至少一条绝对路径根（非 `~` 前缀）且路径不在任何绝对根内（`~` 根无法在 backend 展开、跳过判定）→ 400（中文引导：路径不在钉定机器 allowed_roots 白名单，请检查机器配置），不建 run/lease（对齐治理门前置拦截的既有模式，mcp_tools.py:1026-1046）。全部根为 `~` 或并集为空 → **不可判定，放行**，daemon 终检权威裁决。双重校验的救济方向是单向的：backend 偏松（DB 根落后于 daemon 本地真值）由 daemon 终检拒绝兜底；backend 偏严（daemon 本地 config 缩减未重注册）会误拒——daemon 本地 config 变更需重启生效、重启即重注册回同步 DB，漂移窗口极小，登记为残余风险而非救济主张。

### Wave B：daemon 认领终检 + 拒建不存在目录

**B1. 守卫抽纯函数**（新文件 sillyhub-daemon/src/interactive-cwd-guard.ts）
`checkWorkspaceBoundCwd(cwd, exists, roots)` → `{ok:true} | {ok:false, code:'cwd_forbidden'|'cwd_not_found', message:string}`；message 中文、含 cwd 与原因（错机派发/绑定路径错配的可诊断信号）。纯函数可单测，规避 daemon.ts god file（4047 行）内联扩散。

**B2. daemon.ts 认领段接线**（daemon.ts:3760-3869）
cwd 解析后、executable 检查前，**插入点在 firstRunId 非空守卫（daemon.ts:3808）之后**（保证 notifyRunResult 可用，否则拒绝时 run 永久 pending）：
- `rawRootPath` 为**非空字符串**（truthy 判定——空串 `''` 与 undefined/null 同走兜底分支，Grill D-1.2 修订；`??` 不兜空串是现状陷阱）且非 `BORROW_SANDBOX_MARKER`（workspace 绑定会话）：**先白名单终检** `assertWithinAllowedRoots(cwd, this._effectiveAllowedRoots())`（daemon.ts:2530 已有同款用法；双违反形态白名单优先，plan 审查统一口径），**再 stat 存在性检查** → 任一不过：守卫返回码映射 `notifyRunResult(leaseId, claimToken, firstRunId, {status:'error_during_execution', is_error:true, result_summary: message})`（对齐 executable-not-found 块 3818-3849 的主动回传模式，防 run 永久 pending）后 return；**不 mkdir**。
- `rawRootPath` 为空（daemon-client 兜底 `config.workspace_dir`）：保留 gap-8 `mkdir(cwd, {recursive:true})` 原样。
- 借用沙箱 marker 路径：prepareWorkspace 自建目录，不改。

正确机器上 cwd 必已存在（worktree 由 host_fs RPC 在绑定机器先建——双源同序保证与钉定同机、direct 模式即工作区根本身），存在性即"对机"试金石；错机/路径错配必命中 not_found/forbidden fail-loud（D-004@v1）。路径A（caller worktree 透传，`prepare_worker_worktree` 短路不发 host_fs RPC）例外：cwd 非绑定机器所建，跨机形态由本守卫显式拒绝（见兼容策略）。

### Wave C：测试

- backend `test_worker_subsession_dispatch.py`：重写 `:736 test_own_runtime_preferred_over_representative` → 断言钉定绑定机器而非 owner 自有（QM小程序→crrcdt-hubin 场景复刻：owner 在线 + 未绑定目标区 / 绑定机器属第三方，夹具需支持解耦 own_runtime 与 owner 绑定）；`:684` 跨区代表钉定用例零改动回归；新增 A3 预检用例（可判定越界 400 / `~` 根不可判定放行 / 空并集放行 + FR-04 边界包含子句 `/ws/root` 命中 `/ws` 放行、`/ws-other/x` 拒）、A1 provider 两段式用例。
- backend `test_representative_binding.py`（plan 审查发现的涟漪文件）：task-01 全序化后分支1 候选集含全部成员绑定（SQL 按 `w.created_by` 过滤、不滤 `wmr.user_id`），owner 优先用例（:124）依赖无序插入序碰巧先返 owner 行——补序后按新语义更新夹具/断言（owner 绑定心跳最新时 owner 优先命中，属需求变更非放水）。
- backend `test_placement_member_binding.py`：双源同序用例——多成员多机绑定时 `resolve_representative_binding` 与 `resolve_daemon_instance_for_workspace` 收敛同机（心跳序 + daemon_id tie-break）。
- daemon `interactive-cwd-guard.test.ts`：纯函数三形态（通过 / forbidden / not_found）× Windows/Linux 路径形态；daemon.ts 接线以 typecheck + 既有 claim 链路测试回归保障（接线级"不 mkdir/保留 mkdir"无自动化断言，验收时如实按此口径人工核验）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/mcp_tools.py | `_dispatch_worker_core`：ws 取行前移；预检两段式 provider（A1）；删 own_rt 分支恒 binding 钉定（A2）；新增 A3 预检调用（可判定越界抛 400）。均为内部实现，无对外字段/DTO 变更 |
| 修改 | backend/app/modules/agent/placement.py | 新增模块级 helper：`fetch_daemon_allowed_roots(session, daemon_instance_id)`（instance ∪ 该 instance 名下全部 runtimes 并集）+ 纯函数 `path_definitively_outside_roots(path, roots)`（`~` 根跳过、分隔符/大小写归一、仅可判定时 True）。供 mcp_tools 预检调用；纯函数独立可测 |
| 修改 | backend/app/modules/workspace/member_runtimes/queries.py | 双源同序（D-005@v1）：`resolve_representative_binding` 分支1 与 `resolve_daemon_instance_for_workspace` 统一补 `ORDER BY daemon 心跳 DESC, daemon_id ASC` 全序，保证钉定机器与 worktree 路由机器收敛。注意：路由查询加 daemon_instances inner join 后会静默丢弃 daemon_instances 行缺失的 stale 绑定（良性，实现处注释明示） |
| 修改 | backend/app/modules/agent/tests/test_worker_subsession_dispatch.py | 重写 own 优先用例为绑定钉定；新增预检/provider 用例；回归保留 :684 |
| 修改 | backend/app/modules/workspace/member_runtimes/tests/test_representative_binding.py | owner 优先用例（:124）按全序新语义更新夹具/断言（plan 审查发现的涟漪文件） |
| 修改 | backend/app/modules/agent/tests/test_placement_member_binding.py | 双源同序回归用例（多成员多机绑定两解析收敛同机） |
| 新增 | sillyhub-daemon/src/interactive-cwd-guard.ts | 纯函数守卫 `checkWorkspaceBoundCwd`（B1），无 IO、无状态 |
| 修改 | sillyhub-daemon/src/daemon.ts | 认领段（3760-3869）接线 B1：truthy 判定分支、workspace 绑定会话 stat+白名单终检，失败 notifyRunResult error 后 return 不 mkdir；空 rootPath 保留 gap-8 mkdir。内部实现，notifyRunResult 通道字段不变（result_summary 承载中文原因） |
| 新增 | sillyhub-daemon/tests/interactive-cwd-guard.test.ts | 守卫纯函数单测（B1 三形态 × 双 OS 路径） |

数据流标注：本变更无新增对外字段/接口/DTO/事件 payload——backend 拒绝走既有 `HTTPException` 4xx 文本、daemon 拒绝走既有 `notifyRunResult(result_summary)`；上表所列均为内部实现变更。

## 接口定义

```python
# placement.py（新增，模块级）
async def fetch_daemon_allowed_roots(
    session: AsyncSession, daemon_instance_id: uuid.UUID
) -> list[str]:
    """DaemonInstance.allowed_roots ∪ 该 instance 名下全部 daemon_runtimes.allowed_roots。
    对齐 daemon _effectiveAllowedRoots 的同机全量语义（本地 config≈instance 注册值 ∪ PolicyCache 全部 runtime 根）。"""

def path_definitively_outside_roots(path: str, roots: list[str]) -> bool:
    """仅可判定越界时 True：roots 中存在至少一条绝对路径根（非 ~ 前缀），
    且 path 归一（os.sep/normpath，Windows 形态大小写不敏感）后不在任何绝对根的
    边界敏感前缀包含内（resolved == root or startswith(root + sep)）。
    全部根为 ~ 或无绝对根 → False（不可判定，放行交 daemon 终检权威）。"""
```

```typescript
// sillyhub-daemon/src/interactive-cwd-guard.ts（新增）
export type CwdGuardVerdict =
  | { ok: true }
  | { ok: false; code: 'cwd_forbidden' | 'cwd_not_found'; message: string };
export function checkWorkspaceBoundCwd(
  cwd: string,          // workspace 绑定会话的候选 cwd（rawRootPath 为非空字符串的形态）
  exists: boolean,      // daemon 侧 stat 结果
  roots: string[],      // _effectiveAllowedRoots()
): CwdGuardVerdict;     // forbidden 判定复用 assertWithinAllowedRoots 同一 containment 口径
```

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| dispatch_worker（MCP） | 主控/分身 agent | backend mcp_tools | objective, target_workspace_id?, role? | 建 sub_session(pending) + run(pending) + lease(pending)；**本变更新增两个前置拒绝**：无在线绑定→422（既有）、路径越白名单→400（新增），均不落 run 行 |
| host_fs.git_worktree_add | backend host_fs delegate | 绑定机器 daemon | workspace_id, workdir, sibling_path, branch, base_ref | 绑定机器上创建 `.worktrees/<id>`；daemon 端 assertWithinAllowedRoots 既有守卫不变 |
| claim lease | daemon | backend | leaseId, claimToken | lease pending → claimed；lease 钉定绑定机器 runtime（A2），与 worktree 路由机器经双源同序收敛（D-005@v1），残余分叉形态由 cwd 守卫/工作区 RPC fail-loud 收敛 |
| **cwd 守卫拒绝（新增）** | daemon（认领后 spawn 前） | backend | leaseId, claimToken, runId, status=error_during_execution, is_error=true, result_summary（cwd_forbidden/cwd_not_found 中文原因） | run → failed（run_sync 既有 error 通道收敛；会话由 sweep/终态兜底收敛，不新增状态） |
| spawn interactive session | daemon | 本地 SDK | cwd（已通过守卫，必存在且在白名单内） | session 创建执行；错机场景在此前已被拒 |

表中事件与必需字段均有对应代码任务（Wave A/B）与测试任务（Wave C）；无缺失事件。

## 数据模型

无表结构变更。`workspace_member_runtimes`（复合主键 workspace_id×user_id，daemon_id 派发依据）、`daemon_instances.allowed_roots`、`daemon_runtimes.allowed_roots` 均为既有字段，本变更是**消费方式**变更（选机从无视绑定 → 唯一钉定）。

## 兼容策略

- **常态零变化（条件化，Grill F-1.1 修订）**：owner 机器即工作区代表绑定机器时（单绑定工作区、或派发者==创建者且其绑定被全序选中——绝大多数场景），钉定结果与旧行为一致；owner 机器**不是**绑定机器时钉定结果改变——这正是本变更要修复的语义，非回归。
- **路径A（caller worktree 透传，Grill F-1.3 明示）**：主控显式传 `worktree_path` 且该路径在调用方机器、调用方机器≠钉定机器时，旧行为可在 owner 机器正常执行、新行为将被 A3 预检（400）或 B2 守卫（cwd_not_found）显式拒绝——属"拒绝即信号"的预期语义变化，非回归；主 agent 收到错误文案可改派无显式 worktree 的目标区任务。
- **部署顺序无关**：新 backend + 旧 daemon → 预检已拦绝大多数错配，旧 daemon 仍 mkdir（防线弱一层但无回归）；旧 backend + 新 daemon → 正常路径（cwd 存在且在白名单）不受影响，拒建仅命中本就错配的场景。
- **不改变的契约**：batch 派发路径、普通 create_session、host_fs 十五方法、表结构、API DTO、notifyRunResult 通道格式。
- **拒绝即信号**：owner 自有机器不再是合法分身执行机（除非同时是绑定机器）——这是本变更的**语义意图**而非回归；主 agent 收到 422/400/failed 文案可自主引导用户绑定机器上线。

## 风险登记

- **路径归一跨 OS 差异**：backend 纯函数与 daemon containment 口径若不一致会误判 → 双端各自测试覆盖 Windows（盘符/反斜杠/大小写）与 Linux 形态；backend `~` 根跳过已在设计中明确。
- **预检误拒残余风险（Grill B-1 修订后的如实登记）**：backend 偏松（DB 根落后 daemon 本地真值）由 daemon 终检拒绝兜底，方向安全；backend 偏严（daemon 本地 config 缩减未重注册、同机兄弟 runtime 根不一致）会误拒合法请求且无救济——已通过"并集取该 instance 名下全部 runtimes + 仅可判定越界才 400"把误拒窗口收敛到 daemon 本地改 config 未重启的极窄场景（daemon config 变更需重启生效，重启即重注册回同步）。
- **双源分叉残余**：多成员多机绑定时两解析源经全序收敛，但在线性差异/心跳同刻极端形态仍可分叉 → worktree RPC 失败（hostfs_unavailable/worktree_create_failed）或 daemon cwd_not_found，fail-loud 不静默，主 agent 可重派。
- **存量测试语义翻转**：`test_own_runtime_preferred_over_representative` 断言旧行为 → 重写为新语义（需求变更非测试放水，CLAUDE.md 规则9）；`_seed_context` 把自有 runtime 与 owner 绑定耦合且不设 `ws.created_by`，重写时需夹具微调（支持解耦形态），注意 resolve_representative_binding 分支1 走 created_by 匹配、分支2 走心跳序。
- **daemon.ts god file 改动**（约 4700 行）：内联逻辑只增不重构，守卫逻辑全部外移纯函数；typecheck + vitest 双闸；插入点在 firstRunId 守卫后（notifyRunResult 可用性）。
- **provider 回退语义残留**：A1 回退时 lease_provider 取 binding 实际 provider，与旧 own_rt 路径同款，无新风险；`placement_provider_fallback` 日志语义复用。
- **错机极端形态（同路径异机同名目录）**：daemon 存在性检查无法识别 → 明示非目标（本变更三道防线已覆盖可检测形态）。

## 自审

- [x] 根因三要素均有 file:line 实证，方案直击根因（选机）+ 纵深（双校验、拒建）。
- [x] 生命周期契约表已含（触发关键词：session/lease/daemon/claim/heartbeat）；新增事件（cwd 守卫拒绝）有对应任务与测试。
- [x] 文件变更清单完整（8 文件：backend 3 改 + 2 测试 + daemon 2 新增/1 改），数据流标注明确"无对外字段变更"。
- [x] 非目标圈定范围（不动 batch / 普通会话 / host_fs 方法 / 表结构）。
- [x] 兼容策略覆盖常态等价性**条件化**、路径A语义变化明示、部署顺序、拒绝语义意图说明。
- [x] 决策可追溯：D-001~D-004@v1 + D-003@v2/D-005@v1（Grill 修订），用户钦定三项全部落位。
- [x] 风险登记如实：预检误拒为残余风险登记（非救济主张）、双源分叉 fail-loud、测试翻转合法性说明、跨 OS 归一测试要求。
- [x] Design Grill 独立审查（tier=independent）1 fail + 7 gap 全部落实修订：B-1（预检救济方向矛盾→仅可判定越界才 400）、D-1.1/F-1.2（双源同序全序）、D-1.2（truthy 判定+插入点）、C-1.2（并集措辞/生命周期表述）、F-1.1（等价性条件化）、F-1.3（路径A明示）。
