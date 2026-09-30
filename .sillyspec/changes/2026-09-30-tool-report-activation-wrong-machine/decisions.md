---
author: qinyi
created_at: 2026-09-30 10:59:41
---

# 决策记录 — 2026-09-30-tool-report-activation-wrong-machine

## D-001@v1: 修复方案 = B（激活链路治本 + machineId 统一身份 + 交接文档委派）

- type: architecture
- source: user
- question: tool_report 会话激活错机派发（cwd 派到无该路径的机器、会话钉死错误机器、回放主体被切走、UI 无机器选择）采用哪种修复方案？
- answer: 用户选定方案 B = 方案 A（上报协议带机器身份入库 + 激活原机钉定派发 + resume 引擎感知 + 激活秒败自动回滚 pending + 页面重置按钮）**加上** machineId 统一身份体系（参考 happy：CLI 生成持久 machineId、平台把上报机器与 daemon_runtimes 统一机器身份），**再加上**不可 resume 会话（如 zcode）的交接机制：平台委派一个新 agent 去执行，将原会话文件上下文生成交接文档，让新 agent 理解之前在做什么。方案对比：A=治本但机器身份靠 hostname 匹配；B=A+统一 machineId（完整 happy 模式）；C=仅前端补救（不治本，弃）。CLI 仓（sillyspec）的 machineId 生成改动跨仓，本变更先做平台侧就绪（协议接收 + hostname 回落），CLI 侧配合另立变更跟踪。
- normalized_requirement: 修复必须同时满足：①上报链路携带并持久化上报机器身份；②激活派发原机优先钉定，原机离线/未装 daemon 时 409 中文报错不静默换机；③claude-code harness 激活携带 resume_session_id 回原引擎会话；④无 adapter harness（zcode 等）激活时生成交接文档并注入新会话上下文；⑤激活秒败自动回滚会话到未激活态；⑥会话面板提供手动重置入口。
- impacts: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
- evidence: 用户方案选择轮（AskUserQuestion 第 3 问回答）；根因诊断实证 backend/app/modules/daemon/session/service/ppm_activation.py:443-459（cwd 取上报 agent_cwd）+ backend/app/modules/agent/placement.py:1592-1780（心跳最新自选机器）；happy 项目参考（C:\Users\qinyi\IdeaProjects\happy 的 packages/happy-cli/src/ui/auth.ts:277 machineId 生成、prisma/schema.prisma Machine (accountId,id) 唯一）
- 故障面: 上报机器身份伪造（CLI 可谎报 hostname/machineId）——按现状威胁模型（个人平台、token 已鉴权）接受；交接文档生成失败需降级为普通新会话激活，不阻塞继续对话。
- 退役判据: 若未来 daemon 为 zcode 类 harness 提供原生 adapter/resume 能力，交接文档机制对该 harness 退役，仅保留无 adapter 引擎兜底。

## D-002@v1: 原机优先，离线报错（不静默换机）

- type: architecture
- source: user
- question: 激活时上报机器（产生日志的机器）离线或未装 daemon 怎么处理？
- answer: 用户选定：原机优先，离线/未装 daemon 时激活直接 409 中文报错（提示是哪台机器、需开机/装 daemon），不静默换机。对齐 happy 的 resumeSessionSameMachineOnly 语义（会话只能回到产生它的机器）。
- normalized_requirement: 激活派发只允许钉定上报机器对应的在线 runtime；无匹配在线 runtime 时激活失败并返回含机器名的中文错误；不回退其它机器。
- impacts: [FR-02]
- evidence: 用户 AskUserQuestion 第 1 问回答；happy 参考 packages/happy-app sources/hooks/useSessionQuickActions.ts:42-99（getResumeAvailability 按机器在线置灰 + resumeSessionSameMachineOnly）

## D-003@v1: 激活秒败自动回滚 + 页面手动重置按钮

