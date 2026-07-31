---
author: WhaleFall
created_at: 2026-07-30T16:35:00
plan_level: full
---

# 实现计划（Plan）— daemon 心跳卡死 + 回复重复修复

## Spike 前置验证

本变更方案 A（照搬 thinking 全套）经 brainstorm Design Grill 独立审查通过。plan Step1 已用两个 Explore 子代理逐点核对 design.md 全部 14 个代码引用点（daemon 组 A-J + backend 组 A-D），**行号当前全部准确、逻辑与 design 一致**，根因诊断（PolicyCache 口径不一致 / assistant 缺 override+segmentId）经源码确认属实，无技术不确定性，**跳过 Spike**。

补充确认（execute 锁口径用）：
- `daemon.ts:2010 _handlePolicyUpdate` 传**未 normalize 的原始 roots**（口径与 `:1022/:1973` 不同），Wave1 task-04 统一口径时一并修。
- backend `[THINKING_OVERRIDE]` 识别在 `service.py:374-394`（assistant override 对齐模板：override 信号不落库 continue / 回滚用 `expunge`（pending 未 flush，不能 `session.delete`）/ `segment_id` 从 `metadata.segmentId` 解析 :371）。
- assistant 落库走通用 INSERT 路径 `service.py:500-540`，无独立分支。

## Wave 1 — 卡死修复（优先解阻塞，daemon online 前置）

> 目标：消除每心跳 `changed=1` → `PolicyCache.set` → `resolveRealPath` stat 风暴 → 事件循环冻死。卡死阻塞一切，必须先修 + 部署 online 才能实跑验证重复。

- [x] task-01: `PolicyCache.set` 去 `resolveRealPath`，统一归一口径（runtime-policy.ts:56-63，只存 normalizeAllowedRoots 归一字符串）（覆盖：FR-01, FR-03, D-001）
- [x] task-02: `isPathUnderAnyRoot` 补 `resolveRealPath`（target + 每 root，下沉到判定）（path-utils.ts:149-169）—— **B1 安全红线**（覆盖：FR-03, D-001）
- [x] task-03: `_syncAllowedRoots` 加短路（daemon.ts:1930-1933，JSON.stringify 相同则 return）（覆盖：FR-01, D-004）
- [x] task-04: 核实并统一所有 `PolicyCache.set` / `isPathUnderAnyRoot` 调用点口径（含 `daemon.ts:2010 _handlePolicyUpdate` 未 normalize 修复）（覆盖：FR-01, FR-03, R-2）

## Wave 2 — 重复修复（照搬 thinking override + 删 partial）

> 目标：assistant 半截被全文覆盖/撤回，#35 不再双发。照搬 thinking 成熟机制（emit override + backend 删 partial），不发明新机制。

- [x] task-05: daemon partial flush assistant 带 segmentId（session-manager.ts:2714-2722，对齐 thinking :2697-2712）（覆盖：FR-02, D-002）
- [x] task-06: daemon `_extractCompletedSegments` 扩 assistant text block（session-manager.ts:2469，不再只 `block.type==='thinking'`）（覆盖：FR-02, D-002）
- [x] task-07: daemon `_emitOverrideSignals` 扩 emit `[ASSISTANT_OVERRIDE] <segmentId>`（session-manager.ts:2828-2849，metadata **不误打** `thinking:true`，B2）（覆盖：FR-02, D-002）
- [x] task-08: backend `_extract_sdk_messages` 给 assistant text block 打 segmentId + 识别 `[ASSISTANT_OVERRIDE]` 删 partial（service.py:1834-1845 + :374-394 扩，对齐 thinking flushed_partials）（覆盖：FR-02, D-002, R-3）
- [x] task-09: daemon interactive 转发 `dedup_key` 补 seq（daemon.ts:1605 + error-classify.ts:88-101，双保险）（覆盖：FR-02）

### Wave 2.1 — 重复修复完善（task-08 实跑发现不彻底，跨调用 DELETE）

