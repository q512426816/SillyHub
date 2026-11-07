# 决策知识 — unmapped

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-unmapped-335@v1 方案形态=组合方案（创建时回报 cwd 入库 + reopen 时 daemon 双源解析兜底）
状态：implemented
变更：2026-11-06-session-reopen-no-cwd
原编号：D-001@v1
锚点：未记录
最近确认：ee6c18fa7
理由：用户 AskUserQuestion 拍板选组合方案：① daemon 创建会话后把实际运行目录回报 backend 持久化到 session.cwd（防患在前，会话列表可显示目录、后续 reopen 直查）+ ② reopen 时 daemon 从本地 sessions.json / transcript 扫描双源解析兜底救回存量。两条腿共享同一套 daemon→backend 回报通道。
故障面：回报通道失败时 session.cwd 仍空——退化到 ② 兜底路径，行为不劣于纯②方案；daemon 本地记录（sessions.json/transcript）被清理时存量会话仍救不回（报明确错误，优于现在的静默 409）。
退役判据：若平台未来引入 backend 可控的统一沙箱目录服务（会话目录由 backend 分配且跨机可寻址），本「daemon 回报+解析」机制可简化为直存分配目录。

## D-unmapped-336@v2 daemon 侧 cwd 解析三级同源兜底链（payload → 本地快照 → workspace_dir）
状态：implemented
变更：2026-11-06-session-reopen-no-cwd
原编号：D-002@v2
锚点：未记录
最近确认：ee6c18fa7
理由：三级取值：SESSION_RESUME payload 携带的 cwd（工作区会话非空，零变化）→ 本机 sessions.json 持久化快照的 record.cwd → config.workspace_dir 兜底。第三级是关键增量：非工作区会话当初 create 就是用 workspace_dir 兜底跑的（daemon.ts:10145 同一条规则），快照被清后直退 workspace_dir 天然命中原 transcript 归档目录——与 create 同源，无需 transcript 线性扫描（v1 设想的扫描步骤砍掉，YAGNI：resume 本身对错目录会 throw，由既有 markRecoveryFailed 链兜底翻 failed，无需预验证）。supersedes D-002@v1（其余语义不变：DS-7 放行、NO_CWD 收窄）。
故障面：workspace_dir 配置在会话存活期间被用户改过 → 第三级指错目录 → resume throw → markRecoveryFailed 翻 failed 报错（不静默错聊，低概率接受）；transcript 按新 workspace_dir 下不存在时无预检，靠 resume 失败兜底（可接受：错误路径已有收敛）。
退役判据：若 daemon 未来持久化快照加超龄清除策略且窗口极短（快照常态缺失），三级链退化为两级仍成立，机制保留。

## D-unmapped-337@v1 cwd 真相源在 daemon——backend 无既有可靠数据源，自愈必须发生在 daemon 侧
状态：implemented
变更：2026-11-06-session-reopen-no-cwd
原编号：D-003@v1
锚点：未记录
最近确认：ee6c18fa7
理由：查证否：takeover 的数据源 platform_agent_logs（AgentSessionLogORM）是本地 CLI 直用日志上报通道，workspace_id NOT NULL——非工作区会话不入该表；AgentRun/AgentRunLog 无 cwd 落库值。真实 cwd 只存在于 daemon 本地：① sessions.json 持久化（含 agentSessionId+cwd，reopen 路径已有读取先例）② transcript 文件本身（$CLAUDE_CONFIG_DIR/projects/ 下按 sid 定位，claude-transcript-dir.ts 已有线性扫描能力）。故 cwd 回报与解析均放 daemon 侧实现。
故障面：daemon 本地文件被清理（换机/重装/手动删）时该会话永久不可恢复——边界如实报错。

## D-unmapped-338@v1 scan/bootstrap 会话顺带获得可重开能力，接受为行为扩展
状态：implemented
变更：2026-11-06-session-reopen-no-cwd
原编号：D-004@v1
锚点：未记录
最近确认：ee6c18fa7
理由：我的判断：不排除。scan/bootstrap 会话同为 daemon 托管 interactive 会话，transcript 同在 daemon 本地，重开语义一致且无破坏性（原设计只是「不需要」而非「不允许」）；用户多得一个能力，无额外风险面。daemon 解析失败时统一报错兜底。
故障面：scan 会话重开后用户在非代码目录上下文续聊，语义略漂移——低风险接受。

