---
author: flow-machine-draft
created_at: 2026-10-13T21:31:25.417Z
---
# 需求规格（Requirements）— 2026-10-14-turn-anchor-cache-eviction

## 功能需求

### FR-01: 会话级缓存清理函数导出与 terminateSession 接线

turn-anchor.ts 必须导出会话级缓存清理函数 `clearTurnAnchorCache(sessionId: string): void`，且 terminateSession（lifecycle.ts）必须在会话终结时调用它（位置对齐 `_clearBackgroundTasks` / `_destroyUsageLedger` 同点惯例）；清理必须只删除本 session 的 `_lastTreeBySession` 条目，禁止触碰 JSONL 落盘记录与 `_chainBySession` 串行链自清理逻辑。

#### 场景：主路径

Given 一个已打锚的活跃会话 / When terminateSession 以 manual 或 driver_error 终结该会话 / Then `clearTurnAnchorCache` 恰好被调用一次且入参为该 sessionId；该会话的轮锚 JSONL 文件内容不变。

#### 场景：在飞锚链竞态

Given 末轮锚链尚未收尾（fire-and-forget `void recordTurnAnchor` 在飞）/ When terminateSession 触发清理 / Then 缓存删除必须挂到在飞链收尾之后执行（doRecord 尾部会回写缓存，先清会被回写），且不抛错、不阻塞 terminate 流程。

### FR-02: 清理后功能无回归（JSONL 尾行兜底恢复 prev 锚）

清理后同会话若再打锚，prev 锚必须经 readLastRecord JSONL 尾行兜底恢复：去重判定（deduped）与 diff 基线链（prevTreeSha 指向上一落盘锚的 treeSha）的行为必须与清理前完全一致。

#### 场景：主路径

Given 会话已落两锚（第二锚含文件变化）/ When clearTurnAnchorCache 后再打第三锚（新增文件变化）/ Then 第三锚 prevTreeSha === 第二锚 treeSha，files 恰为第二→第三的逐文件变化。

#### 场景：零变化去重恢复

Given 会话已落一锚后清理 / When 再打一次零变化锚 / Then deduped===true 且不追加 JSONL（判重不因清理失效）。

### FR-03: 未知 sessionId 幂等安全

对从未打过锚的 sessionId 调用 clearTurnAnchorCache 必须是无操作且不抛错（幂等）。

#### 场景：主路径

Given 内存缓存无该 session 条目 / When 调用 clearTurnAnchorCache(该 id) / Then 正常返回 void，不抛任何异常。

### FR-04: 单测覆盖且相关测试全绿

上述三条行为必须有单测覆盖（真实临时 git 仓 + 接线断言两处），且 turn-anchor 相关测试（含既有 9 用例）与新增用例全部通过；禁止跑全量测试（仓库规则 0，全量留给 CI）。

#### 场景：主路径

Given 新增用例与实现落地 / When 运行 sillyhub-daemon 的 turn-anchor 与 lifecycle 接线相关测试 / Then 全部通过（exit 0）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/sillyhub-daemon/tests/interactive/session-manager-lifecycle-turn-anchor-eviction.test.ts「terminateSession 调用 clearTurnAnchorCache 恰一次（4c 接线）」
FR-01: test/sillyhub-daemon/tests/interactive/turn-anchor.test.ts「在飞锚链竞态：清理挂链收尾后执行，链与后续锚行为正确」
FR-02: test/sillyhub-daemon/tests/interactive/turn-anchor.test.ts「清理后续锚：prev 经 JSONL 尾行兜底恢复，diff 基线链与去重判定无回归」
FR-03: test/sillyhub-daemon/tests/interactive/turn-anchor.test.ts「未知 sessionId 调用清理：无操作不抛（幂等）」
FR-04: 不适用：本条是对测试覆盖面与运行结果的过程性要求，由上述三组用例的运行回执（vitest exit 0）兑现，无独立测试文件。