- type: architecture
- source: user
- question: 激活失败后的会话状态怎么处理？
- answer: 用户选定：自动回滚+手动按钮——激活轮秒败（如 cwd_not_found）后端自动把会话回滚到未激活态（status=pending、turn_count=0、清 runtime/lease），前端回放主体恢复、可重试；同时会话面板提供手动"重置为未激活"按钮，存量被钉死的会话（如实证的 473a8c37）页面上一点即恢复。
- normalized_requirement: 激活轮以失败终态收敛时（限定秒败/启动类失败，非运行中正常失败），会话回滚到 origin=tool_report 未激活态；提供端点+页面按钮支持对已钉死会话手动执行同款回滚。
- impacts: [FR-05, FR-06]
- evidence: 用户 AskUserQuestion 第 2 问回答 + 追加留言"应该作成个功能……页面上一点击就能恢复"；钉死实证（服务器 agent_sessions 473a8c37 status=active runtime 钉 Mac mini、唯一 run 50737387 failed interactive_interrupted）
- 备注（D-006 后范围收敛）：分叉式接手下原 tool_report 会话不再被激活，"自动回滚"仅适用于**存量已按旧方式激活钉死**的会话（历史数据 + 过渡期）；新会话永不进入需回滚状态。手动重置按钮保留，用于存量钉死会话恢复只读回放态。

## D-004@v1: resume 引擎感知——claude-code 回原会话，zcode 走交接文档

- type: architecture
- source: user
- question: 激活后能否回到原 agent 会话继续对话？（用户指出 zcode 可能回不去、claude code 可以回）
- answer: 代码查证：daemon provider 能力矩阵（backend/app/modules/agent/provider_caps.py 镜像 sillyhub-daemon/src/interactive/providers.ts 单源）仅 claude/codex/pi/cursor 四引擎且 caps.resume=True；zcode 无 adapter，_tool_report_provider 将 zcode 映射到 claude 引擎（backend/app/modules/platform_sync/service.py:103-113），zcode rollout 文件（model-io-sess_*.jsonl）非 claude SDK transcript，不可 resume。结论与用户判断一致：claude-code 上报会话激活时携带 resume_session_id（platform_agent_logs.session_id 即引擎会话 id）回原会话续聊；zcode 等无 adapter harness 激活=平台新 agent 会话 + 交接文档注入（D-001），UI 明示上下文衔接方式。
- normalized_requirement: harness ∈ 可 resume 引擎（claude-code/codex）时激活 lease 携带 resume_session_id=上报 session_id；harness 无 adapter 时激活不带 resume，改为生成交接文档注入首轮上下文；daemon 侧复用既有 resume 损伤自动降级（session-manager.ts:847-894）。
- impacts: [FR-03, FR-04]
- evidence: backend/app/modules/agent/provider_caps.py:26-101（caps 矩阵无 zcode）；backend/app/modules/platform_sync/service.py:103-113（zcode→claude 映射）；sillyhub-daemon/src/interactive/session-manager.ts:847-894（resume + 损伤降级既有）；用户留言"zcode 是不是不能回去？claude code 这种的可以回"（AskUserQuestion 轮间补充）；服务器 platform_agent_logs 实证 zcode session_id 形态=model-io-sess_<uuid>

## D-005@v1: 无 adapter 会话接手 agent 可重选（引擎 + 档案）

