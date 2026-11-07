---
author: qinyi
created_at: 2026-11-06 23:18:20
generated_by: sillyspec-fourpiece-init
change: 2026-11-06-session-git-approval
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 拦截默认全局生效（所有交互式会话）
状态：accepted
日期：2026-11-06
决策人：用户（AskUserQuestion 拍板）
动机：agent 的 git commit/push 一律进确认卡，无需逐会话配置；平台未上线，无存量行为兼容包袱。
影响：daemon 侧拦截不依赖 manual_approval 旗标，在无审批模式的会话（含 ask_user_only 门户会话）同样生效。
代价：现有会话行为改变——以前 agent 直接提交，现在等待用户确认。

## D-002@v1: 真正的 git 操作由平台侧（daemon）代执行，不回交 agent
状态：accepted
日期：2026-11-06
决策人：我的判断（依据用户原话「最终用户点击提交/推送 才真正触发 git 操作」）
动机：用户点击即触发真实操作；若把用户改好的 msg/文件清单交回 agent 重新跑命令，存在 agent 不忠实执行的风险，且多绕一轮。
影响：daemon 收到用户确认后，在 agent 工作目录本机代执行 git add（按勾选重整暂存区）→ git commit / git push，执行结果作为 Bash 工具结果回喂 agent，会话继续。
evidence：挂载先例 sillyhub-daemon/src/interactive/session-manager/permission.ts:393（AskUserQuestion 拦截，答案经工具结果回喂 agent）。

## D-003@v1: v1 拦截范围只限 git commit 与 git push
状态：accepted
日期：2026-11-06
决策人：用户原话（「git 提交或者推送」）+ 我的判断（补充边界）
动机：YAGNI——用户场景是提交/推送前的人工把关。
影响：git add 不拦（无破坏性，且 commit 拦截已覆盖最终落库动作）；git merge / rebase / reset / checkout -- 等历史改写操作不在 v1，后续按需扩展。

## D-004@v1: 确认卡长驻等待，不设超时
状态：accepted
日期：2026-11-06
决策人：我的判断（依据 dialog 机制先例）
动机：用户可能很久才看到卡片；AskUserQuestion dialog 先例即长驻等待（无 5min fail-closed 超时）+ 落库可刷新恢复（GET /api/daemon/sessions/{id}/dialogs）。
影响：git 审批走 dialog_kind 通道（非普通审批的 5min ephemeral timer）；页面刷新后确认卡仍在。
evidence：sillyhub-daemon/src/interactive/permission-resolver.ts（dialog 类请求不设超时的先例）。

## D-005@v1: v1 只覆盖交互式会话（chat），团队分身与批处理 run 不拦
状态：accepted
日期：2026-11-06
决策人：我的判断
动机：团队分身默认在隔离 worktree 工作、由平台 converge 统一 merge 回主分支（不经过 agent 的 commit）；批处理模式（task-runner）无 canUseTool 审批面，v1 不为此新建基建。
影响：范围限定 interactive/claude-sdk-driver 链路；批处理后续可经 claude-settings hooks 白名单扩展（调研备选项，v1 不做）。

## D-006@v1: push 到 main/master 显示警示徽标但不硬拦
状态：accepted
日期：2026-11-06
决策人：我的判断
动机：确认卡上用户点击即视为用户授权，用户是工作区内最高权限；git_gateway 的保护分支硬拦（backend/app/modules/git_gateway/service.py:134）针对用户侧 worktree lease 场景，不复用到会话审批。
影响：确认卡显示目标远程/分支，main/master 加红色警示标识；确认按钮文案不变。

## D-007@v1: 用户拒绝时原因回喂 agent，agent 可调整后重来
状态：accepted
日期：2026-11-06
决策人：我的判断（依据计划审批先例）
动机：与 ExitPlanMode 计划审批同构——deny.message 携带用户反馈，agent 据此修改 msg/文件范围重新发起。
影响：拒绝时前端要求填写或选用快捷原因（可选），回传后 agent 的 Bash 工具结果收到拒绝说明。

## D-008@v1: 实现方案 A——复用 canUseTool 审批管线 + dialog 确认卡
状态：accepted
日期：2026-11-06
决策人：用户（方案选择轮拍板）
动机：改动面最小、回归风险最低——消息协议/审批落库/刷新恢复/SSE 推送/可靠下发/审计全部复用现有 dialog 基建；「确认→daemon 本机代执行→结果回喂」闭环同进程完成。
影响：daemon 在 buildCanUseToolCallback 加 git 识别分支（拆复合命令逐段匹配防绕过）→ 发 dialog_kind='git_approval' 审批请求（payload 带操作类型/解析出的 msg/工作区改动清单）→ 前端确认卡 → 用户决策经 PERMISSION_RESPONSE 回 daemon → daemon 代执行 git add（按勾选重整暂存区，--pathspec-from-file）/git commit/git push → 结果作为 Bash 工具结果回喂 agent。
evidence：sillyhub-daemon/src/interactive/session-manager/permission.ts:393（AskUserQuestion 拦截分支先例）、permission.ts:471（ExitPlanMode dialog 先例）。

