---
author: qinyi
created_at: 2026-11-06 23:50:00
scale: large
---

# 设计文档（Design）— 2026-11-06-session-git-approval

## 背景

交互式会话中 agent 通过 Bash 工具直接裸跑 `git commit` / `git push`，平台对这两类改写仓库/远端的操作**零拦截**（写守卫 `extractShellWritePaths` 提取不到 git 命令的写路径，直接放行）。用户希望在提交/推送落地前做最后一道人工把关：agent 触发 git 提交/推送时会话页弹出确认卡（参考 git 日志页「工作区更改」的展示形态），预填 commit msg 与文件勾选范围，用户二次修改后点「提交/推送」才真正执行，执行结果回喂 agent 继续工作。

平台已有成熟的「canUseTool 拦截 → 远程人审 dialog → 前端卡片 → HTTP 决策回传 → 结果回喂 agent」全链路（AskUserQuestion 问答卡、ExitPlanMode 计划审批两个先例），本变更在该管线上新增一种 `dialog_kind='git_approval'` 的确认卡，并补一段 daemon 本机代执行引擎。

## 设计目标

1. agent 的 `git commit` / `git push` 一律拦截进确认卡，**默认全局生效**（所有交互式会话，不依赖 manual_approval 旗标）；
2. 确认卡形态与 AskUserQuestion 对话卡一致（替换输入栏位置、可最小化胶囊、刷新恢复），内容为 git 确认面板：目录树文件勾选（四色状态 + 增删行数 + 目录级勾选）+ commit msg 编辑 + 单文件 diff 查看；push 态显示目标分支与保护分支警示；
3. 用户确认后由 **daemon 本机代执行**（不交回 agent 重跑），执行结果作为 Bash 工具结果回喂 agent；
4. 拒绝时原因回喂 agent，agent 可调整后重新发起；
5. 长驻等待不超时，页面刷新后确认卡仍在（dialog 落库恢复）。

## 非目标

- 不拦 `git add`（无破坏性，commit 拦截已覆盖最终落库动作）；
- 不拦 `git merge` / `rebase` / `reset` / `checkout --` 等历史改写操作（v1 范围外，D-003）；`sillyspec push --dry-run`（只输出计划）、`--no-push`（只压扁不推送）、`--undo`（恢复压扁不推送）无推送副作用，同样不拦（D-013）；
- 不覆盖批处理 run（task-runner 无 canUseTool 审批面）与团队分身（worker 在隔离 worktree、由平台 converge 统一 merge，不经 agent commit）（D-005）；
- 不做 push 到 main/master 的硬拦截（警示徽标，用户点击即授权，D-006）；
- 不追求覆盖一切命令伪装形态（base64 包裹再 decode 之类怪异绕过不在 v1 防御范围，登记为已知限制）。

## 拆分判断

单变更三端协作但改动集中在 daemon（识别 + 代执行两个新模块 + 挂载分支）与前端（一张新卡 + 分流挂载），backend 仅一个只读 diff 端点 + 审批链路零改动复用；无批量模式特征（非模板×数据）。规模 large（跨三子项目、新协议 payload 语义、新交互组件），需 Wave 编排（daemon/前端可并行，联调收尾串行）。

## 总体方案

### 链路总览

```
agent 跑 "git commit -m xxx"（Bash 工具）
  → daemon buildCanUseToolCallback 新增 git 分支：
      git-command-guard 识别（拆复合命令逐段匹配 git commit/push）
    → 命中 → 本机采集（git status porcelain v2 + numstat + 分支/ahead）
    → PermissionResolver.register() 发 PERMISSION_REQUEST
      （dialog_kind='git_approval'，dialog_payload 见接口定义）
    → agent 挂起（dialog 长驻等待，无 5min 超时）
  → backend permission_service 落库 session_dialog_requests
    + SSE 广播 permission_request（现有通道，零改动）
  → 前端 PendingDialogDock 分流 dialog_kind='git_approval'
    → GitApprovalCard（目录树勾选 + msg 编辑 + diff 查看）
  → 用户点「提交/推送」或「拒绝」
    → respondSessionPermission(decision, dialog_result)（现有 API，零改动）
  → backend 经 ControlCommandService WS 下发 PERMISSION_RESPONSE（零改动）
  → daemon resolver.resolve() 唤醒：
      批准 → git-executor 本机代执行（精确暂存区重整→commit / push，见代执行节）
           → 成功/失败文本作为 Bash 工具结果回喂 agent
      拒绝 → 「用户拒绝了本次提交：<原因>」回喂 agent
  → backend SSE permission_resolved → 前端移除卡片（现有通道）
```

