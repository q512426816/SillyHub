---
author: qinyi
created_at: 2026-08-28 00:17:23
---

# 决策记录（Decisions）

> 说明：需求澄清阶段用户未实时应答（AskUserQuestion 无返回），下列 P0 决策均采用
> 调研依据 + 推荐默认值，标记为「默认决策，可否决」——后续任何环节用户可推翻，
> 推翻时以新版本条目（D-xxx@v2 supersedes）记录。

## D-001@v1: 工作区共享沿用现有机制，补齐两个缺口
- type: premise
- priority: P0
- status: accepted（用户重问轮实答追认「沿用现有开关」）
- source: user
- question: 「工作区共享按钮」是重做交互，还是在现有共享机制上补齐？
- answer: 现状调研（agent 探索实证）：工作区共享守护进程机制已存在——
  `workspace_member_runtimes.shared` 字段 + lender 开关
  （frontend/src/components/workspace/shared-daemon-toggle.tsx，工作区详情页
  「我的接入」区）+ owner 管理（shared-daemon-manager.tsx，成员页）+ 借用回退
  （backend/app/modules/agent/borrow_resolver.py，仅 agent-run/quick-chat 自动
  选址路径）+ 审计（daemon_borrow_audit）+ 借用沙箱。缺口仅两处：
  ① 守护进程页面（/runtimes）数据源 GET /daemon/machines、GET /daemon/runtimes/page
  非 platform admin 固定 user_id==actor，共享 daemon 对非 owner 不可见；
  ② 交互式会话显式 runtime_id 钉定路径 owner-only
  （backend/app/modules/daemon/session/service.py:932-937 直接 404）。
- normalized_requirement: 不新建共享数据模型；本次补齐：(a) 共享 daemon 在
  守护进程页面对有 DAEMON_BORROW 权限的工作区成员可见（带「共享」标识，
  隐藏/禁用全部修改类操作）；(b) 会话创建允许钉定「对当前用户已授权（共享）」
  的 runtime；(c) 修改类端点（别名/可写目录/升级/禁用/删除）保持 owner-only
  不变（现状已由 _get_owned_runtime/_get_owned_instance 保证）。
- impacts: [FR-01, FR-02, FR-03]
- evidence: session/service.py:933；runtime/service.py:577、:916、:1058；
  member_runtimes/model.py:81；borrow_resolver.py:43-130

## D-002@v1: 平台共享智能体的会话强制只读
- type: boundary
- priority: P0
- status: superseded（superseded by D-002@v2，用户重问轮推翻）
- source: code
- question: 全体用户用平台共享智能体开会话，能否写平台源码工作区？
- answer: 强制只读。依据：用户需求原文对助手场景明确「只读形式」；平台源码是
  生产资产，全体用户可写风险不可接受；read_only 物制链路已存在
  （agent/execution.py worker_tool_config → lease metadata tool_config →
  daemon canUseTool 白名单硬拒绝，mcp_tools.py:1316 已示范写法），接入成本低。
- normalized_requirement: 凡使用平台共享智能体创建的会话，lease 强制携带
  read_only 工具配置（allowed_tools 白名单 Read/Glob/Grep 类，禁 Write/Bash
  之类写工具），cwd 钉定源码工作区 root_path，不因请求参数而放宽。
- impacts: [FR-04, FR-05]
- evidence: agent/execution.py:92-117；agent/mcp_tools.py:1316；
  daemon 侧 session-manager.ts canUseTool 白名单

## D-003@v1: 平台共享智能体绑定的守护进程取管理员自己名下
- type: architecture
- priority: P0
- status: accepted（用户重问轮实答追认「仅管理员自己名下」）
- source: user
- question: 管理员共享「守护进程下的某个智能体」时，daemon 来源范围？
- answer: 仅平台管理员自己名下的在线 daemon runtime。依据：避免引入「管理员
  指派任意用户 daemon 给全体用户」的跨用户授权问题（他人机器资源被全平台使用
  需本人同意，现有共享机制同意载体是 per-member shared 标志，语义不匹配）；
  管理员自己保证共享服务的在线率。后续如需扩展再议。