## D-009@v1: 确认卡 UI 锚定 AskUserQuestion 对话卡形态
状态：accepted
日期：2026-11-06
决策人：用户（方案选择轮补充：「会话触发的页面效果类似会话的 AskUserQuestion 只是内容修改」）
动机：用户明确锚定现有交互形态，降低学习成本；AskUserDialogCard + PendingDialogDock（替换输入栏位置 + 最小化胶囊 + 刷新恢复）是平台最成熟的对话卡先例。
影响：新卡复用 PendingDialogDock 挂载模式（替换 SessionInputBar 位置），内容区改为 git 确认面板（文件树勾选 + msg 编辑 + diff 查看，复用 git-log 组件）；双模式挂载（session-panel-page 与 session-panel-dialog）。
evidence：frontend/src/components/daemon/pending-dialog-dock.tsx、frontend/src/components/ask-user-dialog-card.tsx。

## D-010@v1: 落选方案 B——PreToolUse hook 拦截（claude-settings hooks 白名单扩展）
状态：rejected
日期：2026-11-06
否决理由：hook 只能 deny 无对话能力，「deny→审批→代执行」状态串联需全自建，复杂度高于方案 A；作用面覆盖批处理但 v1 范围明确不含批处理（违反 D-005）；复合命令绕过问题在 hook 层同样存在，无额外收益。
复潮条件：批处理模式的 git 审批成为硬需求，且 canUseTool 面无法扩展到批处理时（届时 hook 方案的「全进程覆盖」优势才成立）。

## D-011@v1: 落选方案 C——agent 无 git 执行权 + 平台 MCP 工具 API 化
状态：rejected
日期：2026-11-06
否决理由：需改造所有 agent 的工作方式（prompt/skill 适配新工具），改动面与回归风险最大；deny 规则本身仍依赖命令识别（绕过问题不消失）；与用户「agent 自然触发时拦截」的需求意图不符；与 D-002 代执行回喂语义冲突最大。
复潮条件：平台决定彻底收编 agent 的 git 能力（禁一切裸 git），且愿意承担全量 prompt/工具链改造时。

## D-012@v1: 确认卡文件列表为目录树形态 + 增删行数统计
状态：accepted
日期：2026-11-06
决策人：用户（原型评审两轮反馈）
动机：用户明确要求「文件按结构树形式展示不要平铺」「还要显示 +11 -4 这样的信息」。
影响：文件列表 = 顶层状态三分组（已暂存/未暂存改动/未跟踪）+ 组内目录树（路径逐级折叠、文件行只显 basename）+ 四色状态徽标 + 行级 checkbox + 增删行数（git diff --numstat，暂存区文件取 --cached 口径）；目录节点支持目录级勾选（勾目录=勾其下全部文件）与子树增删聚合 + 已选/总数。实现复用 git-log buildFileTree 形态 + turn-file-changes numstat 采集先例。
evidence：frontend/src/components/git-log/file-tree.tsx（buildFileTree）、sillyhub-daemon/src/interactive/turn-file-changes.ts（numstat 采集）。

## D-013@v1: 识别覆盖 sillyspec push，确认后原样代执行（保留压扁语义）
状态：accepted
日期：2026-11-06
决策人：用户（design 撰写中指出「考虑 sillyspec push 技能」）
动机：本仓 agent 的规范推送路径是 sillyspec push CLI（技能 .claude/skills/sillyspec-push 明令禁止直接 git push），CLI 内部自行压扁+推送、不经 agent Bash——只认 git push 的识别层会漏拦规范路径，拦截形同虚设。
影响：guard 扩展识别 sillyspec push（--dry-run 只输出计划、--no-push 只压扁不推送、--undo 恢复压扁不推送 → 不拦〔审查增量复审补录：--undo 同为无推送副作用〕；默认/ --mode / --remote / --branch 等会推送形态 → 拦）；intent 增加 runner 字段（git | sillyspec）；确认后 executor 按 runner 分流——git 代执行 git push，sillyspec 原样代执行 agent 原始命令（不附加任何参数；原命令带 --json 则回 json 输出，否则回人类可读输出）。
evidence：.claude/skills/sillyspec-push/SKILL.md:17-22（命令形态）、:58（禁止直接 git push）、:68（CLI 锁）。

## D-014@v1: 推送确认卡按条展示待推送提交明细
状态：accepted
日期：2026-11-06
决策人：用户（design 撰写中指出「要能显示对应的多个提交信息回显（按每条提交内容展示）」）
动机：用户要在确认推送前看到每条将推送的提交内容，不只一个数字。
影响：payload aheadCommits 每条含 sha/subject/author/date（≤20 条超出显统计行）；前端 push 态逐条渲染（sha 徽标 + 提交首行 + 作者/日期次要行）；数据来自 daemon 采集 git log @{u}..HEAD。

