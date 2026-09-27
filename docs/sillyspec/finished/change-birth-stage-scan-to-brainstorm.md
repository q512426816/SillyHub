# 变更出生阶段误显「🔍 代码扫描」——应起步于头脑风暴（已修复）

> 状态：已修复（2026-09-27，sillyspec 仓 2026-09-27-change-birth-stage-brainstorm，v3.31.0 源内修复）
> 发现路径：multi-agent-platform 的 2026-09-27-governance-rpc-actions（thin 变更）全生命周期显示「🔍 代码扫描」，用户裁定「起步就是头脑风暴」。

## 现象

- 任何新建变更（尤其 thin/quick 等从不进主流程的），`sillyspec progress show` / SillyHub 面板全程显示「🔍 代码扫描」直到归档；
- 存量库大量 `quick-*` 残留行同样挂在「🔍 代码扫描」，被误读为「正在扫描代码」。

## 根因（sillyspec CLI）

`changes` 行出生 `current_stage` 硬编码 `'scan'`（三处：`src/progress.js` initChange/_readOrInit 两处 INSERT + `src/db.js` DDL DEFAULT）。而 `scan` 是 auxiliary 阶段（`shared.js MAIN_FLOW_ORDER` 不含它），从不是变更主流程起点——出生落它上面纯属 DDL 历史遗留，与「scan=按需显式跑」的既有语义自相矛盾。

## 修复内容（ sillyspec 仓 eb946a2e / eb3b4bce / a419b376，已归档）

1. 三处出生硬编码 `'scan'`→`'brainstorm'`；DB schema 版本 7→8。
2. 存量迁移（`_createSchema` 末尾幂等 UPDATE，戳失效触发）：仅改写「active + current_stage='scan' + 从未真跑 scan（stages.scan='pending' 或无 stages.scan 行）」的出生默认行为 'brainstorm'，并刷 `last_local_modified_ts` 防平台 pull 静默导回；真在跑（in-progress）/已跑完（completed）/已归档/主流程行不动。
3. 隐性承载修复：旧出生值 scan 是 auxiliary，「辅助→主流程任意放行」一直在兜底 thin 归档、backfill、complete-step 等直 run 路径——brainstorm 是主流程阶段后 18 个存量测试文件实证 `brainstorm→archive/execute` 被拒。`checkTransition` 增「出生未入门态」（brainstorm 仍 pending/无行）等价继承旧语义；真在 brainstorm 中（in-progress/completed）守卫不变。
4. 顺带清偿：`progress.js read()._version` 字面量 6 收敛单一源 `CURRENT_VERSION`（v7 bump 漏改的第五处漂移）。

## 效果验证（multi-agent-platform 实测）

- `quick-28eb218b`（滞留 9 天的 scan 行）迁移后显示「🧠 需求探索」，active+scan 残留 0；
- 活跃列表不再出现「🔍 代码扫描」（verify 阶段的「🔍 验证确认」是正常主流程展示，勿混淆）；
- SillyHub 面板阶段文案走 CLI 单源（digest 单源收敛），无需前端改动。

## 驾驭备注

- 全局 `sillyspec` 是指向 `~/IdeaProjects/sillyspec` 的 npm 符号链接——改源码即全局生效，也意味着**分步编辑源文件的窗口期内，常驻 watcher/daemon 会用半态代码跑 init**（本次实测：先 bump 版本号后补迁移的几分钟里，平台库被写了「戳 8 无迁移」的状态，需手动把戳改回 7 强制重跑迁移补齐）。后续做 schema 迁移类改动应**一次性完整落盘再让外部进程触达**，或改完后主动检查戳与数据一致性。
