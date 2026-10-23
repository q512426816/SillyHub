---
author: qinyi
created_at: 2026-10-23 09:09:38
generated_by: sillyspec-fourpiece-init
change: 2026-10-23-session-network-context
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 每轮注入【网络环境】前导段，不动首轮一次性策略
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: 网络环境上下文按「会话首轮一次」还是「每轮提问注入」？用户网络环境（切 WiFi/VPN/热点）会话中会变，首轮注入会过期。
- answer: 每轮注入。复用【页面上下文】的每轮注入通道先例（backend/app/modules/daemon/session/service/inject.py:433 的 page_context 参数，create.py 与 control.py:246 两处复用）；既有 D-002「前导仅首轮拼装」决策不触碰，网络环境走独立每轮段。
- normalized_requirement: 用户每次提问时,后端基于当次请求源 IP + 最新 daemon 心跳数据生成【网络环境】段注入 dispatch prompt;同网段判定结果随每次请求实时变化。
- impacts: [FR-01, task-01, verify-01]
- evidence: backend/app/modules/daemon/session/context.py:460（D-002 首轮一次注释）; backend/app/modules/daemon/session/service/inject.py:433（page_context 每轮注入先例）; 用户会话轮次「做吧」批准方案。
- 故障面: 每轮注入若不去重会重复烧 token——由 D-006 去重机制对冲。
- 退役判据: 若平台改为会话级网络信息主动推送（WS 通道）且 agent 可按需查询，可退役每轮注入。

## D-002@v1: 同网段判定双源——后端观测 daemon 请求源 IP 为 ground truth，daemon 自报网卡列表用于拼访问地址
- type: architecture
- priority: P0
- status: confirmed
- source: code
- question: 「用户与机器是否同局域网」的判定数据源用什么？纯靠 daemon 自报网卡（可伪造/网卡多/虚拟网卡干扰）还是后端观测？
- answer: 我的判断：双源。①后端从 daemon 心跳/注册请求直接观测来源 IP（复用 auth 模块 _client_ip 的 XFF 最右段逻辑，提为公共工具），这是平台亲眼所见、不可伪造的 ground truth，落库 daemon_instances；②daemon 心跳体新增自报 network_interfaces（os.networkInterfaces 过滤后），用于给 agent 拼「用哪个 IP 访问机器上的服务」（机器多网卡时观测 IP 只有一个，拼 URL 需要网卡列表选合适地址）。CIDR 匹配在两源上做：用户请求源 IP vs daemon 观测 IP（主判定）、vs 各网卡 IP（辅助，找可达地址）。
- normalized_requirement: daemon_instances 落库 observed_ip（后端从 daemon 请求观测）+ network_interfaces（daemon 自报 JSON）；同网段判定优先用 observed_ip，网卡列表仅用于构造访问地址与置信度佐证。
- impacts: [FR-02, FR-03, task-02, task-03, verify-02]
- evidence: backend/app/modules/auth/router.py:48-61（_client_ip XFF 最右段先例，审计 BS-3）; sillyhub-daemon/src/hub-client.ts:804-879（heartbeat 体现有字段面）; backend/app/modules/daemon/router/heartbeat.py:300-364（心跳落库通道）。
- 故障面: daemon 经 NAT 出口访问平台时观测 IP 是 NAT 出口而非机器本机 IP——同网段判定仍成立（用户与 daemon 同 NAT 即同可达域），但拼 URL 必须用自报网卡列表。
- 退役判据: 无（观测 IP 是零成本副产品，长期保留）。

## D-003@v1: 一期范围——daemon 采集 + 后端匹配注入；前端徽标二期；仅 IPv4
- type: scope
- priority: P1
- status: confirmed
- source: user
- question: 一期做多大？前端「与您同网段」徽标是否同期做？IPv6 是否支持？
- answer: 用户「做吧」批准的方案中前端徽标列为可选二期；一期 = daemon 网卡采集上报 + 后端观测落库 + CIDR 匹配 + 每轮注入。CIDR 匹配一期仅 IPv4（ipaddress 标准库），IPv6 网卡照常上报存储但不参与判定（标注「未参与判定」）。
- normalized_requirement: 一期交付物不含 frontend/src 任何改动；网络判定仅对 IPv4 地址做同网段计算；IPv6 地址仅存储展示。
- impacts: [FR-01..FR-06, task-01..task-06]
- evidence: 用户轮次「做吧」（批准含「前端(可选二期)」的方案）。
- 故障面: 纯 IPv6 环境用户拿不到判定——文案降级为「无法判定」，不误导。

