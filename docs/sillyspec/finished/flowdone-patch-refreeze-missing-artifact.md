# flow done 重入幂等跳过只认子步状态——冻结件缺失不再生（2026-10-14）

## 现象

flow done 重入（断点续）时，patch 子步只认 `flow-state.yaml` 的 `substeps.patch === 'done'`，不复查产物存在性：`change.patch` / `change-patch.json` 被删（手工误删或上次写盘中断）后重跑，`readFileSync(change-patch.json)` 抛错被 `catch` 吞掉 → 幂等跳过 → 归档产物缺审计冻结件。

实证（multi-agent-platform 仓 2026-10-14-agent-profile-express-preset）：首跑冻结后按评审要求补删冻结件，重入时 patch 子步跳过未再生（verify-result 如实记「交付冻结：（无冻结件）」），只能按 `git diff baseline..HEAD` 手工重建 `change.patch` + `change-patch.json`。

## 影响

- 归档审计件缺失交付冻结面（close-trace-freeze-integrity 的审计真相锚落空）。
- 手工重建可行但易错（冻结口径有 `.sillyspec/` 过滤等规则），且机器产物被手工替代。

## 修复

✅ **已修复（2026-10-14）**——sillyspec 仓轻量变更 `2026-10-14-patch-refreeze-missing-artifact`（证据提交 sillyspec@a5fbe1db，归档 9e42ee3a）：

- `src/flow.js` patch 子步重入加**冻结件存在性复查**（存在性优先于子步状态）：缺任一件打「冻结件缺失」warning 并按处置漂移同款语义自动重冻结（重冻面锚当前 HEAD）；
- review 处置沿用漂移面同一隔离规则：`reviewedAgainst` 命中重冻结目标 HEAD 保留不隔离；未锚定隔离重评（缺基面无法判 governance-only，fail-safe 宁可多评）；隔离 rename 失败仍回退幂等跳过（quarantineOk 语义保留）；
- 冻结件在场时行为与修复前逐字节一致（漂移检测/隔离/重置标记全保留，既有 ①-③ 用例零回归）；
- 测试：`test/flowdone-disposition-drift.test.mjs` 新增 ④⑤ e2e（缺件+anchored→重冻+归档成功；缺件+未锚定→隔离重评），6/6 绿。

## 状态

已修复并归档（sillyspec 9e42ee3a）。遗留两条非阻断评审发现随 review.json 留档：design 对重冻写入机制表述失实（真身 `writeFileSync` 非原子写，数据正确性由「任一缺席即重冻覆盖」保证）；其它子步（artifacts/ledger 等）暂未做同款存在性复查，可按同模式逐子步治理。