> 目标：task-08 override 回退只在单次 submit_messages 内生效（expunge 撤 pending）。实跑发现
> daemon partial（半截）与 complete+override 分两次 submit_messages 到达——partial 已 commit 落库、
> override 后到时 `flushed_partials` 局部变量跨调用不共享 + AgentRunLog 无 segment_id 列定位 →
> 删不掉已落库半截 → 回复仍重复。持久化 segment_id + 跨调用 DB DELETE 已落库 partial。

- [ ] task-14: backend AgentRunLog 加 segment_id 列 + migration（down=202607301000）；service.py partial
  落库存 segment_id（complete 行 NULL）+ override 信号（ASSISTANT/THINKING）跨调用 select+session.delete
  已 commit partial（覆盖：FR-02, D-002, R-3）

## Wave 3 — 测试 + 实跑验证

> 目标：sandbox 路径判定改前改后对照 + 口径/短路/override 删 partial 单测 + daemon 实跑 online。

- [x] task-10: `isPathUnderAnyRoot` 路径判定测试（子路径/junction/大小写/不存在/symlink/borrow root）+ **改前改后对照断言**（B1 红线）（覆盖：FR-03, R-1）
- [x] task-11: `PolicyCache` 口径统一 + `_syncAllowedRoots` 短路测试（覆盖：FR-01, D-001, D-004）
- [x] task-12: assistant override 删 partial 测试（daemon + backend，对齐 thinking）（覆盖：FR-02, R-3）
- [x] task-13: 实跑验证：daemon >2min online（不卡死、backend 不标 offline）+ 回复不重复（#35 场景）（覆盖：FR-01, FR-02）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D/R | 说明 |
|---|---|---|---|---|---|---|
| task-01 | PolicyCache.set 去 resolveRealPath 统一口径 | W1 | P0 | — | FR-01/03, D-001 | 卡死根因，存归一字符串 |
| task-02 | isPathUnderAnyRoot 补 resolveRealPath | W1 | P0 | — | FR-03, D-001 | B1 安全红线，realpath 下沉到判定 |
| task-03 | _syncAllowedRoots 加短路 | W1 | P0 | task-01 | FR-01, D-004 | JSON.stringify 相同 return |
| task-04 | 所有 set/判定点口径统一 | W1 | P0 | task-01,02,03 | FR-01/03, R-2 | 含 _handlePolicyUpdate:2010 normalize |
| task-05 | partial flush assistant 带 segmentId | W2 | P0 | — | FR-02, D-002 | 对齐 thinking partial |
| task-06 | _extractCompletedSegments 扩 assistant | W2 | P0 | — | FR-02, D-002 | assistant text block 拼 segmentId |
| task-07 | _emitOverrideSignals 扩 ASSISTANT_OVERRIDE | W2 | P0 | task-05,06 | FR-02, D-002 | metadata 不误打 thinking:true（B2） |
| task-08 | backend segmentId + 删 assistant partial | W2 | P0 | task-07 | FR-02, R-3 | 对齐 thinking flushed_partials :374-394 |
| task-09 | interactive dedup_key 补 seq | W2 | P0 | — | FR-02 | 双保险，确定性兜底 |
| task-10 | isPathUnderAnyRoot 路径判定测试 | W3 | P0 | task-02 | FR-03, R-1 | 改前改后对照（B1 红线） |
| task-11 | PolicyCache 口径 + 短路测试 | W3 | P0 | task-01,03 | FR-01, D-001/004 | 口径统一 + 短路不再 changed=1 |
| task-12 | assistant override 删 partial 测试 | W3 | P0 | task-07,08 | FR-02, R-3 | daemon + backend 对齐 thinking |
| task-13 | 实跑 daemon online + 不重复 | W3 | P0 | task-01..12 | FR-01/02 | 部署 daemon + 观察 >2min + #35 |
| task-14 | backend 持久化 segment_id + 跨调用 override DELETE | W2.1 | P0 | task-08 | FR-02, D-002, R-3 | task-08 不彻底补丁：partial 跨调用已 commit，按 segment_id DB DELETE |

## 关键路径