### Phase 划分（Wave 编排依据）

- **W1 daemon 识别与挂起**（可独立测试）：`git-command-guard.ts` 纯函数（拆段/解析/预填规则）+ `permission.ts` 挂载分支（approvalReady 分支的 `buildCanUseToolCallback` 内，**位于 askUserOnly 自动放行判断之前**——git 写操作不因门户会话只问不审而漏拦）+ **`driver-factory.ts` 仅写校验分支补 git 审批接线**（该分支现注入独立构造器 `_buildWriteOnlyCanUseToolCallback` 且无 resolver/WS 通道——D-001 全局生效要求为其补最小审批面：PermissionResolver 构造 + git 分支注入，普通工具路径不变）+ 逃生阀 `SILLYHUB_GIT_APPROVAL=off`；
- **W2 daemon 代执行**（依赖 W1 的解析结果结构）：`git-executor.ts`（暂存区重整/commit/push/结果格式化/identity 复用）；
- **W3 backend 会话级 diff 端点**（与 W1/W2 并行）：`GET /api/daemon/sessions/{id}/git-diff?path=` 走现有 daemon RPC `git_worktree_diff`，供确认卡按需取单文件 diff；
- **W4 前端确认卡**（依赖 W1 payload 结构冻结，W3 端点就绪；与 W2 可并行）：`git-approval-card.tsx` + dock/panel 双模式分流挂载；
- **W5 联调与回归**：端到端闭环（挂起→确认→代执行→回喂）+ 现有 dialog/审批测试回归。

### 关键设计细节

**命令识别**（`git-command-guard.ts`，纯函数）：按 `&&` `||` `;` `|` 拆子命令逐段匹配（规避知识库实证的 `git add ... && git commit` 前缀绕过坑）；支持 `git -C <path> commit/push`；commit 解析 `-m`（多段拼接）/`-F <file>`/位置参数 pathspec/`-a`；push 解析 remote/ref 位置参数（默认 origin+当前分支）。**同时识别 `sillyspec push` CLI**（本仓规范推送路径：技能 `.claude/skills/sillyspec-push` 明令禁止 agent 直接 `git push`，CLI 内部自行压扁+推送、不经 agent Bash——只认 `git push` 会漏拦）：`--dry-run`（只输出计划）、`--no-push`（只压扁不推送）、`--undo`（恢复压扁，不推送）**不拦**（无推送副作用）；默认形态与 `--mode one`/`--remote`/`--branch` 等**拦**，用户确认后 daemon 原样代执行（见代执行节）。**预填勾选规则**：命令带 pathspec → 勾 pathspec；带 `-a` → 勾全部 tracked 改动；都无 → 勾当前暂存区；暂存区空 → 勾全部改动（D-012 依据）。

**工作区采集**：`git status --porcelain=v2 --branch`（注意实证坑：`1` 条目 path 分隔符是空格不是 `\t`）+ `git diff --numstat` / `git diff --cached --numstat`（增删行数，两口径分别对应未暂存/已暂存）+ push 时 `ahead` 计数与最近 ≤20 条待推送提交（`git log @{u}..HEAD --name-status --numstat` 一次采集：每条 sha/subject/author/date + **该提交的文件明细**（path/status/增删行数），D-014/D-015——供推送卡逐条展开浏览）。

