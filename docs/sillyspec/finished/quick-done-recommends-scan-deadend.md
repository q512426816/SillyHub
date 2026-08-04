# quick --done 完成后盲推 sillyspec run scan（回头路）

> ✅ 状态：**已解决**（2026-08-04 修复，commit `2fcbbce`）。根因：`src/run/complete.js` 阶段完成推荐里 brainstorm/archive/verify/execute/plan 有专属分支，**quick 走 else 分支**调 `pm._getNextSuggestion(progress)`；`_getNextSuggestion`（`src/run/stage-machine.js`）按「STAGE_ORDER 第一个未完成且上游就绪」推荐，而 scan 是 STAGE_ORDER 首位辅助阶段、永未完成 → quick 完成后总被推 scan。但 quick 是收尾阶段，完成后该提交，推 scan 是回头路/无关。修复：对齐 brainstorm 先例（同为避推 scan 而设专属分支），给 quick 加 `else if (stageName === 'quick')` 专属分支，完成后推「提交本次改动 / 继续 run <stage>」，**不动全局 `_getNextSuggestion`**，零回归。回归测试 `test/quick-cli-managed-e2e.test.mjs` step3 --done 加断言「输出含『提交』、不含『run scan』」，15/15 通过。

## 现象

`sillyspec run quick --done` 完成后，CLI 推荐「下一步：sillyspec run scan」。但 quick 是收尾/辅助阶段（小修复直接在主工作区改代码），完成后应提交；scan 是 STAGE_ORDER 首位、永未完成的辅助阶段，推它是回头路，误导 agent 去跑无关阶段。

## 影响

- agent 被误导在 quick 收尾后跑 scan，偏离「提交」正路，浪费步骤。
- 与 brainstorm 同类历史问题一致（曾因此让 agent 误跑 scan，故 brainstorm 早已加避推 scan 的专属分支）。

## 关联

- 同族「完成推荐误推 scan」：brainstorm 已有避推 scan 的专属分支先例（`src/run/complete.js`）。
- 修复随 commit `2fcbbce`（fix(quick): sillyspec 自身三处体验/可靠性修复）。