## D-unmapped-339@v1 否决「backend 创建时分配平台托管路径下发 daemon」原始方向①形态
状态：rejected
变更：2026-11-06-session-reopen-no-cwd
原编号：D-005@v1
锚点：未记录
最近确认：ee6c18fa7
理由：否决。backend 不知道哪台机器接手会话（placement 动态），下发的目录在目标机器上无存在性保证——会撞 daemon 的 workspace_bound_cwd 守卫（stat 不存在 → cwd_not_found 拒绝）或误导 mkdir；且完全不解决存量已 409 会话。方向①的精神（backend 早点知道 cwd）由 D-001 的「daemon 创建后回报实际 cwd」替代实现。
否决理由：跨机路径存在性无法保证（撞 daemon cwd 守卫或诱发错机 mkdir），且救不了存量会话。
复潮条件：平台引入 backend 可控、跨机可寻址的统一沙箱目录服务时，可重议「平台分配目录」形态。

## D-unmapped-340@v1 否决「按会话来源（origin）分流放行」——origin 列区分不了 chat 与 scan/bootstrap
状态：rejected
变更：2026-11-06-session-reopen-no-cwd
原编号：D-006@v1
锚点：未记录
最近确认：ee6c18fa7
理由：否决。查证：scan/bootstrap 会话创建时不传 origin（backend/app/modules/spec_workspace/bootstrap.py:498-510 无 origin 键），落列默认 'chat'（backend/app/modules/agent/model.py:859-866 default='chat'）——与用户闲聊会话同值，origin 列无法区分两者。要分流需依赖 config JSON 谓词（'mode'='scan'，不可索引、隐式契约）或新增列（迁移成本），且 D-004 已判定 scan 会话可重开无破坏性——分流付出成本买不到收益。
否决理由：origin 列对 chat/scan 同值（均 'chat'），分流前提不成立；改用 config 谓词或新列的成本买不到对应对价（scan 可重开本身无害，D-004）。
复潮条件：平台若显式区分「闲聊会话」与「内部任务会话」产品语义（如新增 session_kind 正式取值且 scan 类会话明确禁止用户重开的产品决策落定），可重议按来源收紧。

## D-unmapped-341@v1 cwd 回报载体=捎带既有通道（notifySessionReady / confirmReconnected 加可选 cwd 键）
状态：implemented
变更：2026-11-06-session-reopen-no-cwd
原编号：D-007@v1
锚点：未记录
最近确认：ee6c18fa7
理由：用户 AskUserQuestion 拍板方案 A：notifySessionReady（create/recover 双覆盖的成功上报）与 confirmReconnected（reopen 恢复确认）两条既有消息加可选 cwd 键，backend 端点收到即落 session.cwd。键位可选、前向兼容：老 backend 忽略新键、老 daemon 不发键，灰度期双向安全。
故障面：两条消息 best-effort，失败时会话行暂无 cwd——由 reopen 兜底链覆盖（最终一致）；回报乱序（create 与 confirm 并发）幂等写同值无害。
退役判据：若未来 cwd 需要独立观测/重放（如同步审计），再评估独立端点。

## D-unmapped-342@v1 否决「独立 cwd 回报 REST 端点」
状态：rejected
变更：2026-11-06-session-reopen-no-cwd
原编号：D-008@v1
锚点：未记录
最近确认：ee6c18fa7
理由：用户选定方案 A 后落选。独立端点仅买到「回报流量与确认流量分离、单独观测」，代价是常驻新鉴权面（api-key 通道）+ 每会话多一次 HTTP 调用 + 协议面膨胀；捎带方案已覆盖同等能力。
否决理由：观测分离的收益配不上新鉴权面与协议膨胀的成本，能力与方案 A 等价。
复潮条件：cwd 回报需要独立重放/审计/高频观测语义时（捎带通道无法满足）可重议。