## D-004@v1: 共享机器的内网 IP 对借用人可见
- type: boundary
- priority: P1
- status: confirmed
- source: user
- question: 借用共享机器的会话里，是否把该机器的内网 IP 注入给借用人？
- answer: 可见。内网 IP 属低敏信息（不出局域网无路由意义），共享语义本身即「授权在这台机器上干活」，拼访问地址是借用场景的核心诉求；方案中已建议、用户「做吧」批准。
- normalized_requirement: 注入的机器集合 = 用户当前会话可用机器（本人绑定 + 共享借用），注入内容含机器名 + observed_ip + 网卡 IPv4 列表，不区分绑定/共享。
- impacts: [FR-04, task-04, verify-03]
- evidence: 用户轮次「做吧」（批准含「共享的用户同样可见」建议的方案）。
- 故障面: 内网拓扑对借用人暴露——接受（共享授权已含更高权限的机器操作权）。

## D-005@v1: 机器可见性复用既有权限口径，不新增可见面
- type: boundary
- priority: P0
- status: confirmed
- source: code
- question: 注入哪些机器的网络信息？全平台机器还是子集？
- answer: 我的判断：只注入用户当前会话可用的机器——会话绑定的 runtime 所属 daemon + 该工作区可借用共享机器（workspace_member_runtimes 绑定/共享口径），与现有 grants/queries.py 可见性判定同源。不把全平台机器注入，避免信息面扩大。
- normalized_requirement: 网络环境段的机器清单来自会话 runtime 所属 daemon_instance 及用户在该工作区的共享借用集，不查全表。
- impacts: [FR-04, task-03, verify-03]
- evidence: backend/app/modules/workspace/member_runtimes/model.py:21-117（绑定/共享模型）; backend/app/modules/daemon/grants/queries.py:335（可见性判定先例）。
- 故障面: 共享关系变化滞后于会话轮次——每轮注入实时查询，无陈旧问题。

## D-006@v1: 注入去重——内容快照变化才重注 + 会话内最短间隔兜底
- type: architecture
- priority: P1
- status: confirmed
- source: user
- question: 每轮注入如何控制 token 成本与信息新鲜度的平衡？
- answer: 网络环境段内容做规范化快照（源 IP + 各机器判定结果摘要的 hash），与上一轮相同则不重注（只在首轮注入）；变化（用户切网、机器上下线）才重注；另设最短重注间隔（60s）防移动网络 IP 抖动导致连注。快照存 Redis（会话级 key，TTL 7 天）。
- normalized_requirement: 同快照跳过注入；快照变化且距上次注入 ≥60s 才重注；Redis 不可用时降级为每轮注入（可失去重但不失功能）。
- impacts: [FR-05, task-04, verify-04]
- evidence: 方案轮次（token 成本控制设计）+ 用户「做吧」；backend 现有 Redis 使用面（backend/app/core/redis.py 基础设施）。
- 故障面: Redis 快照丢失→多注一次，无正确性影响。

