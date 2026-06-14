---
author: qinyi
created_at: 2026-06-14T17:52:18
change: 2026-06-14-unified-agent-execution
stage: plan
id: task-07
title: A4 diff 50KB 截断 + stat_summary 生成 + 后端 redact 二次脱敏
priority: P0
depends_on: [task-05]
blocks: [task-12]
allowed_paths:
  - sillyhub-daemon/src/workspace.ts
  - sillyhub-daemon/src/task-runner.ts
  - backend/app/modules/daemon/service.py
  - sillyhub-daemon/src/__tests__/diff-truncate.test.ts
---

# task-07: A4 diff 50KB 截断 + stat_summary + 后端 redact 二次脱敏

## 修改文件

- `sillyhub-daemon/src/workspace.ts` — `collectDiff`(156-181) 增加 patch 50KB 截断（≤ 51200 chars，超出加 `\n...[truncated]` 尾标）+ 生成 `stat_summary` 人可读串（对齐后端 `diff_collector.py` 的 stat_summary = redact 后的 shortstat 原文）；新增 `MAX_PATCH_CHARS = 51_200` 常量。
- `sillyhub-daemon/src/task-runner.ts` — `runLease`(254-373) 步骤 8b（341-350）`collectDiff` 后，patch / stat_summary 已含截断，无需额外处理；confirm EMPTY_DIFF（828-834）的 stats 字段为 `stat_summary` 形态（当前 EMPTY_DIFF.stats 是空串，保持不变但语义升级为 stat_summary）。
- `backend/app/modules/daemon/service.py` — `complete_lease`(429-505) patch 入库（507-528 既有 `_apply_patch_to_worktree`）**前**，对 patch + agent_run.output_redacted 复用 `redact_output`(git_gateway/service.py:106-113) 二次脱敏；import `from app.modules.git_gateway.service import redact_output`。
- `sillyhub-daemon/src/__tests__/diff-truncate.test.ts`（新增）— patch 截断 + stat_summary 生成单测。

## 实现要求

1. `workspace.ts` 新增常量（紧邻顶部 import 区或 parseShortstat 前）：
   ```typescript
   /** diff patch 最大字符数（对齐 backend diff_collector.py:86 max_diff_size=50_000，
    *  取 50KB 字符 = 51200，留 1200 字符余量给截断标记与 stat_summary）。
    *  注：backend 用 50_000，daemon 用 51_200（含 \n...[truncated] 尾标空间），
    *  最终入库前由后端 redact_output 的 MAX_OUTPUT_SIZE 兜底再截一次。 */
   const MAX_PATCH_CHARS = 51_200;
   ```
   - **决策**：daemon 截到 51200 + 后端 redact_output 的 MAX_OUTPUT_SIZE（grep 确认 MAX_OUTPUT_SIZE 值；若 < 51200 则后端会再截，无害）。**对齐 backend diff_collector.max_diff_size=50_000**——daemon 取 50_000 更精确，本任务采用 **50_000**（与后端一致，避免双标准）。**最终值：MAX_PATCH_CHARS = 50_000**。
2. `workspace.ts` `collectDiff`(156-181) 改造：
   ```typescript
   async collectDiff(workspaceDir: string): Promise<WorkspaceResult> {
     const status = await runGit(['status', '--porcelain'], workspaceDir, true);
     if (!status.trim()) {
       return { patch: '', files_changed: 0, insertions: 0, deletions: 0, stats: '' };
     }

     const shortstat = await runGit(['diff', '--shortstat'], workspaceDir, true);
     const diffOutput = await runGit(['diff'], workspaceDir, true);
     const { files_changed, insertions, deletions } = parseShortstat(shortstat);

     // 截断：超出 MAX_PATCH_CHARS 加尾标（对齐 diff_collector.py:168-170）
     let patch = diffOutput;
     if (diffOutput.length > MAX_PATCH_CHARS) {
       patch = diffOutput.slice(0, MAX_PATCH_CHARS) + '\n...[truncated]';
     }

     // stat_summary：当前既有 stats 字段已存 shortstat.trim()，语义等价 stat_summary；
     // 显式保留作人可读串（对齐 diff_collector.DiffResult.stat_summary）
     return {
       patch,
       files_changed,
       insertions,
       deletions,
       stats: shortstat.trim(),  // 即 stat_summary（redact 由后端二次处理）
     };
   }
   ```
   - **stats 字段语义对齐**：当前 `stats: shortstat.trim()`(179) 即 stat_summary（diff_collector.py:158 `stat_summary=stat_redacted`，daemon 侧未 redact 留后端）；**字段名保持 `stats` 不改 `stat_summary`**（WorkspaceResult 接口字段，task-runner.ts 344/786/833 都用 `stats`，改名牵连面大且无收益）。
3. `workspace.ts` `WorkspaceResult` 接口（grep 80-90 确认）—— **无需改字段**，stats 注释补「即 stat_summary 人可读串」。
4. `task-runner.ts` 步骤 8b（341-350）—— **无需改动**：
   - collectDiff 已含截断，diff.patch 直接用；
   - EMPTY_DIFF.stats = ''（833）保持，作为「无改动」的 stat_summary 空串语义。