- type: architecture
- source: user
- question: zcode 等无 adapter 会话由平台 agent 接手时，用哪个 agent 类型？（设计确认轮用户提出）
- answer: 用户要求：接手时应可重新选择对应机器上的 agent 类型。输入区增加「接手 agent」选择行——引擎下拉（原机 runtime 支持的 provider 集合，按 daemon_instance 聚合 daemon_runtimes）+ 智能体档案下拉（既有 agent_profile），默认按 harness→provider 映射（zcode→claude）。后端配合：inject 激活请求对未激活 tool_report 会话新增 provider/agent_profile_id 参数（未激活时会话 provider 可重选落库，已激活后不可变维持现状）。
- normalized_requirement: 未激活 tool_report 会话且 harness 无 adapter 时，前端展示接手 agent 选择器（引擎∪档案）；激活请求携带所选引擎与档案，服务端校验所选引擎属于原机 runtime 支持集合后更新会话 provider 再派发。
- impacts: [FR-03, FR-05]
- evidence: 用户设计确认轮回答（"未激活 · zcode 会话（交接文档续聊）这个应该可以重新选择对应机器上的 agent 类型啊"）；原型 prototype-tool-report-activation.html 案例②接手 agent 选择行

## D-006@v1: 分叉式接手（本地会话只读，接手=fork 形态新会话）

- type: architecture
- source: user
- question: 本地会话接手架构——原会话激活（新引擎挂原会话下）还是分叉式接手（新建 fork 会话）？
- answer: 用户在"与分叉有什么区别"追问后选定分叉式接手（B）。原 tool_report 会话永远保持只读回放（status=pending、turn_count=0，主体永不切走）；用户发首条消息 = 创建接手会话（复用 2026-09-22-session-fork-continuation 基建）：origin='fork'+fork_of_session_id=源 tool_report 会话+列表「分叉自」回链。按 harness 分档：claude-code/codex（caps.resume=True）→ fork native 档（resume_session_id=上报 session_id，源机钉定，daemon 既有 resume+损伤降级）；zcode 等无 adapter → 新增 handoff 档（用户可重选引擎/档案 D-005，交接文档作为种子 prompt 注入首 prompt，数据源=daemon RPC 读原机日志归一化消息）。与 fork seed 档的关系：机制形态同族（前情转述种子），差异三点——数据源（库 vs 原机日志文件）、机器（seed 档常规选机 vs handoff 档原机钉定）、入口（会话内轮锚点 vs 未激活会话首条消息）。
- normalized_requirement: ①未激活 tool_report 会话不写 active/lease/runtime，任何路径不再原会话激活；②首条消息经接手分叉创建新会话，落 fork 三件套溯源；③native 档带 resume_session_id+源机钉定；handoff 档带交接文档种子+引擎档案重选；④原机离线时 409 中文报错不建会话；⑤重置按钮仅针对存量旧方式激活钉死的会话回滚到只读态。
- impacts: [FR-02, FR-03, FR-04, FR-05]
- evidence: 用户 AskUserQuestion 回答"B. 分叉式接手（推荐）"；fork 基建 backend/app/modules/daemon/session/service/fork.py:107-122（build_seed_prompt 种子组装）、:308-320（seed 档分派）、:391-405（native 源机钉定 vs seed 常规选机）；溯源 UI 先例 2026-09-22-session-fork-continuation（列表「分叉自」回链）

## D-005@v2: 接手参数载体从 inject 修正为 takeover 端点

- type: architecture
- priority: P2
- status: accepted
- supersedes: D-005@v1
- source: design-grill
- question: D-005@v1 写"inject 激活请求对未激活 tool_report 会话新增 provider/agent_profile_id 参数"——D-006 选定分叉式接手后该措辞滞后（inject 激活分支已退役）。
- answer: 接手参数载体为新端点 POST /sessions/{id}/takeover 的 TakeoverRequest（prompt/provider/agent_profile_id/llm_provider_id），语义不变（handoff 档引擎+档案重选，校验所选引擎 ∈ 原机支持集合）。
- normalized_requirement: 同 D-005@v1 normalized_requirement，端点载体替换为 takeover。
- impacts: [FR-03, FR-05]
- evidence: 独立审查 P2 披露 3（brainstorm-review-2026-09-30-105210/review.json reviewerNotes）；design.md Phase 2/接口定义
- 锚点: backend/app/modules/daemon/router/session_crud.py（takeover 路由新增处）
- 模块域: backend