**代执行**（`git-executor.ts`）：commit 流采用**精确暂存区重整**（不裸 `git reset` 全清——共享工作区可能有其他会话的 staged 文件，仓纪「不替别人清理」）：对「已暂存但未勾选」的文件 `git reset -- <paths>`、对「勾选但未暂存」的文件 `git add -- <paths>`（spawn 数组形参不经 shell，天然规避 PowerShell 吞 `--` 的坑）、已暂存且勾选的不动 → `git commit -m <msg>`；push 流按 runner 分流：`runner=git` 代执行 `git push <remote> <branch>`，`runner=sillyspec` **原样代执行 agent 的原始命令**（不附加任何参数——原命令带 `--json` 则回 json 输出，否则回人类可读输出；压扁+推送语义保留）。identity 复用 daemon 现有 git identity 注入。**拒绝路径不动暂存区**（agent 的 add 状态保留，它可自行调整）。

**前端确认卡**：挂 `PendingDialogDock`（分流点在 `pending-dialog-dock.tsx:137-152` 的请求 map——现一律渲染 `AskUserDialogCard`，需扩展按 `dialog_kind` 分流渲染；`:165` 的 `isDialog` 仅是胶囊标注非分流点）；卡内文件列表 = 顶层状态三分组（已暂存/未暂存改动/未跟踪）+ 组内目录树（复用 git-log `buildFileTree` 形态：路径逐级折叠、文件行只显 basename）+ 四色状态徽标 + 行级 checkbox + `+N -M` 增删统计 + 目录级勾选（勾目录=勾其下全部，显示已选/总数）+ 单文件 diff（调 W3 端点，复用 `WorktreeDiffModal` / `DiffBody` 渲染）；push 态显示 remote/分支 + **待推送提交按条明细**（每条 short sha 徽标 + 提交首行 + 作者/日期次要行，≤20 条超出显统计，D-014；**单条可点开展开该提交的文件明细**——目录树 + 四色状态徽标 + 增删统计，与提交确认卡同款展示、纯浏览不可勾选，D-015），`runner=sillyspec` 时提示「确认后将按变更段压扁后推送」，main/master 红色警示徽标不硬拦。双模式挂载（`session-panel-page.tsx` 与 `session-panel-dialog.tsx`）。**后台锚点态**（backgroundTask）dialog 走 5min 兜底 deny（resolver 既有行为）：后台任务的 git 提交被自动拒绝回喂、agent 继续不提交——fail-safe 语义；W4 需覆盖 resolved 事件到达后待决卡清理（防僵尸卡点击报 unknown_request）。原型：`.sillyspec/changes/2026-11-06-session-git-approval/prototype-git-approval.html`（真码管线产物，源 `frontend/src/components/prototype/git-approval-view.tsx`）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:sillyhub-daemon/src/interactive/git-command-guard.ts | 命令识别+解析纯函数：拆复合命令段、识别 git commit/push（含 -C 形态）、解析 msg/pathspec/-a、预填勾选规则。无对外字段 |
| 新增 | NEW:sillyhub-daemon/src/interactive/git-approval-collector.ts | 工作区采集器：porcelain v2 + numstat 双口径 + ahead 提交明细（renamed 解析）+ payload 容量截断（R-03：files>500 仅统计、aheadCommits 每提交 files>50 截断）。命名对齐 turn-file-changes 先例（填卡勘误补登） |
| 新增 | NEW:sillyhub-daemon/tests/interactive/git-approval-collector.test.ts | 采集器单测：porcelain 解析/numstat 双口径/renamed 双路径/截断边界 |
| 新增 | NEW:sillyhub-daemon/src/interactive/git-executor.ts | 代执行引擎：精确暂存区重整（D-018，见代执行节）→ commit / push、结果文本格式化、identity 复用。无对外字段 |
| 修改 | sillyhub-daemon/src/interactive/session-manager/permission.ts | buildCanUseToolCallback 新增 git 拦截分支（与 AskUserQuestion :393 / ExitPlanMode :471 并列，**置于 askUserOnly 自动放行判断之前**——git 写操作不受门户「只问不审」模式影响，D-017）：调 guard 识别 → 采集 → resolver.register() 发 dialog_kind='git_approval'；响应分发到 executor 或拒绝回喂 |
| 修改 | sillyhub-daemon/src/interactive/session-manager/driver-factory.ts | 仅写校验分支（:375 现注入 `_buildWriteOnlyCanUseToolCallback`，无 resolver/WS）补 git 审批最小接线：构造 PermissionResolver + git 拦截分支注入该回调，普通工具写校验路径不变（D-001 全局生效的可达性前提，D-016；审查阻断项 1 修复） |
| 新增 | NEW:sillyhub-daemon/tests/interactive/git-command-guard.test.ts | guard 单测：复合命令拆段/绕过形态/msg 多段拼接/pathspec/-a/-C/预填规则 |
| 新增 | NEW:sillyhub-daemon/tests/interactive/git-executor.test.ts | executor 单测：暂存区重整语义/commit/push 成败路径/拒绝不动暂存区 |
| 新增 | NEW:backend/app/modules/daemon/session/service/git_diff.py | 会话级单文件 diff service：定位会话 worktree 根（复用 git_status.py 同款探测）→ daemon RPC git_worktree_diff |
| 修改 | backend/app/modules/daemon/router/__init__.py | task-09 执行期补登：_ENDPOINT_ORDER 端点表登记 get_session_git_diff（断言面闸门要求，109→110 端点同步） |
| 修改 | backend/app/modules/daemon/router/session_crud.py | 新增 GET /api/daemon/sessions/{id}/git-diff?path= 只读端点（挂 git_status 同文件就近），调 git_diff service |
| 新增 | NEW:frontend/src/components/daemon/git-approval-card.tsx | git 确认对话卡：commit 态（msg 编辑+目录树勾选+增删统计+diff 入口）/push 态（目标+警示+待推送列表）/拒绝态（快捷原因+自由填写）；props-only，消费 dialog_payload，回传走现有 respondSessionPermission(dialog_result) |
| 修改 | frontend/src/components/daemon/pending-dialog-dock.tsx | dialog_kind='git_approval' 分流渲染 GitApprovalCard（分流点在 :137-152 请求 map，现一律渲染 AskUserDialogCard 需扩展 kind 判别；:165 仅胶囊标注） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 页内模式：pendingRequests 渲染接线（与 AskUser 卡同层） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 弹窗模式：同款接线（双模式挂载契约） |
| 新增 | NEW:frontend/src/components/daemon/__tests__/git-approval-card.test.tsx | 卡片组件测试：三分流渲染/勾选与目录级勾选交互/msg 编辑/提交与拒绝流/payload 边界 |
| 新增 | frontend/src/components/prototype/git-approval-view.tsx | 原型源（已随本变更落地并登记进 prototype-build.mjs VIEWS；批准冻结） |
| 修改 | frontend/scripts/prototype-build.mjs | VIEWS 数组登记 git-approval-view（已落地） |
| 修改 | frontend/src/lib/api-types.ts | 规则 21 义务生成物：task-09 端点 schema 落地后 pnpm gen:types 重新生成（producer=backend openapi → consumer=前端 git-diff 调用与类型） |
| 修改 | sillyhub-daemon/src/api-types.ts | 规则 21 义务生成物：同上 daemon 侧 pnpm -C sillyhub-daemon gen:types（断言面闸门⑨） |
| 修改 | backend/openapi.json | 规则 21 义务生成物：git-diff 端点进 openapi 导出 |