- **卡死链路**（解阻塞，决定能否进 Wave2/3 实跑）：task-01 → task-03 → task-04（Wave1），task-02 并行。Wave1 完成 + 部署 daemon online 后才能解锁 Wave3 task-13 实跑。
- **重复链路**（跨 daemon/backend 两层，segmentId 透传）：task-05 + task-06 → task-07 → task-08 → task-12。task-07 与 task-08 之间 `[ASSISTANT_OVERRIDE]` 信号格式必须对齐（R-3），否则 backend 识别不到漏删 partial。
- **安全链路**（B1 红线）：task-02 → task-10。isPathUnderAnyRoot 是 sandbox 权限判定，task-10 改前改后对照断言必须先过。
- task-09（dedup_key seq）独立，可与 Wave2 任意 task 并行（双保险）。

## 全局验收标准

- [ ] daemon `PolicyCache.set` 不再调 `resolveRealPath`，缓存存归一字符串（task-01）
- [ ] `isPathUnderAnyRoot` 比较时对 target + 每 root `resolveRealPath`，sandbox 判定改前改后结果一致（task-02, task-10，B1 红线）
- [ ] `_syncAllowedRoots` 短路：相同 roots 不再 changed=1、不再触发 set（task-03, task-11）
- [ ] 所有 `PolicyCache.set` 调用点口径统一（含 `_handlePolicyUpdate:2010` normalize）（task-04）
- [ ] daemon `_emitOverrideSignals` 对 assistant 完整 message emit `[ASSISTANT_OVERRIDE] <segmentId>`，metadata 不误打 `thinking:true`（task-07，B2）
- [ ] backend 识别 `[ASSISTANT_OVERRIDE]` 删同 segmentId 的 assistant partial（对齐 thinking）（task-08, task-12）
- [ ] backend 持久化 segment_id 列 + override 跨 submit_messages 调用 DELETE 已 commit 的 partial（task-14，task-08 实跑不彻底补丁）
- [ ] assistant partial flush 带 segmentId（task-05）；assistant text block 拼 segmentId（task-06）
- [ ] interactive 转发 `dedup_key` 确定性（seq，不退化 timestamp）（task-09）
- [ ] **实跑**：daemon 启动后 >2min 仍 online（backend `/api/daemon/machines` status=online，last_heartbeat 持续更新）；会话回复不重复（#35 场景消除）（task-13）
- [ ] 照搬 thinking 机制，不发明新机制；不改前端/agent/thinking 本身/状态机（design §3 非目标）
- [ ] 不影响 PPM 模块（已上线）

## 覆盖矩阵（decisions，内嵌 design.md §10）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1（卡死口径：realpath 下沉到判定） | task-01, task-02, task-04, task-10, task-11 | PolicyCache 存归一字符串不 realpath + isPathUnderAnyRoot 判定时 realpath + 口径点统一 + 测试对照 |
| D-002@v1（重复：照搬 thinking override + 删 partial） | task-05, task-06, task-07, task-08, task-12, task-13 | assistant partial 带 segmentId + emit ASSISTANT_OVERRIDE + backend 删 partial + 测试 + 实跑不重复 |
| D-003@v1（卡死 Wave1 优先） | Wave 顺序 | Wave1 卡死修复 + 部署 online 后才进 Wave3 task-13 实跑 |
| D-004@v1（_syncAllowedRoots 短路双保险） | task-03, task-11 | JSON.stringify 相同 return + 短路测试 |
| D-005@v1（R4 异步化本轮不做） | — | 视 Wave1 实跑（task-13）结果决定，本轮口径+短路优先 |

## 风险对齐（design §8）

- **R1（高，sandbox 安全）**：task-02 改 isPathUnderAnyRoot，task-10 改前改后对照 + 全场景覆盖（B1 红线）。
- **R2（中，口径遗漏）**：task-04 grep 全部 PolicyCache.set / isPathUnderAnyRoot 调用点统一，含 :2010。
- **R3（中，跨层 segmentId）**：task-07 与 task-08 信号格式对齐，task-12 覆盖。
- **R4（低，同步 stat）**：本轮不做异步化（D-005），task-13 实跑若仍卡再议。
