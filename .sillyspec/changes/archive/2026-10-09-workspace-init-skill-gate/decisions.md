---
author: qinyi
created_at: 2026-10-09 10:16:41
---

# 决策记录 — 2026-10-09-workspace-init-skill-gate

## D-001@v1: init 时写入 skill 走 sillyspec init 自带 skills 复制（去掉 --no-skills）
- type: boundary
- status: accepted
- source: user
- question: 初始化写入的 skill 文件内容源是什么？（平台技能包分发 / 接入说明 skill / sillyspec init 自带）
- answer: 用户明确「sillyspec init 里面会写 skill」——即启用 sillyspec CLI init 自带的 skills 复制段（daemon 侧 runSillyspecInit 当前以 --no-skills 关闭）。本决策修订 2026-08-15-init-trigger-sillyspec-init 变更 D-004@v1（supersedes）。
- normalized_requirement: runSillyspecInit 不再传 --no-skills；--tool 传机器上探测到的 agent 与 CLI VALID_TOOLS 的交集，多种全写、不支持的自然跳过、交集为空兜底 ['claude']（现有兜底逻辑保留）；skill-manager 链路不动（平台自定义技能仍走 skill-manager 单渠道写 .claude/skills）。
- impacts: [FR-01, FR-02]
- evidence: 用户回答轮次 1（AskUserQuestion）；sillyhub-daemon/src/spec-sync.ts:1848（--no-skills 现状）；sillyspec CLI src/init.js:474-499（skills 复制段 + 工具目录映射 claude/codex/openclaw/opencode/zcode 五端）；.sillyspec/changes/archive/2026-08-15-init-trigger-sillyspec-init/decisions.md:47（D-004@v1 原始理由「双渠道冲突」——实测两渠道 sillyspec-* 内容同源后写覆盖，冲突可接受）
- 故障面: 双渠道在 .claude/skills/sillyspec-* 上后写覆盖（skill-manager spawn 前 link 覆盖 init 时写入），版本可能漂移（daemon 本地 npm 包 vs 服务器 bundle 静态目录），无害。
- 退役判据: skill-manager 升级为多端分发时，可再次关闭 init 复制段恢复单渠道。

## D-002@v1: 未初始化门禁仅前端引导，后端不硬拦
- type: boundary
- status: accepted
- source: user
- question: 「工作区必须初始化后才能使用」拦哪些操作？（后端硬拦任务+扫描 / 仅前端引导 / 拦所有写操作）
- answer: 用户选「仅前端引导」——后端不加硬门禁（不返回 409），前端在成员绑定未初始化（init_synced_at 为空）时对工作区使用入口做引导提示，引导用户去初始化。门禁维度为成员/机器（一台机器未初始化不影响另一台）。
- normalized_requirement: 后端不改派发/扫描校验逻辑；前端未初始化时任务派发/扫描等入口展示引导（具体交互设计阶段定），已初始化状态沿用 workspace_member_runtimes.init_synced_at。
- impacts: [FR-03]
- evidence: 用户回答轮次 1（AskUserQuestion）；backend/app/modules/workspace/member_runtimes/model.py:104-111（init_synced_at 语义）；2026-07-26-ungate-workspace-entry 已确立门禁后移基调。
- 故障面: 直接调 API 绕过前端引导仍可对未初始化工作区派任务（用户已知情选择）。

## D-003@v1: 创建完成后前端串行调用初始化
- type: boundary
- status: accepted
- source: user
- question: 「创建完成直接调用初始化」在哪里触发？
- answer: 用户选「前端串行调用」——创建接口成功返回后，前端紧接着调现有初始化接口（POST /api/workspaces/{id}/init），创建弹窗内展示初始化进度直到完成（复用 handleInit 轮询模式）。创建时未绑定 daemon_id（无法定位机器）则跳过自动初始化，保持现状等用户绑定机器后手动初始化。
- normalized_requirement: 前端创建流程在 createWorkspace 成功且返回绑定信息可用（daemon_id 已传）时，自动串行调用 initDispatch 并轮询 init_synced_at；后端 create 接口语义不变。
- impacts: [FR-04]
- evidence: 用户回答轮次 1（AskUserQuestion）；frontend/src/components/workspace-scan-dialog.tsx:93-98（现状仅刷新列表）；frontend/src/lib/spec-workspaces.ts:174-194（initDispatch 已存在）；frontend/src/components/workspace-config-card.tsx:206-251（handleInit 轮询模式可复用）。