## 接口定义

```typescript
// sillyhub-daemon/src/interactive/git-command-guard.ts（纯函数，无副作用）

/** 拆解一段 shell 命令后识别出的 git 写操作意图；未命中返回 null（放行原路径）。 */
export interface GitCommandIntent {
  operation: "commit" | "push";
  /** push 的执行载体：裸 git push / sillyspec push CLI（后者压扁+推送，确认后原样代执行）。 */
  runner: "git" | "sillyspec";
  /** 命中段原始命令文本（供卡片展示 agent 意图；代执行 sillyspec 时原样执行）。 */
  command: string;
  /** commit：解析出的 msg（-m 多段拼接；无则空串）；push 恒空。-F 场景见 messageFile。 */
  message: string;
  /** commit：-F 指定的 msg 文件路径（guard 纯函数不读盘，挂载层读取内容填 payload.message；填卡勘误裁定）。 */
  messageFile: string | null;
  /** commit：命令显式指定的 pathspec（未指定为 null，配合 -a 标志判定预填）。 */
  pathspec: string[] | null;
  /** commit：是否带 -a（全部 tracked 改动）。 */
  allTracked: boolean;
  /** push：目标 remote/ref（位置参数；缺省 null → 默认 origin+当前分支）。 */
  pushTarget: { remote: string | null; ref: string | null };
  /** git -C 指定的工作目录（无则 cwd）。 */
  workDir: string | null;
}

export function detectGitWriteIntent(command: string): GitCommandIntent | null;

/** 预填勾选规则（D-012）：pathspec→勾 pathspec；-a→勾全部 tracked；都无→勾暂存区；暂存区空→勾全部改动。 */
export function resolveDefaultSelection(
  intent: GitCommandIntent,
  status: WorkspaceStatus,
): Set<string>;
```

