---
author: WhaleFall
created_at: 2026-07-30T15:45:54
---

# 设计文档（Design）— daemon 心跳卡死 + 回复重复修复

> 变更 `2026-07-30-daemon-heartbeat-dedup-fix` · 方案 A（照搬 thinking 成熟机制）

## 1. 背景

sillyhub-daemon 有两个核心 bug：

1. **心跳卡死**：daemon 启动后跑约 2 分钟，事件循环冻死（`_heartbeatLoop` 排不上、backend `last_heartbeat` 停更），backend 标 offline。node 进程还活（不崩溃退出，占内存正常）。重启必复现。**阻塞一切**（daemon 起不来，无法跑会话验证任何修复）。
2. **回复重复**：会话里 agent 回复「半截+全文」双发（实测 7fb9227d logs #35 = #30+#31 累积重复）。

调研（Explore 子代理 + Design Grill）确诊根因：

- **卡死根因**：`_syncAllowedRoots`（daemon.ts:1930-1933）变化检测口径不一致 —— 比较时用 `normalizeAllowedRoots()`（config.ts:533-560，只 `path.resolve`，保留原始大小写）vs 缓存 `PolicyCache.set()`（runtime-policy.ts:56-63，存时多跑 `resolveRealPath`，path-utils.ts:70-90，Windows 盘符强制小写 + realpath symlink/junction）。Windows 上两值永不等 → 每次心跳 `changed=1` → 每 15s 触发 `PolicyCache.set` → `resolveRealPath` 同步 `existsSync`/`realpathSync` 风暴（事件循环主线程）→ 某拍撞慢卷/杀软扫描单次飙数十秒 → 事件循环冻死 → `_heartbeatLoop` 排不上 → 无心跳。2 分钟 = 累积概率（15s × 8 拍）。自愈 `_fire` catch 不触发（卡死不抛不退）。WS/HTTP 心跳本身无问题（已排除，hub-client.ts:294-313 有 30s 超时）。
- **重复根因**：daemon claude interactive 流式，partial flush 半截（`[ASSISTANT]` 半截）已发出，完整 message 到达又发全文，override 机制 `_emitOverrideSignals`（session-manager.ts:2828-2849）硬编码只撤回 thinking、漏 assistant，且 partial flush 的 assistant（:2714-2722）没带 segmentId → 已 flush 半截 + 完整全文双发。backend `flushed_partials` 去重（run_sync/service.py:436-448）只覆盖 thinking，assistant complete + partial 都落库 → #35 重复。辅助：interactive 转发 `dedup_key` 退化 timestamp（daemon.ts:1605 + error-classify.ts:96-100）。

## 2. 设计目标

- daemon **持续 online**（事件循环不冻死，>2min 不卡，backend 不标 offline）
- agent 回复**不重复**（半截被全文覆盖/撤回，#35 不再双发）
- 照搬 thinking 成熟机制（口径统一 + override + 删 partial），不发明新机制
- `isPathUnderAnyRoot` sandbox 路径权限判定保持正确（测试覆盖）

## 3. 非目标

- ❌ 不改前端（格式已 ql-20260730-004 修复）
- ❌ 不改 agent 行为/提示词
- ❌ 不改 thinking 现有机制（只照搬其 override + 删 partial 到 assistant，不改 thinking 本身）
- ❌ 不改 backend lease/session/agent_run/runtime 状态机
- ❌ 不重写 WS/HTTP 心跳（已确认无问题）

## 4. 拆分判断

单一变更，不拆分。理由：两个 bug 同属 daemon 核心（卡死 + 重复），且重复修复要照搬 thinking 机制（daemon override + backend 删 partial），与卡死修复（PolicyCache 口径）在同一批 daemon 文件，应一起端到端修完 + 一起验证（daemon online 后实跑验证两 bug）。卡死优先（Wave 分组）解阻塞。

## 5. 总体方案（分 Wave，plan 细化）

**方案 A：照搬 thinking 全套**

### Wave 1 — 卡死修复（sillyhub-daemon，优先解阻塞）
- `PolicyCache.set`（runtime-policy.ts:56-63）：去掉 `resolveRealPath`，只存 `normalizeAllowedRoots` 归一字符串。统一口径。
- `isPathUnderAnyRoot`（path-utils.ts:149-169）：比较时补 `resolveRealPath`（realpath 下沉到判定时），确保 sandbox 路径判定正确。
- `_syncAllowedRoots`（daemon.ts:1930-1933）：加短路（`normalized` 与缓存 `JSON.stringify` 相同则 return）。即使口径修了也防无谓重算。
- 口径统一后，`register`（daemon.ts:1022）/`_syncPolicyCache`（:1973）/`_handlePolicyUpdate`（:2010）三处 set 自动一致，spam 根除 → 不再每拍同步 stat 风暴 → 事件循环不冻。
- 可选增强：`resolveRealPath` 异步化/加超时（防慢卷）；看门狗自愈（心跳周期漂移 → `process.exit` 让外部 supervisor 重启）。