- normalized_requirement: 共享配置时 runtime 候选列表 = 当前管理员 user_id 名下
  在线 daemon_runtimes；保存后派发走 pinned_runtime_id +
  pinned_skip_owner_check（团队 mission 代表钉定先例，placement.py:612-620）。
- impacts: [FR-04]
- evidence: placement.py:612-620；runtime/service.py:916（owner 校验需旁路点）

## D-004@v1: 悬浮助手自动回退到平台共享智能体
- type: boundary
- priority: P1
- status: superseded（superseded by D-004@v2，用户重问轮推翻）
- source: code
- question: 页面注入的小助手如何接入平台共享智能体？
- answer: 悬浮助手创建会话的三级回退解析（floating-session-host.tsx:104-130）
  末尾追加一级：用户无任何可用自有 runtime 且存在平台共享智能体时，自动选用
  平台共享智能体（钉定管理员 runtime + 源码工作区 cwd + 只读 + 平台功能
  system prompt）。不做独立入口按钮（一期 YAGNI）；用户有自有 daemon 时仍
  默认自己的，共享智能体在档案选择器里照常可选（platform 可见性已覆盖）。
- normalized_requirement: FloatingSessionHost 的 runtime 解析回退链扩展：
  自有 runtime → 平台共享智能体（存在且在线时）→ 报错引导。
- impacts: [FR-05]
- evidence: floating-session-host.tsx:104-130；daemon/schema.py:121-153
  （page_context 注入机制可复用补充平台功能说明前导）

## D-002@v2: 平台共享智能体会话——源码只读 + 指定目录可写
- type: boundary
- priority: P0
- status: accepted
- supersedes: D-002@v1
- source: user
- question: 全体用户用平台共享智能体开会话，能否写平台源码工作区？
- answer: 用户实答（重问轮）：「允许某个目录下写操作，可以生成点文档原型图
  之类的东西」——不是纯只读，而是：读源码不受限 + 写操作限制在管理员指定的
  一个共享输出目录（产出文档/原型图等）。推翻 v1 的纯只读方案。
- normalized_requirement: ①grants platform 行以 `writable_dir` 取代 v1 的
  read_only 固定 true（管理员配置共享时指定，必须 ⊆ 管理员 runtime 的
  allowed_roots）；②共享会话读平台源码不受限（Read/Glob/Grep 全局可用），
  写操作限制在 writable_dir 内——复用 AgentProfile.allowed_roots_overlay
  「只能收紧：∩ daemon.allowed_roots 后下推」既有机制 + daemon 沙箱强制；
  ③Bash 类命令的写逃逸覆盖面列为新 R-08，plan 首任务实证，不达标则收窄
  工具集（禁 Bash 或命令白名单）；④会话徽标文案改「平台共享」（不再标只读）。
- impacts: [FR-04, FR-05, Phase 3, tasks task-05/task-11, R-08]
- evidence: 用户重问轮实答（2026-08-28）；profile/model.py:144
  allowed_roots_overlay 只能收紧语义；v1 证据链失效部分：read_only 白名单
  方案（worker_tool_config mode=plan）不再使用

## D-004@v2: 共享机器/智能体由用户在会话中显式选择
- type: boundary
- priority: P1
- status: accepted
- supersedes: D-004@v1
- source: user
- question: 页面注入的小助手如何接入平台共享智能体？
- answer: 用户实答（重问轮）：「会话选择共享的机器和智能体呀，用户自己选」
  ——不做悬浮助手自动回退；共享机器进入机器选择器（共享徽标）、共享智能体
  进入档案选择器（platform 可见性既有机制），由用户显式选择后创建会话。
- normalized_requirement: ①撤销 v1 的悬浮助手回退链扩展与 FloatingPreContext
  agentProfileId 扩展（Grill B-06 对应文件清单项随之删除）；②机器选择器
  候选 = 自有 + 共享给我的（共享徽标），数据源即 FR-01 的 shared_to_me；
  ③档案选择器自然呈现共享智能体（platform visibility 既有行为，必要时补
  共享标识展示）；④选中共享智能体后服务端强制项（D-002@v2/D-003）不变；
  ⑤「平台共享·只读」徽标文案改「平台共享」。