```typescript
// dialog_payload（daemon 组装 → 前端消费；backend dict 透传零改动）
interface GitApprovalPayload {
  operation: "commit" | "push";
  command: string;            // 命中段原始命令
  worktree: string;           // 工作目录绝对路径
  branch: string;             // 当前分支
  message: string;            // 解析出的 commit msg（可空）
  remoteTarget?: string;      // push：remote/ref 展示串
  runner?: "git" | "sillyspec"; // push：执行载体（sillyspec=压扁+推送，卡片提示压扁语义）
  protectedBranch?: boolean;  // push：main/master 警示（D-006）
  /** push：待推送提交按条明细（≤20 条，超出显统计行；每条含首行+作者+日期+该提交文件清单，D-014/D-015）。 */
  aheadCommits?: {
    sha: string;
    subject: string;
    author: string;
    date: string;
    /** 该提交的文件明细（name-status + numstat 一次采集），展开态目录树展示（纯浏览不可勾选）。 */
    files: { path: string; status: "added" | "modified" | "deleted" | "renamed"; addLines: number; delLines: number }[];
  }[];
  files: {
    path: string;
    status: "added" | "modified" | "deleted" | "untracked";
    staged: boolean;          // 是否在暂存区
    addLines: number;         // numstat（staged 取 --cached 口径）
    delLines: number;
  }[];
  defaultSelected: string[];  // 预填勾选（resolveDefaultSelection 产出）
}

// dialog_result（前端组装 → daemon 消费）
interface GitApprovalResult {
  action: "approve" | "reject";
  message: string;        // 用户改后的 commit msg（approve+commit 必填）
  selectedFiles?: string[]; // approve+commit：最终勾选
  reason?: string;        // reject：拒绝原因
}
```

```typescript
// sillyhub-daemon/src/interactive/git-executor.ts
export interface GitExecResult { ok: boolean; text: string; sha?: string }

/** 批准路径：commit 流精确重整暂存区（reset 仅「已暂存但未勾选」、add 仅「勾选但未暂存」，
 *  不裸 reset——共享工作区他人 staged 文件不动，D-018）→ commit（用户改写的 msg）；
 *  push 流按 runner 分流——runner=git 代执行 git push；runner=sillyspec 原样代执行 agent
 *  原始命令（不附加任何参数，输出原样回喂）。结果文本回喂 agent。 */
export function executeGitApproval(
  intent: GitCommandIntent,
  result: GitApprovalResult,
  ctx: { cwd: string; sessionId: string },
): Promise<GitExecResult>;
```

```python
# backend/app/modules/daemon/session/service/git_diff.py
async def get_session_git_diff(session_id: str, path: str, user) -> GitDiffResponse:
    """定位会话 worktree 根（复用 git_status.py 探测）→ daemon RPC git_worktree_diff → 统一 diff 文本。"""
```

### 对外字段数据流标注（dialog_payload / dialog_result，producer→consumer 全链）

