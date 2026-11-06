---
author: qinyi
created_at: 2026-11-06 22:25:04
generated_by: sillyspec-fourpiece-init
change: 2026-11-06-session-reopen-no-cwd
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 方案形态=组合方案（创建时回报 cwd 入库 + reopen 时 daemon 双源解析兜底）
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: 修复做到哪一层——只做重开时救回，还是同时把真实 cwd 回报入库？
- answer: 用户 AskUserQuestion 拍板选组合方案：① daemon 创建会话后把实际运行目录回报 backend 持久化到 session.cwd（防患在前，会话列表可显示目录、后续 reopen 直查）+ ② reopen 时 daemon 从本地 sessions.json / transcript 扫描双源解析兜底救回存量。两条腿共享同一套 daemon→backend 回报通道。
- normalized_requirement: 非工作区会话创建后，daemon 将实际 cwd 回传 backend 落 session.cwd；session.cwd 为空的存量会话 reopen 时不再被 backend 提前 409，由 daemon 本地解析 cwd 后完成 SDK resume；解析失败回明确错误。
- impacts: [FR-01, FR-02, FR-03]
- evidence: 用户 2026-11-06 会话 AskUserQuestion 回答「组合方案（推荐）」；backend/app/modules/daemon/session/service/session_lifecycle.py:133-139（DS-7 现行拒绝点）；sillyhub-daemon/src/daemon.ts:10145（daemon 侧 workspace_dir 兜底事实 cwd）
- 故障面: 回报通道失败时 session.cwd 仍空——退化到 ② 兜底路径，行为不劣于纯②方案；daemon 本地记录（sessions.json/transcript）被清理时存量会话仍救不回（报明确错误，优于现在的静默 409）。
- 退役判据: 若平台未来引入 backend 可控的统一沙箱目录服务（会话目录由 backend 分配且跨机可寻址），本「daemon 回报+解析」机制可简化为直存分配目录。

## D-002@v1: DS-7 校验放宽——空 cwd 不再提前 409，放行至 daemon 解析
- type: compatibility
- priority: P0
- status: accepted
- source: code
- question: backend reopen 前置校验中 session.cwd 为空的拒绝（DS-7 / DaemonSessionNoCwd）如何处置？
- answer: 我的判断：删除「空 cwd 即 409」的提前拒绝，改为放行（前提：agent_session_id 经既有自愈链非空）；SESSION_RESUME payload 对空 cwd 会话不带 cwd 键，daemon 侧解析。daemon 双源（本地 sessions.json 记录 → 按 agent_session_id 扫 transcript 目录）都失败时 mark recovery failed，backend 收敛会话为 failed 并向用户报明确中文错误（无可用对话存档）。NO_CWD 错误码退役或语义收窄至 daemon 侧解析失败回报。
- normalized_requirement: reopen 链路对 session.cwd 为空且 agent_session_id 非空的会话不再 backend 侧提前拒绝；cwd 解析职责移至 daemon；解析失败有明确错误回报（非静默）。
- impacts: [FR-02, FR-04]
- evidence: backend/app/modules/daemon/session/service/session_lifecycle.py:133-139（现行 DS-7 拒绝）；.sillyspec/changes/archive/2026-08-21-session-reopen-resume/design.md（DS-7 原始依据：空 cwd SDK resume 必失败——本案通过 daemon 侧先解析出 cwd 再 resume 化解该前提）；sillyhub-daemon/src/daemon.ts:9503（reopen record cwd 现取 payload 原样）
- 故障面: 放行后 daemon 解析失败的开销（一次 lease 创建+resume 尝试+失败收敛）——用明确错误换取能力，可接受；scan/bootstrap 会话也顺带获得可重开能力（见 D-004）。

## D-003@v1: cwd 真相源在 daemon——backend 无既有可靠数据源，自愈必须发生在 daemon 侧
- type: feasibility
- priority: P0
- status: confirmed
- source: code
- question: backend 能否像 takeover 的 _latest_agent_cwd 先例那样从日志表回填非工作区会话 cwd？
- answer: 查证否：takeover 的数据源 platform_agent_logs（AgentSessionLogORM）是本地 CLI 直用日志上报通道，workspace_id NOT NULL——非工作区会话不入该表；AgentRun/AgentRunLog 无 cwd 落库值。真实 cwd 只存在于 daemon 本地：① sessions.json 持久化（含 agentSessionId+cwd，reopen 路径已有读取先例）② transcript 文件本身（$CLAUDE_CONFIG_DIR/projects/ 下按 sid 定位，claude-transcript-dir.ts 已有线性扫描能力）。故 cwd 回报与解析均放 daemon 侧实现。
- normalized_requirement: 不引入 backend 侧 cwd 推导；daemon 为 cwd 唯一真相源，经回报通道同步给 backend。
- impacts: [FR-01, FR-02, FR-05]
- evidence: backend/app/modules/platform_sync/model.py:191-238（AgentSessionLogORM workspace_id NOT NULL、表语义为 CLI 直用通道）；backend/app/modules/daemon/session/service/takeover.py:115-131（_latest_agent_cwd 先例及其表限定）；sillyhub-daemon/src/interactive/session-store-persistence.ts:181（sessions.json 持久化含 cwd）；sillyhub-daemon/src/interactive/claude-transcript-dir.ts:138-142（按文件名 <sid>.jsonl 扫描定位能力）
- 故障面: daemon 本地文件被清理（换机/重装/手动删）时该会话永久不可恢复——边界如实报错。