- impacts: [FR-05, Phase 4, tasks task-10 收缩]
- evidence: 用户重问轮实答（2026-08-28）

## D-005@v1: 单变更不拆分
- type: premise
- priority: P1
- status: accepted
- source: code
- question: 三个子功能（工作区共享补齐 / 平台共享智能体 / 助手只读源码）是否拆多变更？
- answer: 不拆。三者强耦合：工作区共享会话钉定（FR-01~03）是平台共享（FR-04）
  的机制基础，助手回退（FR-05）消费平台共享产物。一个 change 内按 Wave 顺序
  交付。非批量模式（无「模板×数据」重复模式）。
- impacts: [全部 FR]
- evidence: 依赖链分析

## D-006@v1: 实现方案选 B——统一授权表 daemon_runtime_grants
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 守护进程共享 + 平台共享智能体的实现方案（A 最小侵入 / B 统一授权表 / C 双入口）？
- answer: 用户选定方案 B：新建 daemon_runtime_grants 统一授权表，工作区共享与
  平台共享落到同一授权模型（grantee_type=workspace|platform，user 预留）。
  用户在知晓迁移/重构风险提示后仍选 B（关注未来扩展「共享给个人/团队」零成本
  与模型统一）。AI 推荐过 A，被否决——理由：A 复用现有 shared binding 语义，
  但会固化两套授权模型。
- normalized_requirement: ①新表 daemon_runtime_grants 为唯一授权载体；
  ②现有 WorkspaceMemberRuntime.shared 数据迁移为 workspace 级 grant（未上线
  允许直接迁移，开关 API 语义保留、持久化切到 grants）；③会话钉定校验、
  列表可见性、借用回退（borrow_resolver）全部切换到 grants 查询；
  ④平台共享智能体 = grantee_type=platform 的 grant + 绑定（agent_profile/
  源码工作区/只读），由管理员创建于自己名下 daemon（D-003 仍有效）；
  ⑤借用审计 daemon_borrow_audit 延续并关联 grant_id。
- impacts: [FR-01~FR-05, schema 迁移, borrow 链路重构]
- evidence: 方案选择轮次（AskUserQuestion 实答「方案 B：统一授权表」）；
  supersedes 无（D-001~D-005 的需求层决策不受影响，仅实现载体变化）

## D-007@v1: platform 档案检测前置 + platform 会话不写借用审计
- type: consistency
- priority: P1
- status: accepted
- source: design-grill
- question: platform 共享档案检测放在 agent_profile_id 解析处（design §7 原文）
  会与 runtime_id/provider 二选一校验冲突吗？platform 会话写不写 daemon_borrow_audit？
- answer: Grill B-01：悬浮助手回退只传 agent_profile_id（无 runtime_id/provider），
  原设计位置在 session/service.py:950-954 二选一校验之后 → 100% 被拒。修正：
  检测前置到二选一校验之前。Grill B-04：daemon_borrow_audit 的 workspace_id/
  agent_run_id 均 NOT NULL（agent/model.py:1275-1288），与无 workspace 的交互式
  platform 会话不兼容；且 platform 授权语义不是工作区借用。修正：platform 会话
  不写借用审计，用量计量走 AgentSession 现有口径。
- normalized_requirement: create_session 入口最先检测 platform 档案；单测覆盖
  「只传共享档案」「同时传 runtime_id+共享档案被覆写」两 case；platform 分支
  无 daemon_borrow_audit 写入。
- impacts: [FR-04, FR-05, R-03]
- evidence: 独立审查子代理 report（Cross-Check C-01/B-04）；session/service.py:950-954；
  agent/model.py:1275-1288

## D-008@v1: grants 唯一约束 NULLS NOT DISTINCT + 迁移跳过空 daemon_id 行
- type: consistency
- priority: P1
- status: accepted
- source: design-grill
- question: grants 唯一约束含 nullable grantee_id（platform 行）在 PG 下真的唯一吗？
  存量迁移对 daemon_id IS NULL 的 binding 行怎么处理？