- `dialog_payload`（producer=daemon `git-command-guard` 采集组装）→ `PermissionResolver.register()` 序列化 → WS `PERMISSION_REQUEST`（backend `protocol.py:265` `dialog_payload: dict | None` 自由 dict 透传，零结构改动）→ `permission_service.handle_permission_request` 落库 `session_dialog_requests` + SSE `permission_request` 事件原样携带 → consumer=前端 `GitApprovalCard` 解析渲染（组件内局部 interface，不强类型化 openapi）。
- `dialog_result`（producer=前端 `GitApprovalCard` 用户操作组装：action/message/selected_files/reason）→ 现有 `respondSessionPermission` POST（`frontend/src/lib/daemon/sessions.ts:98` 已带 dialog_result 参数，零改动）→ backend `respond_permission` → WS `PERMISSION_RESPONSE`（`protocol.py:293` `dialog_result: dict | None` 透传）→ consumer=daemon `permission.ts` 响应分发 → `git-executor` 消费执行。
- `GET .../git-diff` 响应（producer=daemon RPC `git_worktree_diff` → backend `git_diff.py` 转发）→ consumer=`GitApprovalCard` diff 弹窗（复用 `DiffBody` 渲染）。此端点需进 openapi 并 `pnpm gen:types` + `pnpm -C sillyhub-daemon gen:types` 双跑（规则 21 义务）。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| git approval request | daemon（canUseTool 拦截） | backend（WS PERMISSION_REQUEST） | request_id, session_id, dialog_kind="git_approval", dialog_payload（结构见接口定义） | agent turn 内工具调用挂起（无 turn 状态迁移）；dialog 行落 `session_dialog_requests` pending |
| git approval response | 前端（POST permissions/{id}/response） | backend → daemon（WS PERMISSION_RESPONSE） | request_id, decision: allow/deny, dialog_result（action/message/selectedFiles/reason） | dialog 行 pending → resolved；daemon promise settle → 代执行或拒绝回喂 |
| git executed result | daemon（executor） | agent（Bash 工具结果回喂） | ok, text（含 sha/失败 stderr/拒绝原因） | agent 工具调用完成，turn 继续 |
| refresh recovery | 前端（GET sessions/{id}/dialogs） | backend | session_id | 恢复 pending git_approval 卡（现有 dialogs 端点零改动复用） |
| diff on demand | 前端（GET sessions/{id}/git-diff） | backend → daemon RPC git_worktree_diff | session_id, path | 无状态（只读） |

注：本表**不引入新的生命周期状态机**——复用 dialog 通道现有 pending/resolved 两态与 turn 既有状态迁移；表内事件均有对应代码任务（W1-W4）与测试任务（见风险登记对账）。

## 数据模型

无表结构变更。`session_dialog_requests` 现有 JSON 列承载 `git_approval` 的 dialog_payload/dialog_result（dict 自由结构，backend/app/modules/daemon/protocol.py:265 现状即支持）。新增 openapi 端点 `GET .../git-diff` 仅响应 schema（`git_diff.py` 内定义），无迁移。

## 兼容策略（brownfield 必填）