## D-004@v1: scan/bootstrap 会话顺带获得可重开能力，接受为行为扩展
- type: boundary
- priority: P1
- status: accepted
- source: docs
- question: DS-7 当初的语境是「scan/bootstrap 一次性会话不写 cwd」——放宽后这类会话也被 reopen 放行，是否需要排除？
- answer: 我的判断：不排除。scan/bootstrap 会话同为 daemon 托管 interactive 会话，transcript 同在 daemon 本地，重开语义一致且无破坏性（原设计只是「不需要」而非「不允许」）；用户多得一个能力，无额外风险面。daemon 解析失败时统一报错兜底。
- normalized_requirement: reopen 放行口径统一为「agent_session_id 可解析」，不按会话来源（工作区/非工作区/scan/bootstrap）区分。
- impacts: [FR-02]
- evidence: .sillyspec/changes/archive/2026-08-21-session-reopen-resume/design.md（DS-7 scan/bootstrap 语境）；backend/app/modules/daemon/session/service/session_lifecycle.py:133-135（注释口径「scan/bootstrap 会话不写 cwd」）
- 故障面: scan 会话重开后用户在非代码目录上下文续聊，语义略漂移——低风险接受。

## D-002@v2: daemon 侧 cwd 解析三级同源兜底链（payload → 本地快照 → workspace_dir）
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: daemon 侧解析真实 cwd 的取值链如何设计？（v1 写「sessions.json / transcript 扫描双源」，吸收外部会话增量后修订）
- answer: 三级取值：SESSION_RESUME payload 携带的 cwd（工作区会话非空，零变化）→ 本机 sessions.json 持久化快照的 record.cwd → config.workspace_dir 兜底。第三级是关键增量：非工作区会话当初 create 就是用 workspace_dir 兜底跑的（daemon.ts:10145 同一条规则），快照被清后直退 workspace_dir 天然命中原 transcript 归档目录——与 create 同源，无需 transcript 线性扫描（v1 设想的扫描步骤砍掉，YAGNI：resume 本身对错目录会 throw，由既有 markRecoveryFailed 链兜底翻 failed，无需预验证）。supersedes D-002@v1（其余语义不变：DS-7 放行、NO_CWD 收窄）。
- normalized_requirement: daemon _routeSessionResume 构造恢复记录时 cwd 按三级链取值；解析结果（最终生效 cwd）随确认回报 backend 持久化 session.cwd。
- impacts: [FR-02, FR-04]
- evidence: sillyhub-daemon/src/daemon.ts:10145（create 兜底规则：空 rootPath 一律回落 workspace_dir）；sillyhub-daemon/src/daemon.ts:9503（reopen record.cwd 现取 payload 原样，改造点）；sillyhub-daemon/src/interactive/session-store-persistence.ts:181（快照含 cwd）；backend/app/modules/daemon/session/service/recovery.py:627-633（resume 失败翻 failed 既有链路，cwd mismatch 场景注释明载）；外部会话分析增量（用户 2026-11-06 转发）
- 故障面: workspace_dir 配置在会话存活期间被用户改过 → 第三级指错目录 → resume throw → markRecoveryFailed 翻 failed 报错（不静默错聊，低概率接受）；transcript 按新 workspace_dir 下不存在时无预检，靠 resume 失败兜底（可接受：错误路径已有收敛）。
- 退役判据: 若 daemon 未来持久化快照加超龄清除策略且窗口极短（快照常态缺失），三级链退化为两级仍成立，机制保留。

