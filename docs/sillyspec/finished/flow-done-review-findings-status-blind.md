# flow done 评审门禁不识别 findings[].status——已解决条目留在数组即被判「仍有 P1」

- 发现变更：`2026-10-23-session-network-context`（2026-10-23 实证）
- 状态：**活跃**（阻断归档；需人工改 review.json 或重评）

## 现象

1. 首轮独立评审产出 `review.json`：`verdict=FAIL`，3 个 P1 + 3 个 P2 + 3 个 P3。
2. 修复后按评审经济学三律做**增量复审**（resume 同一评审员），评审员把每条 finding 加上
   `"status": "resolved"`（或 `"resolved-as-accepted"`）并保留在 `findings` 数组中，
   同时把 `verdict` 改为 `PASS`、`reviewedAgainst` 更新为新 HEAD。
3. 重跑 `flow done` 被拒：

   ```
   ❌ 独立评审未过（verdict=PASS，P1 发现 3 项）——承诺与实现不一致，不许归档
   ```

   即：**verdict=PASS 被承认，但 findings 里只要还有 `severity: "P1"` 条目就拒绝**，
   完全忽略 `status` 字段。

## 根因

- 评审任务书给出的 schema 只有 `{severity, title, evidence, location}`，**没有 status/resolution 字段**；
- 增量复审（官方推荐的「FAIL 后增量复审」流程）天然需要在 findings 中保留历史条目并标注状态；
- 收口门禁的实现只做 `findings.some(f => f.severity === 'P1')`，不读 status → 与增量复审流程互斥。

## 当前绕过

让评审员按门禁形态重写：`findings` 只保留 **open** 项（已 resolved 全部移除），
增量复审结论写进 `reviewerNotes`（顶层额外字段不被 schema 校验拒绝）。

## 建议修复方向

- 门禁判定改为「存在 `severity==P1` 且 `status` 不属于 {resolved, resolved-as-accepted, accepted, false-positive} 的 finding」；
- 或在评审任务书 schema 中正式定义 `status` 字段并让增量复审成为一等流程；
- 或在 CLI 错误信息中显式提示「如需清除已解决条目，请按门禁形态重写 findings」，避免维护者以为 verdict 没写对而反复改 verdict。

## 关联

- `flow-done-new-prefix-crossrepo-ambiguity.md`（同变更另一条 flow done 摩擦：NEW: 前缀跨仓误判）
- `2026-10-23-flow-done-shared-repo-multi-session-frictions.md`（共享主仓多会话三摩擦）

## 处置记录（2026-10-24 定时收口：已修，关闭归档）

- **门禁改开放项判定**（sillyspec 仓）：flow-review.js 新增 `isOpenFinding` 谓词——已解决集
  {resolved, resolved-as-accepted, accepted, false-positive}（大小写不敏感）判非开放；status
  缺省/未知值判开放（fail-closed 不因新词表静默放行）。flow.js 评审门两消费点（阻断主路径
  registerReviewOutcome + 断点回填 findingsP1）统一换口径：`FAIL 或开放 P1 才拦`，拦截面
  （`开放 P1 发现 N 项`）与展示（`[P1·resolved]`）带 status；错误文案补增量复审提示
  （status 词表一次给全，勿反复改 verdict——坑内建议③）。
- **任务书 schema 正式定义 status**（坑内建议②）：renderReviewerTaskbook 的 findings 行加
  status 枚举 + 增量复审语义说明（保留历史条目标 status、阻断只计 open、首评可省略）——
  validateReviewJson 对额外 status 字段本就容忍（实证），现教学面与门禁口径对齐，增量复审
  成为一等流程。
- **测试**：flow-review.test.mjs 13/13（新增 isOpenFinding 词表/缺省/未知值/null 防御 +
  validateReviewJson 容忍 status 双 finding 形态）；thin-empty-face-crosscheck.test.mjs e2e
  两臂（承诺词强制评审必经门——resolved P1+PASS → 收口通过归档；open P1 显式 status → 仍拦
  且文案计开放项）+ 既有面 13/13。
- 处置结论：三门（判定/教学/schema）对齐，本文件移入 finished/。