- **逃生阀**：daemon 环境变量 `SILLYHUB_GIT_APPROVAL=off` 全局关闭拦截（调试/应急用），默认 on；
- **未命中命令零影响**：guard 返回 null 的命令走原 canUseTool 路径（写守卫/人工审批逻辑不变）；
- **现有 dialog_kind 不受影响**：`ask_user_question` / `plan_approval` 的分流、渲染、落库逻辑零改动；老版本前端/daemon 收到未知 `git_approval` kind 时按现有未知 kind 降级路径处理（dict 透传不解析）；
- **不改变的 API**：审批回传端点、dialogs 恢复端点、SSE 事件类型均复用零改动；新增的 git-diff 为独立只读端点，不影响既有路由；
- **拒绝路径不动暂存区**：agent 的 `git add` 状态在拒绝后原样保留，现有工作流不受影响。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 复合命令/伪装形态绕过识别层（知识库实证 `git add ... && git commit` 前缀绕过先例） | P0 | guard 拆 `&&`/`\|\|`/`;`/`\|` 逐段匹配 + 单测覆盖绕过形态；base64 decode 等怪异形态登记已知限制（非目标） |
| R-02 | dialog 挂起期间 turn 被平台 >60s 静默自动重置（`PLATFORM_NO_RUNNING_TURN` fail-closed，本设计会话已实证该机制生效） | P0 | W1 实现时核实 resolver 挂起期间 turn_phase 心跳持续（AskUser dialog 先例已在生产长驻，预期无碍）；若心跳断则补挂起期心跳，并在 W5 联调验证刷新+长等待场景 |
| R-03 | 大工作区 payload 体积（几百文件×numstat；push 态另有 aheadCommits[].files 20 提交×数百文件）超过 dialog 落库/SSE 载荷限制 | P1 | W1 实测 `session_dialog_requests` payload 列容量与 SSE 8KB 截断（`publish_session_event` 截断先例）；超限时截断：工作区 files >500 仅传统计+pathspec 语义、aheadCommits 每提交 files >50 截断为统计行（卡片提示用 git-log 页查看全量） |
| R-04 | 暂存区重整（reset→add）与 agent 后续操作的状态耦合：用户减选文件后，agent 下一轮依赖旧暂存区的假设失效 | P1 | 批准执行=用户意图优先（设计语义如此）；回喂文本明确列出实际提交文件集，agent 可据此校准；拒绝路径不动暂存区 |
| R-05 | push 需要远端凭据，daemon 代执行环境与 agent shell 环境的 credential helper 差异 | P1 | 代执行继承 daemon 进程环境（与 agent 同机同用户，credential helper 一致性高）；失败时 stderr 原样回喂，agent/用户可感知；W5 联调实测一次真实 push |
| R-06 | 多请求并发：同会话 agent 快速连续触发两次 git 操作 | P2 | 复用 dialog 队列现成机制（一次一个 dialog，后续排队）；W4 卡片测试覆盖队列场景 |
| R-07 | Windows 路径/编码坑（porcelain path 分隔符空格、中文路径；`git log --name-status` 的 R（rename）条目 old/new 双路径解析同款实证坑） | P2 | porcelain v2 解析按实证坑处理（空格分隔）；rename 条目取 new 路径并归入 renamed 状态；单测含中文/空格路径 fixture |
| R-08 | 原型已落地文件（prototype 两项）随本变更提交，若用户后续改原型须重编译对账 | P2 | 批准冻结：源码+产物一起提交；后续改动重跑 pnpm prototype:build |
| R-09 | `sillyspec push` 漏拦：CLI 内部自行 git push 不经 agent Bash，只认 `git push` 的识别层拦不住本仓规范推送路径（用户 2026-11-06 指出） | P0 | guard 扩展识别 `sillyspec push`（`--dry-run`/`--no-push`/`--undo` 无推送副作用不拦；默认/`--mode`/`--remote`/`--branch` 拦）；确认后原样代执行整条命令（压扁语义保留）；单测覆盖 sillyspec push 各参数形态 |
| R-10 | 代执行 sillyspec push 与 CLI 锁（`<git-common-dir>/sillyspec-push.lock` 串行化）竞态：agent 后续再跑 sillyspec push 时代执行仍在进行 | P2 | 代执行与 agent 的 Bash 同为同机进程，CLI 自带锁串行化；executor 等待锁释放即可（超时按失败回喂） |
| R-11 | 后台锚点态（backgroundTask）dialog 走 5min 兜底 deny：后台任务 git 提交自动拒绝（fail-safe 合理）；超时 deny 为 daemon 本地 settle，backend dialog 行仍 pending，用户点击旧卡会报 unknown_request（无害但观感差） | P2 | W4 覆盖清卡路径测试：用户点击后的 respond→resolved SSE 正常清卡；会话 ended/failed 门控（dock :95-98）兜底清卡；unknown_request 响应静默降级。行为语义本身接受（后台任务不提交，D-019） |
| R-12 | 仅写校验分支补 resolver 接线后，无 manual_approval 会话首次走 WS 审批链路的时序风险（resolver 通道初始化晚于首个 git 命令） | P1 | W1 实现时 resolver 构造随会话启动（与 approvalReady 分支同时机），单测覆盖「会话启动即拦截可达」；W5 联调含无 manual_approval 会话端到端 |