## D-005@v2: 共享机器权威口径 = grants 表（supersedes D-005@v1）
- type: boundary
- priority: P0
- status: confirmed
- supersedes: D-005@v1
- source: design-grill
- question: 共享借用的机器清单查哪张表？design-grill 独立审查发现 D-005@v1 写的 workspace_member_runtimes.shared 口径已过时。
- answer: 我的判断（经源码查证）：绑定机器仍查 workspace_member_runtimes（本人 runtime 绑定）；共享借用查 daemon grants 表——grants/queries.py:352 的 resolve_granted_daemon_for_borrow 注释明确记录借用判定已从 member_runtimes/queries.py:171 的 binding 表迁移至 grants 表（enabled=TRUE / grantee 工作区+成员 / 非本人 / online，语义逐条等价）。网络环境段的机器清单与派发链路同源，复用该函数族查询。
- normalized_requirement: 机器清单 = 会话 runtime 所属 daemon + workspace_member_runtimes 本人绑定 + grants 表 enabled 借用集（resolve_granted_daemon_for_borrow 同源口径），不查全平台。
- impacts: [FR-04, task-03, verify-03]
- evidence: backend/app/modules/daemon/grants/queries.py:352-372（迁移对照表注释）; backend/app/modules/workspace/member_runtimes/queries.py:171（被替代旧查询）。
- 故障面: 口径再迁移（grants 表重构）时本清单滞后——与派发链路共用函数族可同步演进。

## D-012@v1: 排队/steering 轮注入语义——入队存用户 IP，派发时重算判定
- type: architecture
- priority: P1
- status: confirmed
- source: design-grill
- question: 忙轮排队/steering 的消息真正派发时（无用户 HTTP 请求在场），网络环境段怎么注入？重放旧判定文本可能过期误导，跳过则该轮无网络段。
- answer: 我的判断：镜像 page_context 的入队存储模式——入队时把 user_ip/has_xff 随条目序列化存储（queue.py:304 同款）；派发/steering 重放时用存储的用户 IP + **实时**机器数据（daemon 心跳最新态）重算判定并注入，不重放旧判定文本。排队窗口通常秒级~分钟级，用户 IP 变化概率低，机器状态取最新最准。
- normalized_requirement: 排队条目持久化 user_ip/has_xff；派发时调判定引擎实时渲染注入；派发时刻机器离线等降级照常生效。
- impacts: [FR-01, FR-04, task-05, verify-04]
- evidence: backend/app/modules/daemon/session/service/queue.py:774（「page_context 此前只重放不注入」审查修复注释）; queue.py:304-306（入队序列化先例）; queue.py:945-986（派发重放）。
- 故障面: 排队期间用户切网→派发用旧 IP 判定——接受（窗口短，且下轮提问即纠正）。

## D-013@v1: 快照 60s 窗口语义——不吞变化，到点补注
- type: architecture
- priority: P1
- status: confirmed
- source: design-grill
- question: 快照变化但距上次注入 <60s 时，Redis 快照是否更新？更新=变化被永久吞掉，不更新=60s 后下一轮仍不同则补注——两种写法产物不同。
- answer: 我的判断：Redis 存「上次**已注入**的内容 hash + 注入时间戳」。当前渲染 ≠ 上次注入且 ≥60s → 注入并更新；<60s → 不注入也**不更新**快照，下一轮重新比较，到点即补注。变化永不丢失，抖动被窗口吸收。
- normalized_requirement: 快照仅在实际注入时更新；未注入轮次不推进时间戳不覆盖 hash。
- impacts: [FR-05, task-04, verify-04]
- evidence: design-grill 实现者视角追问第 3 条；D-006 快照机制细化。
- 故障面: 无新增（相对 D-006 仅明确写入时机）。

## D-007@v1: 心跳契约扩展须同步四个钉子测试文件
- type: consistency
- priority: P0
- status: confirmed
- source: docs
- question: daemon 心跳体加 network_interfaces 字段会撞哪些既有测试契约？
- answer: 知识库共享断言面钉子②：daemon 心跳加参（sillyhub-daemon/src/daemon.ts _sendHeartbeatOnce 平铺传参）后，length 钉四文件必须全部 N→N+1：tests/daemon-heartbeat-pending.test.ts、tests/daemon-heartbeat-sillyspec.test.ts、tests/sillyspec-platform-command.test.ts（6 处）、tests/integration/selfupdate-scenarios.test.ts（2 处）。同一变更内完成，否则 CI 补红。
- normalized_requirement: 心跳体新增字段的所有调用点断言（参数个数/字段存在性）在同一变更内同步更新并通过聚焦测试。
- impacts: [FR-02, task-02, verify-02]
- evidence: .sillyspec/knowledge/testing-gotchas.md（共享断言面钉子②，d6fabf408 machine-id 后两文件漏跟实证）。
- 故障面: 遗漏任一钉子文件即 CI 红——task 清单显式列出四文件。

