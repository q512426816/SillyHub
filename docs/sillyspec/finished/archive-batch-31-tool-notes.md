---
author: qinyi
created_at: 2026-08-30 20:45:00
---

# 批量归档 31 变更中的工具观察（2026-08-30）

> 状态：活跃坑（小）；均不阻断归档，记录备查。

## 1. workflow-runs 产物文件名误标 `fail`

现象：`sillyspec run archive` step 2（extract-module-impact）成功完成且 CLI 明确打印「✅ module-impact.md 检查通过」，但
`.runtime/workflow-runs/` 里对应产物文件名仍为 `…-archive-impact-multi-agent-platform-fail.json`。疑似以内部子流程
（module-impact 骨架生成降级）的退出态命名整份产物，与步骤最终成功态矛盾。

影响：低（仅排查时会误导）。建议：产物文件名按步骤最终校验结果命名，降级子流程另记字段。

## 2. 老变更 DB 步骤表漂移时 `--confirm` 提示与实际行为不符

现象：对 DB 中 archive 步骤表为旧定义（5 步）的变更执行 `sillyspec run archive --done --confirm`，CLI 连续 3 次
打印「⚠️ 请添加 --confirm 确认归档」后第 4 次实际以 --confirm 语义完成（目录正常移动、状态机推进到 step 6）。
同批出现「⚠️ archive 步骤表与当前定义漂移（DB 5 步 → 定义 6 步）」告警，推断漂移重映射期间 confirm 标志被吞。

影响：低（重试即成，最终行为正确）；但提示文案会让操作者误以为参数没带。建议：漂移重映射后透传原始 flags，
或提示改为「正在按新步骤表重放，请重试同一命令」。

## 3. 非缺陷备注

- `sillyspec module-impact` 对早于 review.json/impact 机制的老变更报「无 module-map 或无 diff 文件可归类——骨架无从生成，
  agent 全手写」——这是文档化的降级路径，按提示全手写即可，不算缺陷。
- decision-distill 对无 `impacts` 域字段的老 decisions.md 兜底归 `decisions/unmapped.md`，与既往归档先例一致。

## 处置记录（2026-08-31 定时收口，两缺陷全修）

**缺陷 1（workflow-runs 产物误标 fail）——已修复**：
- 根因实证：`saveWorkflowRun` 文件名后缀取 workflow **整体** status，而 archive「extract-module-impact」步完成时 archive-impact workflow 必然含下一步 doc-syncer 角色（sync-module-docs 步才执行）的 fail——整体恒 fail，与「✅ module-impact.md 检查通过」（只看 impact-analyzer 角色）矛盾。主仓存量产物 **75 个**均为「impact-analyzer=pass 但文件名 -fail」。
- 修复（sillyspec 仓 `src/run/complete-handlers.js` + `src/workflow.js`）：落盘记录按**本步最终校验**（impact-analyzer 结论）定 status/文件名；doc-syncer 角色明细保留在 roles/failures 字段（另记字段不丢信息）；新增 `status_scope: "step:extract-module-impact"` 标注口径。impact-analyzer 角色缺失时维持整体 status（行为不变）。scan-docs 分支不受影响（其 workflow 全角色同属一步）。

**缺陷 2（漂移吞 --confirm）——已修复（复现澄清 + 双层修复）**：
- 真实机制比「重映射吞标志」更具体（fixture 复现澄清）：旧 5 步表（无 sync-module-docs）漂移重播种后，首个 pending 变为**新插入的中间步骤**——带 `--confirm` 的 `--done` 被静默记到 sync-module-docs 上（确认标志被耗在非预期步骤）；叠加 outputStep 机器生成的「完成后执行」提示是通用 `--done` 模板**不带 `--confirm`**，agent 照抄执行即撞「请添加 --confirm」确认门——三轮提示即来自这两层叠加。
- 修复 A（`src/run/command.js`）：漂移重播种改变「当前待完成步骤」身份时，静态定义阶段（brainstorm/verify/archive/quick）的 mutating 命令（--done/--skip/--wait）fail-closed 中止——显式告知「当前步骤由 X 变为 Y，本次未执行，原样重跑同一命令（原 flags 全部生效）」。execute/plan/scan 动态步骤表除外（重播种后续跑是设计内自愈流，run-complete-step-validator-rollback 等测试锁定，曾误伤后收窄）。
- 修复 B（`src/stages/archive.js` + `src/run/prompt.js`）：「确认归档」步骤声明 `requiresConfirm: true`（数据驱动），outputStep 完成提示行据此带 `--confirm`——其他阶段未来有确认步同样声明即可。

**测试证据**：新增 `test/archive-batch-31-tool-notes.test.mjs` 3 用例全绿（①产物命名 -pass.json + status_scope + doc-syncer 明细保留；②漂移首跑 fail-closed + 重跑正常完成 sync-module-docs；③Step5 提示带 --confirm，CLI e2e）。受影响面回归 154 用例通过，唯一失败为既有无关失败（worktree-execute-spec-drift AC-A6，他人在途 worktree/commit 工作引入，摘除法归因）。

**第 3 节非缺陷备注**：确认无需处置（文档化降级路径 + 既有归档先例），随本文件归档备查。