### Wave 2 — 重复修复（sillyhub-daemon + backend）
- daemon `_emitOverrideSignals`（session-manager.ts:2828-2849）：扩展，assistant 完整 message 到达时 emit `[ASSISTANT_OVERRIDE] <segmentId>`（对齐 `[THINKING_OVERRIDE]`）。partial flush 的 assistant（:2714-2722）带 segmentId。
- daemon `_extractCompletedSegments`（:2469）：扩 assistant text block（不再只 `block.type==='thinking'`）。
- backend `run_sync/service.py`：识别 `[ASSISTANT_OVERRIDE]`，删同 segmentId 的 assistant partial 行（对齐 thinking 的 `flushed_partials` 删 partial，:436-448）。`_extract_sdk_messages`（:1834-1845）给 assistant text block 打 segmentId。
- daemon interactive 转发 `dedup_key` 补 seq（daemon.ts:1605 + error-classify.ts:88-101），双保险。

### Wave 3 — 测试 + 实跑验证
- daemon：`isPathUnderAnyRoot` 路径判定测试（子路径/junction/大小写/不存在）；`PolicyCache` 口径统一 + `_syncAllowedRoots` 短路测试；心跳持续（mock 慢卷 stat 不冻死）；assistant override 删 partial 测试。
- backend：assistant override 删 partial 测试（对齐 thinking）。
- 实跑：daemon 持续 online（>2min 不卡）+ 回复不重复（#35 场景）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/policy/runtime-policy.ts | `PolicyCache.set`（:56-63）去 `resolveRealPath`，只存归一字符串 |
| 修改 | sillyhub-daemon/src/policy/path-utils.ts | `isPathUnderAnyRoot`（:149-169）比较时补 `resolveRealPath`（下沉） |
| 修改 | sillyhub-daemon/src/daemon.ts | `_syncAllowedRoots`（:1930-1933）加短路 |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | `_emitOverrideSignals`（:2828-2849）扩 assistant emit `[ASSISTANT_OVERRIDE]`；`_extractCompletedSegments`（:2469）扩 assistant；partial flush（:2714-2722）带 segmentId |
| 修改 | sillyhub-daemon/src/daemon.ts（:1605）+ src/resilience/error-classify.ts（:88-101） | interactive 转发 `dedup_key` 补 seq |
| 修改 | backend/app/modules/daemon/run_sync/service.py | 识别 `[ASSISTANT_OVERRIDE]` 删 assistant partial（:436-448 扩）；`_extract_sdk_messages`（:1834-1845）给 assistant text block 打 segmentId |
| 新增/修改 | sillyhub-daemon/tests/ + backend/tests/ | 路径判定、PolicyCache 口径、短路、override 删 partial 测试 |

## 7. 接口定义

**PolicyCache 口径统一**（realpath 下沉到判定）：
```ts
// runtime-policy.ts PolicyCache.set —— 改后只存归一字符串，不 resolveRealPath
set(runtimeId, roots) { this.map.set(runtimeId, normalizeAllowedRoots(roots)); }
// path-utils.ts isPathUnderAnyRoot —— 比较时 resolveRealPath
function isPathUnderAnyRoot(target, roots) {
  const realTarget = resolveRealPath(target);
  return roots.some(r => isPathUnder(realTarget, resolveRealPath(r)));
}
```

**assistant override 信号**（对齐 thinking）：
```ts
// daemon session-manager.ts —— assistant 完整 message 到达时
emit `[ASSISTANT_OVERRIDE] ${segmentId}`   // 对齐 [THINKING_OVERRIDE]
// backend service.py —— 识别 override 删 partial（对齐 thinking flushed_partials）
if (msg.kind === 'assistant_override') flushed_partials.delete(segmentId)
```

（精确字段名在 execute 阶段对齐 thinking 现有实现。）

## 7.5 生命周期契约

生命周期契约：无/N/A。本次只修 daemon 心跳的「事件循环冻死」bug（PolicyCache 路径归一口径 + 短路）和 assistant 流式文本的「半截+全文双发」去重（override + 删 partial），**不涉及 lease / session / agent_run / runtime 的状态机或状态转换**，不改心跳/lease 协议字段（lease_heartbeat 仍走原 HTTP 心跳）。照搬 thinking 现有 override 机制到 assistant，不新增生命周期事件。