## D-008@v1: daemon_instances 加 JSON 列 + Alembic 迁移，链尾锚测试前移一行
- type: architecture
- priority: P0
- status: confirmed
- source: docs
- question: 网卡数据存哪？新列还是复用 capabilities JSON？迁移有什么坑？
- answer: 我的判断：daemon_instances 新增 network_info JSON 列（存 {observed_ip, interfaces:[{name,ip,cidr,family}]}，单列整体读写）+ observed 单独查询便利不加独立列（JSON 内取）。不复用 capabilities（语义混杂）。新 Alembic 迁移落库时必须前移链尾锚测试 backend/tests/test_align_platform_change_events_migration.py 的 head 常量一行（知识库钉子①）。
- normalized_requirement: 一个迁移文件加一列；链尾锚测试 head 常量同步前移；老 daemon 不上报时列值为 NULL，注入逻辑按缺数据处理。
- impacts: [FR-03, task-03, verify-02]
- evidence: .sillyspec/knowledge/testing-gotchas.md（钉子① alembic 链尾锚）; backend/app/modules/daemon/model.py:27-197（daemon_instances 现有列面）。
- 故障面: 老版本 daemon 未升级时 network_info 恒 NULL——判定降级为「无网卡数据，仅观测 IP」，不报错。

## D-009@v1: 实现方案选定——方案 A 平台自动注入（每轮 CIDR 判定 + 前导段注入）
- type: architecture
- priority: P0
- status: confirmed
- source: user
- question: 会话网络环境感知的实现方案选 A（平台自动注入）/ B（agent 按需查询工具）/ C（仅前端展示）哪一个？
- answer: 用户选定方案 A：daemon 心跳上报网卡 + 后端观测落库 + 每轮 CIDR 判定生成【网络环境】段自动注入。理由：原始诉求是「agent 每次回答时都知道网络情况」，只有注入保证 100% 触达；B 依赖 agent 主动查询、最需要的场景最容易漏；C 浏览器探测被 Chrome mDNS 混淆封死且 agent 依旧无感知。
- normalized_requirement: 实现按方案 A 落地，完整覆盖 D-001~D-008。
- impacts: [FR-01..FR-06, task-01..task-06, verify-01..verify-05]
- evidence: 用户方案选择轮次（AskUserQuestion 选「方案 A:平台自动注入(推荐)」）。
- 故障面: 见 D-001/D-006（token 成本由去重对冲）。

## D-010@v1: 落选方案 B——agent 按需查询工具（get_network_info MCP 工具）
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 同 D-009 取舍问句。
- answer: 落选。不主动注入，新增 MCP 查询工具让 agent 按需调用。
- normalized_requirement: 不实现。
- impacts: []
- evidence: 用户方案选择轮次（未选 B）。
- 否决理由: 治不了本——agent 不主动调用就依旧不知道网络情况，而用户最需要的场景（问「怎么访问项目地址」）恰恰最容易漏；且需扩 MCP 工具面、daemon 不掌握用户浏览器源 IP 须回平台查询，链路更长。
- 复潮条件: 若注入 token 成本实测不可接受且 agent 主动调用习惯可被 prompt 稳定养成，可重议按需查询形态。

## D-011@v1: 落选方案 C——仅前端展示网络徽标不注入
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 同 D-009 取舍问句。
- answer: 落选。仅在聊天界面显示网络徽标，agent 无感知。
- normalized_requirement: 不实现。
- impacts: []
- evidence: 用户方案选择轮次（未选 C）。
- 否决理由: 浏览器侧探测局域网 IP 已被 Chrome mDNS 混淆机制基本封死（返回 *.local），拿不到可用数据；且不解决核心诉求——agent 依旧不知道网络环境，等于不做。
- 复潮条件: 若浏览器重新开放可靠的本机 IP 探测能力且需求退化为「仅人看」，可重议。
