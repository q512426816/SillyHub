# 【活跃坑】plan --done 未自动生成 module-impact.md 而 gate 硬性要求存在

- 发现：2026-10-14-session-turn-preview-cards（execute 收尾回溯 plan 阶段）
- 现象：plan Step 3（审查计划）指引说「module-impact.md 首版由 CLI 在本阶段 --done 时自动生成……本步不要手写」，但 plan Step 2/Step 4 两次 --done 均未落盘该文件；`sillyspec gate plan` 却报 `module-impact.md 缺失（large 变更应在 plan 审查计划步生成模块影响分析首版）` 阻断。指引自身给了兜底：「仅当 --done 报缺失时按 gate 报错提示手写兜底（两章节标题逐字『## 模块影响矩阵』『## 未匹配文件』+『## 更新结果』表骨架）」——按兜底手写后 gate 放行。
- 影响：按指引「勿手写」等自动生成的 agent 会在 gate 处空转一轮（本变更实测 2 次 gate 失败重跑）；手写兜底可用但与「手写整份首版是历史返工根源」的告诫互相矛盾，边界模糊。
- 期望：--done 自动生成生效（猜测触发条件漏判：tier=self / plan_level=light+scale=large 组合？），或指引改为「Step 3 即手写骨架兜底」。
- 临时绕过：gate 报缺失时直接按指引模板手写骨架（章节标题逐字 + 更新结果表 pending），execute/verify 再回填。
- 复现：2026-10-14 会话，plan 阶段 2026-10-14-session-turn-preview-cards 变更。

## 处置记录（2026-10-16）

**双面处置**（sillyspec 仓，部分工作树未提交）：

1. **生成机制核实 ✅ 在场且有效**：`generatePlanModuleImpactFirstVersion`（plan-postcheck.js
   :1663，2026-09-08 起在 --done 链 1e-0 步）——本日功能复验：design scale≠small + 声明
   清单 + module-map 三要素齐 → 自动生成（generated，matched 1/unmatched 0）。
2. **坑根因定位**：三要素缺一即**静默 skip**——坑现场是仓无 `_module-map.yaml`（no-module-map
   skip），agent 按「勿手写」指引等到 gate 撞墙。**本轮补修**：skip 于 no-module-map /
   no-declared-files 两因时打显式 warning（生成前提缺失 + 手写骨架逃生口径 + run scan
   建图指引），不再静默等 gate。

tier=self 猜测排除（生成不判 tier）。回归 plan-postcheck/design-coverage/gate-face 族
54/54 绿。归档。