- answer: Grill B-02：PG 默认 NULLS DISTINCT 使 NULL≠NULL，platform 行可重复插入
  ——迁移建表用 NULLS NOT DISTINCT（deploy postgres:16-alpine，PG15+ 支持）。
  Grill B-03：现存 shared=true 且 daemon_id IS NULL 的 binding 行（原借用 SQL
  本就过滤），迁移跳过并写日志。
- normalized_requirement: 唯一约束 DDL 带 NULLS NOT DISTINCT；迁移脚本 skip
  daemon_id IS NULL 行 + 输出跳过计数日志；两者各有单测。
- impacts: [FR-01, FR-04, Phase 1 迁移]
- evidence: 独立审查子代理 report（C-08/C-11）；deploy/docker-compose.dev.yml:7
  postgres:16-alpine

## D-009@v1: 平台共享会话工具集不含 Bash（R-08 实证定案）
- type: risk
- priority: P1
- status: accepted
- source: design-grill
- question: R-08——daemon 对 allowed_roots 的写强制能否挡住 Bash 在 writable_dir 外写文件？
- answer: plan 期实证（探索代理，分档 C 部分强制）：interactive 路径 Write/Edit/MultiEdit
  经 PolicyEngine.canWrite realpath+fail-closed 强制（session-manager.ts:1735-1858、
  filesystem-policy.ts:176-212）；Bash 写目标靠 shell-paths.ts 正则提取（重定向/
  cp/mv/tee/mkdir/touch/PS cmdlet/cmd copy），python -c/node -e/sed -i/变量展开等
  提取为空→放行逃逸（shell-paths.ts:7-11 自认）。定案：平台共享会话 tool_config
  的 allowed_tools 不含 Bash（保留 Read/Glob/Grep/Edit/Write/mcp__sillyhub-file/
  mcp__sillyhub-worker，mode=acceptEdits）——Bash 在 canUseTool 白名单 gate
  （session-manager.ts:1696-1709）直接拒绝，产出文档/原型图走 Write/Edit 且
  路径强制由 policyEngine 保证。不动 daemon（Non-Goal 边界保持）。
- normalized_requirement: task-05 的 tool_config.allowed_tools 明确枚举且不含
  Bash/NotebookEdit；单测断言 allowed_tools 集合。
- impacts: [FR-04, task-05]
- evidence: 探索代理 report（session-manager.ts:1696-1900 / shell-paths.ts:7-123 /
  filesystem-policy.ts:176-212 / execution.py:113-138）；R-08 风险行同步关闭

## D-010@v1: overlay 收紧的 policy_update 作用域需 task-05 实证（新 R-09）
- type: feasibility
- priority: P1
- status: accepted
- source: code
- question: profile overlay 收紧走 backend 下推 PolicyCache.update（per-runtime）
  ——平台共享会话收紧 writable_dir 是否会波及管理员自己在该 runtime 的其他会话？
- answer: 实证发现生产主路径 policyEngine 数据源是 per-runtime PolicyCache
  （daemon.ts:1209/2139-2177，cli.ts:646/786 装配），claim payload 的
  effectiveAllowedRoots 仅 fallback 路径用。若 policy_update 按 runtime 推，
  共享会话收紧会全局生效（误伤管理员自己会话）——task-05 必须实证作用域，
  必要时改为 session 级 roots provider（session-manager 的 _allowedRootsProvider
  即 per-session 通道）或随 claim 下推。
- normalized_requirement: task-05 验证写约束作用域为「仅该共享会话」；单测覆盖
  「同一 runtime 上管理员普通会话写路径不受 writable_dir 限制」。
- impacts: [FR-04, task-05, R-09]
- evidence: 探索代理 report（interactive/types.ts:294-296 / daemon.ts:4098 /
  session-manager.ts:1632 writeGuardEnabled 双通道）

## D-011@v1: 打破 daemon 零改动 Non-Goal——session 级 overlay roots 写守卫增量（spike-02 B 裁决）
- type: architecture
- priority: P0
- status: accepted
- source: design-grill
- question: spike-02 实证 daemon 生产装配（policyEngine 存在）下 claim payload 的
  effectiveAllowedRoots 不进写守卫（session-manager.ts:1783-1793 policyEngine 分支
  提前 return，fallback 块不可达；PolicyCache 机器级；borrow-sandbox marker 通道
  强制 cwd=daemon 自建沙箱无法承载 writable_dir）——writable_dir 路径级强制何解？