无长驻进程/外部资源新增（git-executor 为短命 spawn 子进程，执行完即退；挂起等待复用现有 resolver promise，无新资源持有）——生命周期面不适用（显式留痕）。

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 默认全局生效 | 总体方案·W1（挂载不依赖 manual_approval，逃生阀仅环境变量） | 已覆盖 |
| D-002@v1 daemon 代执行 | 总体方案·W2 + 接口定义 executeGitApproval | 已覆盖 |
| D-003@v1 只拦 commit/push | 非目标 + guard 识别范围 | 已覆盖 |
| D-004@v1 长驻不超时 | 生命周期契约表（dialog 通道 pending/resolved 两态复用） | 已覆盖 |
| D-005@v1 只覆盖交互式会话 | 非目标（批处理/团队分身明确排除） | 已覆盖 |
| D-006@v1 push 保护分支警示不硬拦 | 前端确认卡·push 态（protectedBranch 警示徽标） | 已覆盖 |
| D-007@v1 拒绝原因回喂 | 接口定义 GitApprovalResult.reason + executor 拒绝路径 | 已覆盖 |
| D-008@v1 方案 A（审批管线复用） | 总体方案全链（backend/回传 API 零改动实证） | 已覆盖 |
| D-009@v1 UI 锚定 AskUser 卡 | 前端确认卡（PendingDialogDock 挂载 + 双模式） | 已覆盖 |
| D-010@v1 落选方案 B（hook） | rejected 记录（decisions.md），非目标未复潮 | 已登记 |
| D-011@v1 落选方案 C（API 化） | rejected 记录（decisions.md），非目标未复潮 | 已登记 |
| D-012@v1 目录树+增删统计 | 前端确认卡·文件列表（buildFileTree 形态 + numstat 双口径） | 已覆盖 |
| D-013@v1 sillyspec push 识别覆盖 | guard 识别范围 + executor runner 分流（原样代执行）+ R-09 | 已覆盖 |
| D-014@v1 push 卡提交按条明细 | payload aheadCommits 结构（sha/subject/author/date）+ 前端 push 态逐条渲染 | 已覆盖 |
| D-015@v1 推送提交可展开文件明细 | payload aheadCommits[].files + 前端展开态目录树（纯浏览） | 已覆盖 |
| D-016@v1 仅写校验分支补 git 审批接线 | W1 + 文件清单 driver-factory.ts 行 + R-12（审查阻断项 1 修复） | 已覆盖 |
| D-017@v1 git 拦截先于 askUserOnly 放行 | W1（permission.ts 分支位置） | 已覆盖 |
| D-018@v1 精确暂存区重整（不裸 reset） | 总体方案·代执行 + executor 注释 | 已覆盖 |
| D-019@v1 后台锚点态 5min 兜底 deny | 前端确认卡·后台锚点态 + R-11 | 已覆盖 |

多裁定组合推演：D-001（全局生效）×D-004（长驻等待）组合 → 任何会话的 git 挂起都可能长时间占住 dialog 通道——已核实 dialog 队列支持多请求排队（R-06），且挂起不迁移 turn 状态（生命周期契约表），无死锁格；D-002（代执行）×D-005（仅交互会话）组合 → 批处理无挂起点，无组合约束面。其余裁定互不作用，无组合约束。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-001~D-012（决策追踪表全覆盖）
- [x] 涉及 session/daemon 关键词 → 生命周期契约表已填（含豁免说明：不引入新状态机）
- [x] UI 原型分级核对：prototype-git-approval.html 已随变更目录交付（真码管线编译产物，源 git-approval-view.tsx 带素材来源声明；三态可切三主题）
- [x] ~~⚠️ 自审存疑③~~ **独立审查已证伪并修复**：原自审称「两分支共用回调需二次核实」——审查实证 `driver-factory.ts:375` 仅写校验分支注入独立构造器 `_buildWriteOnlyCanUseToolCallback`（无 resolver/WS），两分支**不共用**回调；已按 D-016 补 driver-factory 接线（见文件清单与 W1）
- [ ] ⚠️ 自审存疑：①R-02 turn 心跳核实（W1 实现期核实点，审查已确认 dialog 长驻先例成立，仅 backgroundTask 态有 5min 兜底——R-11 已登记）；②R-03 payload 容量实测（W1 实测点）；③R-12 无 manual_approval 会话 resolver 接线时序（W1 单测覆盖）
