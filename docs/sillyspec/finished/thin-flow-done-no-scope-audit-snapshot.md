---
title: 轻量变更（thin flow）done 不写 scope-audit.json 快照——归档后范围对账表恒「计划未动 0/0」失真
date: 2026-10-07
status: 活跃（工具缺陷待修）
source: 2026-10-07-taskboard-tasks-md 归档后在变更中心（阿里云部署）范围对账明细全行 ⚠️ 计划未动 +0/−0，与沉淀资产 change.patch（7 文件 +328/−34）矛盾；本地 `sillyspec scope-audit --change 2026-10-07-taskboard-tasks-md --json` 复现（v3.32.0）
---

# 轻量变更归档后 scope-audit 恒「计划未动」

> 一句话：**thin 流程 `flow done` 只冻结 change-patch.json/change.patch，不落
> `execute --done` 链才写的 scope-audit.json 快照；归档轻量变更查范围对账时
> 快照缺失 → 实时开放区间兜底 → 无 baseAnchor → HEAD 未提交窗口（干净树=空）
> → design 清单全行标「计划未动 +0/−0」，纯失真。**

## 复现证据（2026-10-07）

- 变更：2026-10-07-taskboard-tasks-md（thin，已归档，提交链 6e75af2f3 → fbf4ae275 → 0edf5ea22）；
- 归档目录 `.sillyspec/changes/archive/<名>/` 有 change-patch.json + change.patch
  （flow done 时点冻结，7 文件 +328/−34，含 task/parser.py 等三个计划内文件），
  **无 scope-audit.json**；
- `sillyspec scope-audit --json` 返回：`baseAnchor: null`，3 行全 `verdict: "untouched"`
  0/0，note 自述「快照缺失……下表为实时开放区间……非本变更冻结范围」。

## 机制链（src/scope-audit.js，v3.32.0）

1. 归档变更走 settled 分支（`:966`）优先读快照 `readScopeSnapshot`（`:247`，
   只认变更目录/runtime 的 `scope-audit.json`）；
2. 该快照仅 full-flow `execute --done` 落盘；thin 的 `flow done`（flow.js `:1408`）
   只 import `buildFrozenPatch` 冻 patch，不写快照；
3. 快照缺失 → 开放区间兜底（`:1039`）；thin 无 worktree meta → `resolveReconcileActualFiles`
   给不出 baseAnchor → 行数按 HEAD 未提交窗口采集（`:1063-1068`）；
4. 已提交干净树 → 实际侧空 → 计划侧行全落 untouched 0/0（`:1192-1198`）。

## 影响与判读

- 所有已归档轻量变更的范围对账明细恒「计划未动 0/0」，与事实相反；
  用户侧极易误读为「没干活」。note 有自述但权重低（前端小字渲染，
  scope-audit-command-card.tsx `:572`）。
- 判读守则：**已归档 thin 变更的真实范围以沉淀资产 change.patch /
  change-patch.json（flow done 冻结）为准**，范围对账表对该形态无参考价值。

## 镜像缺口（2026-10-07 补证，厚流程对照 2026-09-23-change-events-channel）

thin/heavy 两通道留痕互补缺失，正好各缺一半：

| 卡面 | 数据源 | thin 归档 | heavy 归档 |
|---|---|---|---|
| 范围对账明细 | CLI scope-audit（快照 scope-audit.json 优先回放） | ✗ 失真（计划未动 0/0） | ✓ 冻结快照正确 |
| 沉淀资产·归档留档 patch 块 | 平台 assets.py `_read_patch_meta` 只读 change-patch.json | ✓ flow done 冻结正确 | ✗ execute --done 不写此件 → patch 统计与"点开看 diff"整块不渲染（只剩 delta 行） |

- 厚流程页面上数字正确的那张卡是**范围对账明细**（读 scope-audit.json）；
  它的**归档留档 patch 块是空的**——assets.py `:13` 自注「存量归档无此件 → None
  容错」，实际根因同源：execute --done 只写 scope-audit.json/patch，从不写
  change-patch.json。