## 8. 风险登记

- **R1（高）**：`isPathUnderAnyRoot` 是 sandbox 路径权限判定（安全相关），口径改动（realpath 下沉到比较时）若实现错误会导致路径越权/误判。缓解：Wave 3 重点测试覆盖（子路径/junction/大小写/不存在/符号链接）；对照现有 thinking 路径判定用例。
- **R2（中）**：`PolicyCache.set` 去 `resolveRealPath` 后所有消费方（register/_syncPolicyCache/_handlePolicyUpdate）口径变化，遗漏的 set/比较点会破坏一致性。缓解：grep 全部 `PolicyCache.set` + `isPathUnderAnyRoot` 调用点统一口径 + 测试。
- **R3（中）**：assistant override + backend 删 partial 跨 daemon/backend 两层，segmentId 透传/识别不一致会漏删 partial（重复残留）。缓解：对齐 thinking 的 segmentId 透传链路，backend 测试覆盖。
- **R4（低）**：`resolveRealPath` 同步 stat 仍存在（下沉到 isPathUnderAnyRoot），慢卷仍可能阻塞单次判定。缓解：Wave 1 可选异步化/超时；看门狗自愈兜底。

## 9. 自审（Self-Review）

- ✅ 覆盖两个 bug：卡死（PolicyCache 口径 + 短路）+ 重复（照搬 thinking override + 删 partial）
- ✅ 照搬 thinking 成熟机制，不发明新机制（降低风险）
- ✅ 卡死优先（Wave 1）解阻塞，daemon online 后实跑验证两 bug
- ✅ isPathUnderAnyRoot 安全判定重点测试（R1）
- ✅ 不碰前端（ql-004 已修格式）/agent/thinking 机制/状态机
- ⚠️ 待 execute 确认：PolicyCache 所有 set/比较点（grep 全覆盖）；assistant override 信号格式与 thinking 完全对齐；backend flushed_partials 扩 assistant 的精确位置（对齐 thinking :436-448）
- ⚠️ 待 execute 确认：resolveRealPath 异步化是否本轮做（R4 可选增强）
- ✅ 测试覆盖路径判定、口径统一、短路、override 删 partial、实跑 >2min online + 不重复

## 10. 决策与方案选择（Decision Tracking）

> 以下决策为 §1-§9 方案的关键技术抉择显式化，便于 plan 拆任务时锁定口径。

| 决策 ID | 标题 | 选项（✅采纳 / ❌否决） | 覆盖位置 |
|---|---|---|---|
| D-001@v1 | 卡死口径：realpath 下沉到判定，不进缓存 | ✅ `PolicyCache.set` 去 `resolveRealPath` 只存归一字符串 + `isPathUnderAnyRoot` 比较时 `resolveRealPath`（target + 每 root）；❌ 保留 set 的 `resolveRealPath` 改比较侧同步 resolve（仍每拍 stat，治标）；❌ 直接异步化 `resolveRealPath`（改面大，留 R4 实跑后定） | §5 Wave1、FR-01/FR-03 |
| D-002@v1 | 重复机制：照搬 thinking override + 删 partial，不发明新机制 | ✅ assistant 完整 message emit `[ASSISTANT_OVERRIDE]`（对齐 `[THINKING_OVERRIDE]`）+ backend `flushed_partials` 扩 assistant 删 partial；❌ 前端去重（应产生侧 backend 处理，前端 ql-004 仅修格式）；❌ daemon 不再 partial flush assistant（破坏流式体验） | §5 Wave2、FR-02 |
| D-003@v1 | Wave 顺序：卡死 Wave1 优先解阻塞 | 卡死阻塞一切（daemon offline 无法实跑验证重复），必须先修 + 部署 online 后才能实跑验证两 bug | §5 Wave 分组 |
| D-004@v1 | `_syncAllowedRoots` 加短路（双保险） | 口径修了仍加 `JSON.stringify(normalized)===缓存` 则 return，防无谓重算 + 防将来口径回归 | §5 Wave1 task-03 |
| D-005@v1 | R4 `resolveRealPath` 异步化本轮不做 | 口径+短路若已消除风暴（实测 online >2min）则不异步化；若仍卡再加异步化 + 看门狗自愈兜底。视 Wave1 实跑结果决定 | §8 R4、§9 自审、FR-01 约束 |