## D-006@v1: init lease 失败禁止回写 init_synced_at（成败门）
- type: consistency
- status: accepted
- source: code
- question: init lease 失败时 init_synced_at 被照写，前端（含现状手动初始化）把失败误报为"已初始化"？
- answer: Grill 独立审查 UB-1 实证：daemon init 失败仍以 status='failed' 走 completeLease 上报（sillyhub-daemon/src/task-runner.ts:1070-1080），后端回写段只判 mode=='init' 不分成败（backend/app/modules/daemon/lease/service.py:531-542）——失败数秒内 init_synced_at 即被写入。修复：回写段加 `result.get("status") != "failed"` 门，失败跳过回写 + warn 日志 init_lease_failed_no_synced。这也是 FR-04 前端"轮询非空=成功"语义成立的前置。
- normalized_requirement: init lease 以 status='failed' complete 时，成员绑定 init_synced_at/init_synced_spec_version 必须保持 NULL；status='completed' 时回写行为不变。
- impacts: [FR-04, FR-05, task-05, task-06]
- evidence: design.md Wave 1 第 4 条；审查 review-2026-10-09-100326 UB-1；task-runner.ts:1070-1080 + lease/service.py:531-542 源码核实（主代理复核确认）。
- 故障面: init 失败后 init_synced_at 恒 NULL，若用户不重试则详情页长期显示"未初始化"——正确语义，重试路径通畅（新 lease 行）。
- 退役判据: 无（字段语义修正，不回退）。

## D-005@v1: 方案A 最小链路
- type: architecture
- status: accepted
- source: user
- question: 实现方案三选一（A 最小链路 / B 工程化复用 / C skill-manager 多端）？
- answer: 用户选方案A：daemon 去掉 --no-skills 让 sillyspec init 按 --tool 交集写多端 skill；版本门控提升 ≥3.32.2；前端创建弹窗串行初始化展示进度；详情页轻引导。否决理由——B：三端抽公共组件改动面大收益小（新增 UI 仅创建弹窗一处，详情页已有完整实现）；C：初始化时刻本地仍无 skill 不满足直接诉求，且动任务执行热路径（skill-manager 每次 spawn 前跑）。
- normalized_requirement: 变更范围限定为 daemon runSillyspecInit 参数与白名单 + 前端创建弹窗与详情页引导；不改 skill-manager、不改后端 create 接口、不做后端硬门禁。
- impacts: [FR-01, FR-02, FR-03, FR-04]
- evidence: 用户回答轮次 2（AskUserQuestion 方案选择）。
- 故障面: 前端串行链路任一环失败（initDispatch 5xx / 轮询超时）都会让"创建即初始化"降级为"已创建待手动初始化"——出口文案必须明示两态，防止用户误以为创建失败。
- 退役判据: 若后端 create 接口未来内嵌派发（原子化），前端串行状态机整体退役。

## D-004@v1: SILLYSPEC_VALID_TOOLS 同步 CLI v3.32.2 补 zcode
- type: architecture
- status: accepted
- source: code
- question: daemon 端 --tool 白名单与 sillyspec CLI 实际支持不一致？
- answer: 代码查证：sillyspec CLI v3.32.2 VALID_TOOLS = [claude, zcode, cursor, openclaw, codex, gemini, opencode]（含 zcode），daemon 端 SILLYSPEC_VALID_TOOLS 落后缺 zcode（注释自述「CLI 新增工具时同步此表」）。zcode 技能复制双层缺口于 2026-10-09 修复（sillyspec commit 016968bd，v3.32.2）。
- normalized_requirement: SILLYSPEC_VALID_TOOLS 补 zcode；版本门控（D-009@v1，≥3.26.8）是否提升在设计阶段定（老版本 CLI 对未知 --tool 值静默忽略且 exit 0，行为安全但 zcode 端拿不到技能）。
- impacts: [FR-01]
- evidence: sillyhub-daemon/src/task-runner/runner-types.ts:173-180（白名单落后）；/c/Users/qinyi/IdeaProjects/sillyspec/src/init.js:80（CLI VALID_TOOLS 含 zcode）；sillyspec commit 016968bd（zcode 修复）。
- 故障面: 机器上 sillyspec 版本 <3.32.2 时 zcode 端技能复制静默缺失（CLI 静默忽略未知 tool）。
- 退役判据: 无（跟随 CLI VALID_TOOLS 演进同步）。