5. `backend/app/modules/daemon/service.py` `complete_lease`(429-505) patch 入库前 redact：
   ```python
   # Patch application（既有 507-528）
   patch = result.get("patch")
   if patch and lease.agent_run_id is not None:
       # 新增：二次脱敏（对齐 diff_collector.py:174 redact_output(diff_truncated)）
       # redact 单一真相源：后端 git_gateway.redact_output，daemon 不移植正则规则
       patch = redact_output(patch) if isinstance(patch, str) else patch
       patch_data = json.dumps(patch) if isinstance(patch, dict) else str(patch)
       try:
           await self._apply_patch_to_worktree(...)
   ```
   - **output_redacted 入库前也 redact**（既有 454-460）：
     ```python
     if result.get("output"):
         agent_run.output_redacted = redact_output(result["output"])  # 加 redact_output 包裹
     if result.get("error"):
         existing = agent_run.output_redacted or ""
         agent_run.output_redacted = (
             existing + ("\n" if existing else "") + redact_output(result["error"])
         )
     ```
   - **import**：文件顶部补 `from app.modules.git_gateway.service import redact_output`（确认 git_gateway 已 import 或新增）。
   - **stat_summary redact**：daemon 上报 stats（即 stat_summary）字段也应 redact —— 在 `result.get("stats")` 读取处对 stats.stats 做 redact（若 stats dict 含 stats 子字段）；**简化方案**：redact_output 已覆盖 PAT/bearer/URL token，stats 字段是 shortstat 数字文本（`3 files changed, 10 insertions(+)`），不含敏感信息，**跳过 stats redact**（YAGNI）。
6. 新增测试 `__tests__/diff-truncate.test.ts`：
   - case1（截断）：mock runGit `diff` 返回 60_000 字符的 patch → collectDiff 返回 `patch.length === 50_000 + '\n...[truncated]'.length`（50_014）；files_changed/insertions/deletions 来自 parseShortstat 不变。
   - case2（未超）：mock diff 返回 1000 字符 → patch 原样返回，无尾标。
   - case3（空 diff）：status --porcelain 返回空 → 零值 diff（patch='', stats='', files_changed=0...）。
   - case4（stat_summary）：mock shortstat = ` 3 files changed, 10 insertions(+), 2 deletions(-)` → stats 字段 = 该字符串 trim 后；files_changed=3, insertions=10, deletions=2（parseShortstat 验证既有逻辑）。
   - case5（后端 redact）：python pytest 补 case，patch 含 `Authorization: Bearer sk-ant-xxx` → complete_lease 后 patch_data 含 `***REDACTED***`（在 backend/app/modules/daemon/tests/ 补 case，本任务测试文件侧重 daemon 侧；后端 case 可放 task-11 或本任务 __tests__/diff-truncate.test.ts 用子目录）。

## 接口定义

```typescript
// workspace.ts
const MAX_PATCH_CHARS = 50_000;  // 对齐 backend diff_collector.py:86 max_diff_size

interface WorkspaceResult {
  patch: string;         // 截断后（≤ 50014 含尾标）
  files_changed: number;
  insertions: number;
  deletions: number;
  stats: string;         // 即 stat_summary = shortstat.trim()（redact 留后端）
}

class Workspace {
  async collectDiff(workspaceDir: string): Promise<WorkspaceResult>;
  // 截断逻辑：diffOutput.length > MAX_PATCH_CHARS 时 slice(0, MAX) + '\n...[truncated]'
}
```

```python
# backend/app/modules/daemon/service.py
from app.modules.git_gateway.service import redact_output

class DaemonLeaseService:
    async def complete_lease(self, lease_id, claim_token, result):
        # 既有 454-460：output/error redact_output 包裹
        if result.get("output"):
            agent_run.output_redacted = redact_output(result["output"])
        if result.get("error"):
            existing = agent_run.output_redacted or ""
            agent_run.output_redacted = existing + ("\n" if existing else "") + redact_output(result["error"])
        # 既有 507-528：patch redact_output 包裹（入库前）
        patch = result.get("patch")
        if patch and lease.agent_run_id is not None:
            patch = redact_output(patch) if isinstance(patch, str) else patch
            patch_data = json.dumps(patch) if isinstance(patch, dict) else str(patch)
            await self._apply_patch_to_worktree(...)
```

## 边界处理