- 连带 UI 交叉指路失衡：范围对账卡降级时提示「真实改动面见沉淀资产·归档留档」
  （scope-audit-command-card.tsx `:325`）——对 thin 成立，对 heavy 反向不成立
  （对账可信、归档留档反而空）。

## 修复方向（待工具侧 / 平台侧）

- 最小修（CLI）：`flow done` 与 `execute --done` 同款落 scope-audit.json（数据
  现成——change-patch 行数即快照行数，补 verdict=planned 即可）；
- 或读侧兼容（CLI）：settled 分支快照缺失时回读 change-patch.json 当冻结记录
  （旧归档 thin 立即受益）；至少 UI 对「快照缺失的已归档 thin」应把 ⚠️ 三态降权
  为「无冻结对账记录，见沉淀资产」而不是逐行「计划未动」；
- 平台侧（backend/assets.py）：`_read_patch_meta` 加 scope-audit.json 回退
  （totals + rows[].path 投影即可），让厚变更的归档留档 patch 块也有数。

## 处置记录（2026-10-08）

三向修复方向**全部落地**（坑同日由并行会话修复，本日复核验证）：

1. **写侧（CLI，已提交）**：`2026-10-07-unify-close-trace`——`flow done` 经共用
   `writeCloseTraceArtifacts` 一次写齐四件（change.patch + change-patch.json +
   scope-audit.json + scope-audit.patch，sha256 双套同锚）；thin 快照带 `closedBy: 'flow
   done'` 通道标注，回放不误标 execute --done。
2. **读侧（CLI，已提交 `901aa239`）**：`2026-10-07-scope-audit-thin-patch-replay`——
   settled 快照缺失时回读 change-patch.json 冻结件出真实三态（文件集过
   filterDeliverableFiles、行数按冻结 patch 分段统计、三态按 design 清单同款判定、
   跨仓维持 ⊘ 形态），**存量归档 thin 立即受益**，不再落「计划未动 0/0」失真链。
3. **平台侧（backend，并行会话工作树在途）**：`2026-10-07-assets-patch-scope-audit-fallback`
   ——assets.py `_read_patch_meta` 缺 change-patch.json 时回退 scope-audit.json
   （totals/patchStatus 投影 + scope-audit.patch 点开）——厚变更归档留档 patch 块有数。

**测试证据**：CLI `test/scope-audit-thin-patch-replay.test.mjs` 4/4（含存量归档回放）；
平台 `app/modules/change/tests/test_assets.py` 28 passed（含「厚流程形态归档只落
scope-audit 件」回退用例）——本日复跑双绿。UI 三态降权建议未单独实现（读侧回放已让
降级路径基本不可达，剩余为极端形态：快照与冻结件双缺——note 自述已覆盖）。

归档（CLI 两向已提交；平台侧改动在并行会话工作树，随其变更收口）。

## 后续演进：四件双轨 → 单套统一（2026-10-09-close-trace-single-set）

双轨形态运行两日后收敛为单套（用户裁决：一套留痕、平台单读）：

1. **CLI 写侧**：`writeCloseTraceArtifacts` 只落 **change.patch + change-patch.json**
   两件——原 scope-audit.json 对账面（mode/ok/rows/verdict/closedBy/repos 等）并入
   change-patch.json 的 **`scopeAudit` 子对象**；顶级键（files/totals/baseline/head/
   patchSha256/patchStatus/savedAt/modules 等）原位不动。scope-audit.json/.patch 停写。
2. **CLI 读侧**：快照读序 `change-patch.json.scopeAudit` → 旧 `scope-audit.json` →
   `.runtime` 快照 → thin 回放 → 实时区间；`--file` 冻结切片 change.patch 优先、
   scope-audit.patch 兜存量 heavy 归档；防篡改 sha 伴生件读 change-patch.json。
3. **平台侧**：backend 主读路径本就 change-patch.json/change.patch 优先、顶级字段
   零变化——无需改逻辑；schema.py 契约注释补 scopeAudit 子对象说明；前端
   structured-views 新增 change-patch.json 结构化分支（清单面 + scopeAudit 复用
   ScopeAuditView）。**回退链保留**（其他仓/本仓存量 247 个旧形态归档不动）。
