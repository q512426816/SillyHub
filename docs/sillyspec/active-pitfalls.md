<!-- 活跃坑索引：处置完成的条目移入 finished/（单坑单文件）；关闭即补「→ 已关闭」标注 -->
<!-- 2026-10-17 索引审计补标：下列 11 条历史条目文件已在 finished/ 但漏关标，一次性补齐 -->
<!-- worktree-apply-rollback-ghost-bindings-manifest.md：apply 回滚残段+幽灵绑定+双横线解析三连环（2026-10-15，工具三补丁已实施未提交）→ 已关闭（文件已在 finished/，2026-10-17 补标） -->
<!-- verify-jsx-batch-cmd-too-long.md：verify jsx 批 137 文件单命令超 Windows cmd 上限恒败+增量账本自我循环（2026-10-15，工具分块补丁已实施未提交）→ 已关闭（文件已在 finished/，2026-10-17 补标） -->
<!-- wt-commit-auto-tick-unimplemented-tasks.md：wt-commit/platform sync 后未实现 task 被自动勾 [x]（2026-10-15，2026-10-14-admin-server-status 双次实证）→ 已关闭（文件已在 finished/，2026-10-17 补标） -->
<!-- stage-review-dir-naming-mismatch.md：stage-review 目录命名三方不一致+refresh-hash 全程不可用（2026-10-15，三阶段连环实证）→ 已关闭（文件已在 finished/，2026-10-17 补标） -->
<!-- verify-close-gate-staggered-exposure.md：verify 收口文档门四轮逐个暴露+锚点正则吞中文左括号（2026-10-15，node 直调实证）→ 已关闭（文件已在 finished/，2026-10-17 补标） -->
<!-- task-review-retired-archive-mismatch.md：Task Review 退役但 archive 完成度仍要 per-task review.json（2026-10-15）→ 已关闭（文件已在 finished/，2026-10-17 补标） -->
<!-- distill-rejected-field-late-hint.md：rejected 决策否决理由字段要求仅归档时提示（2026-10-15）→ 已关闭（文件已在 finished/，2026-10-17 补标） -->
<!-- probe-noise-and-commit-suggest-quality.md：探针3预填82文件噪音+commit建议误判fix+平台409刷屏（2026-10-15）→ 已关闭（文件已在 finished/，2026-10-17 补标） -->
<!-- verify-lint-triage-path-divergence.md：lint 归因降档只挂 --done（gates.js）路径，noAI 质量扫描（verify-quality-scan.js step6）未接线 → 零交集存量债两路径行为分叉（2026-10-15，dsh-engine-acp verify 实证，advisory 逃生收口）→ 已关闭（文件已在 finished/，2026-10-17 补标） -->
<!-- verify-incremental-rerun-infra-batch-growth.md：增量重跑账本把运行器基建失败按测试失败计入失败批 → 失败批随轮膨胀 141→159（2026-10-15，dsh-engine-acp 两轮实证；与 jsx 参数上限同源，账本语义待修）→ 已关闭（文件已在 finished/，2026-10-17 补标） -->
<!-- verify-test-grouping-cwd-mismatch.md：verify 实测模块分组不稳定——daemon 测试文件偶发分进 frontend vitest 组（cwd 错配 No test files found 假红）；skipped 聚合档（已跑全绿+缺件跳过）在部分路径被判 failed（2026-10-15-server-logs-panel 实证）→ 已关闭（文件已在 finished/，2026-10-17 补标） -->
<!-- deploy-multi-session-overwrite.md：多会话各自打包部署覆盖生产（分叉分支回退 main 修复事故，2026-10-16）→ 已关闭（2026-10-16-deploy-convergence-guard 部署并流校验闸归档，d581d40b4；已移入 finished/） -->
<!-- conflict-compare-full-tree-label-mismatch.md：跨多变更的全量冲突平台按单变更归因、CLI 落盘 full-tree 名 → 对比恒 conflict_record_missing 且「刷新冲突列表」无效（2026-10-16 生产实证）→ 部分修复（2026-10-16-conflict-full-tree-compare 已上线：full-tree 兜底重取+四臂文案+行级关行 UI；结构性根因「行开记录亡」仍在，200 场景留补验——2026-10-17 真机复验 3/4 证据达成） -->
<!-- change-title-not-readable.md：变更标题不可读——完整变更恒变更名兜底、轻量变更50字截断长句；工具侧需强制agent命名10-30字 → 已关闭（sillyspec 仓 short-change-title + title-range-gate 归档，工具侧硬门/提炼/动机回退齐；已移入 finished/） -->
<!-- tick-timing-squash-blindspot.md：勾选时点「一把勾」警告结构性误报——判定读git历史形态与官方压扁口径自相矛盾+「对应提交」指令歧义+反馈只在收口终点（2026-10-16-change-title-condense-backfill 实证）→ 已关闭（sillyspec 仓 2026-10-17-tick-timing-source 归档 d47f7cf0，判定换源侧车墙钟时戳+tick 回显现成命令+文案消歧；已移入 finished/） -->
<!-- ── 以下为仍活跃坑（2026-10-17 审计补录此前漏挂的三条索引） ── -->
<!-- cli-cwd-coupling.md：sillyspec CLI cwd 耦合——worktree/子目录内跑把 cwd 当独立 spec root（进度库分裂风险；入口守卫已收窄，自动锚定主仓根延后为设计级变更）（2026-10-12 记录，2026-10-13 处置复核：保持活跃） -->
<!-- external-mode-no-root-session-resolution.md：双形态契约守则——external 模式（无根会话）parent 链/根会话解析（已知断裂点已修+冒烟用例已落；守则参考文档长期活跃，不随单点修复归档）（2026-09-11） -->
<!-- verify-gate-worktree-crossrepo-three-defects.md：verify 门禁三缺陷——同文件叠加多变更快照破（设计项余留）/跨仓 node:test 行级误计（已修）/冒烟 cwd 假阳性（已修）（2026-09-21，保持活跃：仅缺陷二余项） -->
<!-- archive-half-state-location-stuck-active.md：归档半态保底缺口——location（文件树通道）与 status（DB 通道）双通道半成功 + 重试挂「下一条命令」死事件源，已归档变更平台「进行中」幽灵滞留（2026-10-17 实证 54 分钟）→ 已关闭（2026-10-17-archive-terminal-sync-strict 5147c63f：triggerSyncTerminalStrict 三终态点强校验——终态判定/内联有界/🚨+自救命令+exit1；560af6a2 signal 形状修复 dogfood 实战验证；terminal-sync-strict 10/10 绿；存量半态一次性手动 platform sync 收敛；2026-10-18 已移入 finished/） -->
<!-- 2026-10-19-sillyspec-v3.33.1-rewrites-agents-md-deletes-claude-md.md：v3.33.1 自升级静默重写 AGENTS.md + 删 .claude/CLAUDE.md（工作区事件 + 工具三项修复要求）→ 已关闭（2026-10-19 用户裁决落地 b35291abb 全部提交、CLAUDE.md 恢复入库；2026-10-20 核查：CLI 面注入仅显式 init 可达、无删除 CLAUDE.md 路径、升级不覆盖仅告警（src/init.js:195/:244）、工具模板剔出交付/冻结/跨仓面（71b3ff3e+6049c3e0）；daemon 平台模式自动 init 属设计语义留文件内注记；2026-10-20 已移入 finished/） -->