1. **null/空值**：collectDiff 在 status 为空时返回 EMPTY_DIFF（patch='' / stats=''）；task-runner 既有 `let diff = { ...EMPTY_DIFF }`(344) 初始化兜底 collectDiff 抛错场景；后端 `if patch and lease.agent_run_id`(509) 空字符串跳过 patch 应用。
2. **兼容性 brownfield**：MAX_PATCH_CHARS 是新增常量，不影响既有 collectDiff 调用方（task-runner 344）；WorkspaceResult 字段无变化；后端 redact_output 是既有函数，调用零兼容风险。
3. **异常不静默吞**：collectDiff 既有 try/catch（345-350）保护，diff 截断逻辑在 try 内同步执行不抛；后端 redact_output 是纯字符串处理（_TOKEN_PATTERN.sub）无异常源。
4. **参数不可变**：collectDiff 不修改 workspaceDir；slice(0, N) 返回新字符串不 mutate diffOutput。
5. **歧义/冲突**：
   - **双截断**：daemon 截到 50_000 + 后端 redact_output MAX_OUTPUT_SIZE（grep 确认值）。若 MAX_OUTPUT_SIZE < 50_000 则后端再截一次（无害，加第二个 `\n...[truncated]` 标记）。**建议**：确认 MAX_OUTPUT_SIZE 值（grep `MAX_OUTPUT_SIZE = ` backend/app/modules/git_gateway/）；若 < 50_000 则 daemon 取 MAX_OUTPUT_SIZE 同值，避免双重截断标记混乱。**execute 时确认后调整 MAX_PATCH_CHARS**。
   - **stats vs stat_summary 命名**：daemon 用 `stats`（WorkspaceResult 字段），backend DiffResult 用 `stat_summary`；语义相同（都是 shortstat.trim()），不强行改名（牵连 task-runner.ts 344/786/833 + types.ts）。
   - **redact 单一真相源**：daemon 不移植 redact 正则（design §A4 推荐 b 方案），后端 redact_output 是唯一规则源；daemon 侧若需展示 diff 给用户（如 daemon 本地日志）才考虑本地 redact，本任务不涉及。
6. **大 diff 测试构造**：vitest 用 `'x'.repeat(60_000)` 构造超长 patch；后端 pytest 用 `patch = "Authorization: Bearer sk-ant-xxx\n" * 1000` 构造含密钥 patch 验证 redact。
7. **git diff 失败路径**：collectDiff 内 runGit 抛错由 task-runner catch（345-350）→ diff = EMPTY_DIFF；后端收到 patch='' → 跳过 _apply_patch_to_worktree；无副作用。

## 非目标

- 不改 EMPTY_DIFF 字段名（stats 保持，不改为 stat_summary）。
- 不实现 daemon 侧 redact.ts（design 否决 a 方案，单一真相源留后端）。
- 不改 `_apply_patch_to_worktree` 内部逻辑（既有 507-528）。
- 不改前端 diff 展示（output_redacted / patch 字段消费方）。
- 不改 worktree 模块（patch 应用基础设施）。

## TDD 步骤

1. **写测试** → 新增 `__tests__/diff-truncate.test.ts` 5 case（见实现要求 6）；后端 case（含密钥 patch redact）放 task-11 或本任务 backend 测试。
2. **确认失败** → `cd sillyhub-daemon && pnpm vitest run diff-truncate`（collectDiff 无截断 → case1 patch.length === 60_000 不等于 50_014 失败）。
3. **写实现** → workspace.ts（MAX_PATCH_CHARS + 截断逻辑）→ backend service.py（import + redact_output 包裹 output/error/patch）。
4. **确认通过** → `cd sillyhub-daemon && pnpm vitest run diff-truncate` 全绿 + `cd backend && uv run pytest -q backend/app/modules/daemon/tests`（complete_lease redact case 通过）。
5. **回归** → `cd sillyhub-daemon && pnpm test`（task-runner collectDiff 调用不退化）+ `cd backend && uv run pytest -q`（既有 complete_lease 测试不退化）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `grep -n "MAX_PATCH_CHARS\|MAX_DIFF" sillyhub-daemon/src/workspace.ts` | 命中常量定义，值 = 50_000（对齐 backend diff_collector.py:86，execute 时确认 MAX_OUTPUT_SIZE 后定终值） |
| AC-02 | `grep -n "slice.*MAX_PATCH\|\\[truncated\\]" sillyhub-daemon/src/workspace.ts` | 命中截断逻辑，超长 patch 加 `\n...[truncated]` 尾标 |
| AC-03 | `grep -n "from app.modules.git_gateway.service import redact_output\|redact_output(result\|redact_output(patch" backend/app/modules/daemon/service.py` | import 存在；complete_lease 内 output(455)/error(459)/patch(510) 三处包 redact_output |
| AC-04 | `cd sillyhub-daemon && pnpm vitest run diff-truncate` | 5 case 全绿（截断 / 未超 / 空 diff / stat_summary / parseShortstat） |
| AC-05 | 构造 >100KB diff 测试（vitest mock runGit 返回 120_000 字符）| collectDiff 返回 patch.length === 50_014（50_000 + `\n...[truncated]`），不撑爆 complete_lease payload |
| AC-06 | 构造含密钥 patch 测试（backend pytest）：patch 含 `Authorization: Bearer sk-ant-xxx` | complete_lease 后 patch_data（apply_patch_to_worktree 入参）含 `***REDACTED***`，原密钥不入库；agent_run.output_redacted 同样 redact |
| AC-07 | `grep -n "diff_collector\|collect_diff" backend/app/modules/agent/service.py` | **无命中**（SERVER 侧 diff_collector 调用在 task-01/task-04 删除，本任务后端 diff 唯一来源是 complete_lease.patch）—— 与 task-01/04 交叉验证 |
