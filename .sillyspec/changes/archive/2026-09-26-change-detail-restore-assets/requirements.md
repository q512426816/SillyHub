---
author: flow-machine-draft
created_at: 2026-09-26T05:54:31.129Z
---
# 需求规格（Requirements）— 2026-09-26-change-detail-restore-assets

## 功能需求（agent 填写——每条 FR 格式 ### FR-NN: 标题 + Given/When/Then；FR 进知识索引，写清行为语义）

<!--AGENT:FR区 agent 填写功能需求（直接书写，不走 amend） -->
<!-- 参考摘录按下方四条采纳；原摘录 FR-04/FR-05 为括号切分碎片，合并为本 FR-04 一条 -->

### FR-01: 变更详情页重新挂载沉淀资产卡
Given main 分支的变更详情页（`[cid]/page.tsx`）在 304eba982 被夹带的旧版页面覆盖，
When 用户打开任一变更详情页，
Then 右侧 aside 重新出现「沉淀资产」卡（`ChangeAssetsCard`，自取数 GET /changes/{cid}/assets，失败静默隐藏），且 304eba982 新增的观测事件卡（`ChangeObservationEventsCard`）原样保留不回退。

### FR-02: 标题阶段徽章恢复 thin/quick 口径
Given `current_stage="thin"` 的轻量变更在标题旁只显示弱化的 outline 徽章（fallback 路径），
When 详情页渲染 thin 或 quick 阶段变更，
Then thin 显示品牌紫 default 徽章「轻量变更」、quick 显示 default 徽章「快速任务（存量）」（`STATUS_BADGE` 四态：quick/thin/blocked/archived，注释同步恢复），其余阶段行为不变。

### FR-03: 范围对账卡恢复 archived 降级指路
Given 已归档变更（status=archived 或 location=archive）的范围对账降级态，
When `ScopeAuditCommandCard` 渲染降级横幅，
Then 重新收到 `archived={isTerminalChange(change)}` 传参，横幅追加「真实改动面见沉淀资产 · 归档留档」指路（组件侧逻辑 9cb48847d 已在，仅恢复调用传参）。

### FR-04: 聚焦测试与类型门禁全绿
Given 三处恢复落盘，
When 运行前端聚焦测试（change-assets-card / scope-audit-command-card 组件套件 + 详情页整页回归 + 新增 thin 徽章/资产卡挂载钉子）与 `tsc --noEmit`，
Then 全部用例通过且类型检查 0 错。


## 测试绑定（每条 FR 至少一行——test 文件路径或用例名；不适用要写理由；flow done 空槽拒收）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx`::aside 同时挂载沉淀资产卡与观测事件卡 用例（stub 后断言两 testid 并存）；组件本体回归 `frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx`

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
`page-restore-assets.test.tsx`::FR-02 thin 阶段标题旁显示 STATUS_BADGE「轻量变更」徽章 用例（exact 文本，与 ◈ 说明卡标题不互扰）；quick 口径由 STATUS_BADGE 字面量与 01a9dfcbd 对齐保证，无独立行为分支

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
`page-restore-assets.test.tsx`::FR-03 范围对账卡收到 archived 传参 + 已归档变更 archived 派生为 true 两用例；横幅文案本体 `frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx` 既有 14 用例

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（无测试面写「不适用：理由」）——例外裁决书写面（机器段之外合法） -->
聚焦面 46 用例：详情页 __tests__/ 3 文件 22 用例 + change-assets-card 10 + scope-audit-command-card 14；类型门禁 `pnpm exec tsc --noEmit` exit 0（2026-09-26 实测）