## D-005@v1: 否决「backend 创建时分配平台托管路径下发 daemon」原始方向①形态
- type: architecture
- priority: P0
- status: rejected
- source: code
- question: 是否采用用户候选方向①原形——backend 给非工作区会话分配平台托管目录作为 cwd 下发？
- answer: 否决。backend 不知道哪台机器接手会话（placement 动态），下发的目录在目标机器上无存在性保证——会撞 daemon 的 workspace_bound_cwd 守卫（stat 不存在 → cwd_not_found 拒绝）或误导 mkdir；且完全不解决存量已 409 会话。方向①的精神（backend 早点知道 cwd）由 D-001 的「daemon 创建后回报实际 cwd」替代实现。
- normalized_requirement: 不新增 backend 侧 cwd 分配逻辑；平台不规定非工作区会话的运行目录，只记录 daemon 实际使用的目录。
- impacts: [FR-01]
- evidence: sillyhub-daemon/src/daemon.ts:10174-10214（workspace_bound_cwd 守卫：stat 不存在拒绝、绝不 mkdir）；backend/app/modules/daemon/session/service/inject_gates.py:320-323（现状 cwd 赋值逻辑）
- 否决理由: 跨机路径存在性无法保证（撞 daemon cwd 守卫或诱发错机 mkdir），且救不了存量会话。
- 复潮条件: 平台引入 backend 可控、跨机可寻址的统一沙箱目录服务时，可重议「平台分配目录」形态。

## D-006@v1: 否决「按会话来源（origin）分流放行」——origin 列区分不了 chat 与 scan/bootstrap
- type: feasibility
- priority: P1
- status: rejected
- source: code
- question: 外部会话建议 DS-7 门按 origin 分流（origin='chat' 且 cwd 空放行、scan/bootstrap 维持 409）——是否采纳？
- answer: 否决。查证：scan/bootstrap 会话创建时不传 origin（backend/app/modules/spec_workspace/bootstrap.py:498-510 无 origin 键），落列默认 'chat'（backend/app/modules/agent/model.py:859-866 default='chat'）——与用户闲聊会话同值，origin 列无法区分两者。要分流需依赖 config JSON 谓词（'mode'='scan'，不可索引、隐式契约）或新增列（迁移成本），且 D-004 已判定 scan 会话可重开无破坏性——分流付出成本买不到收益。
- normalized_requirement: reopen 放行口径不引入会话来源维度（维持 D-004 统一口径：agent_session_id 可解析即放行）。
- impacts: [FR-02]
- evidence: backend/app/modules/spec_workspace/bootstrap.py:498-510（scan 会话创建无 origin 传值）；backend/app/modules/agent/model.py:859-866（origin default='chat'）；外部会话分析（用户 2026-11-06 转发）建议 origin 分流
- 否决理由: origin 列对 chat/scan 同值（均 'chat'），分流前提不成立；改用 config 谓词或新列的成本买不到对应对价（scan 可重开本身无害，D-004）。
- 复潮条件: 平台若显式区分「闲聊会话」与「内部任务会话」产品语义（如新增 session_kind 正式取值且 scan 类会话明确禁止用户重开的产品决策落定），可重议按来源收紧。

## D-007@v1: cwd 回报载体=捎带既有通道（notifySessionReady / confirmReconnected 加可选 cwd 键）
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: daemon→backend 的 cwd 回报通道用什么载体——捎带既有消息 vs 独立新端点？
- answer: 用户 AskUserQuestion 拍板方案 A：notifySessionReady（create/recover 双覆盖的成功上报）与 confirmReconnected（reopen 恢复确认）两条既有消息加可选 cwd 键，backend 端点收到即落 session.cwd。键位可选、前向兼容：老 backend 忽略新键、老 daemon 不发键，灰度期双向安全。
- normalized_requirement: 不新增 REST 端点/鉴权面；backend 两个接收端点解析可选 cwd 键并持久化 session.cwd（空/缺键 no-op）；daemon 两个发送点携带实际生效 cwd。
- impacts: [FR-01, FR-02, FR-03]
- evidence: sillyhub-daemon/src/daemon.ts:9581（notifySessionReady create/recover 双覆盖注释）；sillyhub-daemon/src/daemon.ts:9567（confirmReconnected 调用点）；用户 2026-11-06 AskUserQuestion 回答「方案 A：捎带既有通道（推荐）」
- 故障面: 两条消息 best-effort，失败时会话行暂无 cwd——由 reopen 兜底链覆盖（最终一致）；回报乱序（create 与 confirm 并发）幂等写同值无害。
- 退役判据: 若未来 cwd 需要独立观测/重放（如同步审计），再评估独立端点。

## D-008@v1: 否决「独立 cwd 回报 REST 端点」
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: cwd 回报通道是否新建专用 REST 端点（方案 B）？
- answer: 用户选定方案 A 后落选。独立端点仅买到「回报流量与确认流量分离、单独观测」，代价是常驻新鉴权面（api-key 通道）+ 每会话多一次 HTTP 调用 + 协议面膨胀；捎带方案已覆盖同等能力。
- normalized_requirement: 不为 cwd 回报新建端点。
- impacts: [FR-01]
- evidence: 用户 2026-11-06 AskUserQuestion（方案 B 落选）
- 否决理由: 观测分离的收益配不上新鉴权面与协议膨胀的成本，能力与方案 A 等价。
- 复潮条件: cwd 回报需要独立重放/审计/高频观测语义时（捎带通道无法满足）可重议。