## D-015@v1: 推送确认卡单条提交可展开文件明细
状态：accepted
日期：2026-11-07
决策人：用户（原型评审反馈：「点开能展示具体的提交文件信息，和提交那边展示效果类似」）
动机：用户在确认推送前需要看到每条提交具体改了哪些文件，展示效果与提交确认卡一致。
影响：payload aheadCommits[].files 每条带该提交文件清单（path/status/增删行数，git log --name-status --numstat 一次采集）；前端提交行可展开，展开态 = 文件明细行（状态点 + 路径 + +/- 统计 + 状态徽标，与提交确认卡同款展示、纯浏览不可勾选）。

## D-016@v1: 仅写校验分支补 git 审批最小接线（D-001 可达性修复）
状态：accepted
日期：2026-11-07
决策人：我的判断（独立设计审查阻断项 1 的修复裁定）
动机：审查实证 driver-factory.ts:375 仅写校验分支（无 manual_approval 的会话）注入独立构造器 _buildWriteOnlyCanUseToolCallback 且无 resolver/WS 通道——原设计把 git 分支挂 buildCanUseToolCallback 在该分支不可达，D-001「全局生效」落空。三个选项中「补接线」是唯一不违背用户已拍板 D-001 的路径（收窄/排除等于回到方案选择轮已否掉的「跟随 manual_approval」）。
影响：driver-factory.ts 进文件清单——仅写校验分支构造 PermissionResolver + 注入 git 拦截分支（普通工具写校验路径不变）；W1 增「会话启动即拦截可达」单测；R-12 登记 resolver 时序风险。
evidence：sillyhub-daemon/src/interactive/session-manager/driver-factory.ts:301-381（审查锚点）。

## D-017@v1: git 拦截先于 askUserOnly 自动放行判断
状态：accepted
日期：2026-11-07
决策人：我的判断（审查 gap 修复）
动机：门户会话 manual_approval=true + ask_user_only=true 除 AskUserQuestion 外全部自动放行——若该放行判断先于 git 分支，git 写操作被自动放行漏拦。
影响：permission.ts 的 git 拦截分支置于 askUserOnly 判断之前：git 写操作永远人审，不受「只问不审」门户模式影响。

## D-018@v1: 代执行精确暂存区重整，不裸 reset
状态：accepted
日期：2026-11-07
决策人：我的判断（审查 gap 修复：共享暂存区冲突）
动机：裸 git reset 清空整个暂存区——共享工作区可能有其他会话已 staged 的文件，代执行会替别人清理（违反仓纪 SKILL.md:69）。
影响：executor 对「已暂存但未勾选」文件 git reset -- <paths>、对「勾选但未暂存」文件 git add -- <paths>、其余不动；他人暂存原样保留。

## D-019@v1: 后台锚点态（backgroundTask）git 审批走 5min 兜底 deny
状态：accepted
日期：2026-11-07
决策人：我的判断（审查 gap 修复）
动机：resolver 既有行为 backgroundTask=true 时 dialog 也启 5min 兜底——后台任务无人值守，git 提交自动拒绝回喂（agent 不提交继续干）是正确的 fail-safe 语义，不改变既有机制。
影响：W4 覆盖 resolved（含超时 deny）事件到达后待决卡即时清理（防僵尸卡点批准报 unknown_request，R-11）。

## D-020@v1: task-14 联调拆两段——单测级已验证 + 部署后清单（不虚报完成）
状态：accepted
日期：2026-11-07
决策人：我的判断（执行期非破坏性裁决）
动机：真实三场景联调需部署本变更代码到运行栈（backend 镜像重建/daemon 重启/前端构建），部署是平台侧独立动作、超出本变更 execute 范围；运行中栈为主仓版本无法承载联调。
影响：联调记录 integration-notes.md 如实区分已验证面（单测/组件级 137 用例全绿，含 R-12 启动即可达/D-017 先序/D-019 分发面）与待部署验证面（6 项清单照 task-14 卡脚本执行）；缺陷回流对应任务卡。不勾选 task-14 为「已完成」以外的语义——单测级 verify 全跑（卡 verify 第 3 条），部署后清单移交。

## D-021@v1: git push --dry-run 同判据不拦（D-013 一致性外延）
状态：accepted
日期：2026-11-07
决策人：我的判断（task-07 执行期，测试暴露后修实现）
动机：git push --dry-run 是 git 原生 flag（模拟推送不执行、无推送副作用），与 sillyspec push --dry-run 同判据——按 D-013「无推送副作用不拦」应放行；原实现漏了裸 git push 的该形态。
影响：git-command-guard parsePush 遇 --dry-run 返回 null；task-07 用例锚定（'git push --dry-run || git push' 命中第二段）。