- answer: 选项 II（最小 daemon 增量）：_judgeWriteViaPolicyEngine 增加 per-session
  overlay 判定——state.effectiveAllowedRoots 非空时路径必须同时落在 session roots
  与 PolicyCache roots（交集收紧语义，沿 _borrowSandboxRoots :1859-1881 per-session
  map 先例）；无该字段的会话零行为变化。backend 侧 platform 会话向 lease/claim 链
  注入 effective_allowed_roots=[writable_dir]（镜像 tool_config 注入先例）。
  选项 I 被否：降级为「allowed_roots 级 + 禁 Bash」会使共享会话可写源码工作区
  本身，违背用户 D-002@v2 实答语义（读源码不受限+写仅限指定目录）。
  Non-Goal「不改 sillyhub-daemon」由本决策显式收窄为「仅此一处增量写守卫 + 测试」。
- normalized_requirement: daemon session-manager.ts 写守卫支持 session 级 overlay
  （交集收紧）；携带 effectiveAllowedRoots 的既有会话自此被真实收紧（语义即
  overlay 文档语义「只能收紧」，属修正休眠缺陷）；backend platform 会话注入
  effective_allowed_roots=[writable_dir]；两侧各有单测；FR-04 验收口径维持
  「writable_dir 外的写被拒绝」不降级。
- impacts: [FR-04, task-05③, 新 task-12, design §3/§6/§10]
- evidence: task-05 子代理 spike-02 report（session-manager.ts:1783-1815/1842-1895、
  cli.ts:646/786、daemon.ts:4098/4510）；用户 D-002@v2 实答原文

## D-012@v1: platform grant 的 pinned runtime 不经共享档案直接钉定 → 404
- type: boundary
- priority: P1
- status: accepted
- source: design-grill/acceptance-review
- question: platform grant 的 pinned_runtime_id 可否不经共享档案直接钉定？
- answer: 否——共享的是智能体而非裸 runtime：authorize_pinned_runtime 的
  platform 分支命中即放行的旧语义，使「直传 pinned_runtime_id、不带共享档案」
  形态绕过 task-05 强制（cwd=源码工作区 / writable_dir 写约束 / 工具集白名单）。
  收口（验收审查 gap-2）：platform 分支命中一律返回 None → 调用方 404；共享
  runtime 唯一入口=task-05 档案检测（检测命中下发走 pinned_skip_owner_check=True，
  不经 authorize，不受影响）。
- normalized_requirement: 直接以 platform grant 的 pinned_runtime_id 创建会话
  （不带共享档案）→ 404；session 首查与 placement 二次复查同源 authorize 判定，
  单测断言翻转覆盖。
- impacts: [FR-04, task-03, task-05]
- evidence: 验收审查（gap-2）；session/service.py authorize 接线注释块；
  placement.py _query_pinned_online_runtime 授权分支

## D-013@v1: 共享机器可见性 = 成员资格 + daemon:borrow 双条件
- type: consistency
- priority: P1
- status: accepted
- source: acceptance-review
- question: 「共享给我的」机器列表的权限口径——仅成员资格，还是成员资格+权限？
- answer: 成员资格 + daemon:borrow 双条件（FR-01 GWT-3 本义：任一不满足即
  不可见）。list_machines_shared_to_me 原实现仅 EXISTS 成员资格，锁定了宽松
  口径——收口（验收审查 gap-1）：补逐 grantee 工作区 has_permission 过滤
  （与 authorize_pinned_runtime workspace 分支同源判定，含 platform_admin
  短路），「可见」与「可借用」权限口径对齐。
- normalized_requirement: 无 daemon:borrow 的成员在 machines/runtimes-page 的
  shared_to_me 块看不到共享机器；持权限的成员照常可见（正反例单测锁定）。
- impacts: [FR-01, task-02, task-13]
- evidence: 验收审查（gap-1）；requirements FR-01 GWT-3；
  grants/queries.list_machines_shared_to_me
