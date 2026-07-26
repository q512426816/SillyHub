---
author: qinyi
created_at: 2026-07-25 17:51:38
---

# 决策台账（decisions）— daemon-borrow-for-business

本文件记录本次变更有实现/验收影响的决策。长期术语在 archive/scan 时提升到 glossary.md。

## D-001@v1: 方案落点=文件中心为主
- type: architecture
- status: accepted
- source: user（brainstorm step 3 澄清）
- question: 业务人员借 agent 跑出来的"业务方案"主要落到系统哪里？
- answer: 平台文件中心（MinIO + file 模块）为主，业务人员/工作台可见；针对业务问题的方案挂 PPM 问题清单。SillySpec 变更文档留给开发人员主导（业务人员不写工程规格）。
- normalized_requirement: agent 产出方案文本 → backend 调 FileService 落 file 记录，owner_type="workspace"/owner_id=ws，uploaded_by=业务人员；可选 owner_type="ppm_problem" 关联问题。
- impacts: Phase 5、§6 文件清单(file 桥接)、§8 无新表(file 用现成多态)、R-04 白名单
- evidence: file/service.py:66-109（upload_file 吃 bytes 可直调）、file/model.py:43-51（owner_type/owner_id 多态）；用户 step 3 选择
- priority: P0

## D-002@v1: 借用方式=自动用工作空间共享 daemon
- type: boundary
- status: accepted
- source: user（step 3）
- question: 业务人员跑 agent 时怎么"借用"开发人员的 daemon？
- answer: 自动。业务人员无感，点跑 agent 时系统自动解析工作空间里开发人员共享的 daemon。不做手选、不做审批流。
- normalized_requirement: placement 判别 actor 无自有在线 daemon → 自动回退借用查询，业务人员无需理解 daemon 概念。
- impacts: Phase 3、D-008（helper）、非目标（不做审批流）
- evidence: 用户 step 3 选择；方案 B（代持 run + 审批流）因 YAGNI 被排除
- priority: P0

## D-003@v1: 授权=daemon 主人主动共享 + owner 可撤销
- type: 权限边界
- status: accepted
- source: user（step 3）
- question: 谁来授权把开发人员的 daemon"共享"给业务人员？
- answer: daemon 主人（开发人员）主动把自己的 daemon 标记"本工作空间共享"，workspace owner 可见可撤销。daemon 归谁由谁决定共享。
- normalized_requirement: lender 在自己 binding 行标 shared=True；owner 可查工作空间所有 shared daemon 并可设回 shared=False 撤销。
- impacts: Phase 1（shared 列 + 端点）、§6（my-binding/shared 端点）、§9（撤销=shared=False）
- evidence: 用户 step 3 选择
- priority: P0

## D-004@v1: 额度=审计不限额
- type: boundary
- status: accepted
- source: user（step 3）
- question: 借用 daemon 跑 agent 消耗开发人员 API 额度，怎么管？
- answer: 审计不限额。全程记日志（谁借、跑什么、花多少），先不设硬上限。
- normalized_requirement: 新增 daemon_borrow_audit 表记录每次借用；不实现额度拦截/限额逻辑。
- impacts: Phase 1（审计表）、R-03（并发额度共享先不限制）
- evidence: 用户 step 3 选择
- priority: P0

## D-005@v1: 共享标记=加 shared 列到 workspace_member_runtimes（不新建表）
- type: architecture
- status: accepted
- source: code（step 5 查证）
- question: daemon 共享标记加列到现有表，还是新建 workspace_shared_daemons 表？
- answer: 加 shared 列到 workspace_member_runtimes。该表语义本就是"成员把自己的 daemon 绑给工作空间"（queries.py:131-135 docstring），加 shared 是自然延伸；复用 PK (workspace_id, user_id) 信任边界（lender 必须是成员）；撤销=shared=False 干净；避免冗余表多一次 join。
- normalized_requirement: workspace_member_runtimes 加 shared bool（默认 false）+ 部分索引；借用查询 WHERE shared=TRUE AND user_id<>actor。
- impacts: Phase 1、§8（修改表）、§6（model.py 修改）
- evidence: workspace/member_runtimes/model.py:21-97；queries.py:115-168；查证报告第 6 点
- priority: P0

## D-006@v1: 借用角色=新增 workspace 级 business_member
- type: 权限边界
- status: accepted
- source: design（step 5）
- question: DAEMON_BORROW 权限授给谁？复用现有角色还是新角色？
- answer: 新增 workspace 级角色 business_member，带 DAEMON_BORROW + 工作空间读权限，不带全量 task:run_agent。owner 把业务人员加成该角色。不复用 viewer（会改变只读语义），不开系统级新角色。
- normalized_requirement: 新迁移 INSERT business_member 角色 + daemon:borrow 权限种子；DAEMON_BORROW 是受限"只能借共享 daemon"权限，非全量 agent。
- impacts: Phase 2、§6（permissions.py + 新迁移）、R-05（缓存失效）
- evidence: auth/permissions.py:34-191；migrations/202605280900_create_auth_and_rbac.py:30-123；查证报告第 5 点
- priority: P0

## D-007@v1: daemon 沙箱=独立 sandbox slug + 独立 runtime_id/只读 policy
- type: architecture
- status: accepted（候选 A/B 待 plan spike）
- source: code（step 5 查证）
- question: 业务借用任务在开发人员机器上跑，怎么隔离不污染开发代码？
- answer: ①独立 sandbox 目录（mirror by slug=borrow-<actor>-<run_id>，复用 prepareWorkspace，塞进 lease rootPath，daemon.ts:2723）；②独立 runtime_id 或按 lease 隔离的只读 policy（不复用 lender runtime_id，避免命中 PolicyEngine 写缓存继承 lender 写权限）。借用任务只读 root_path，产出只走 submit_lease_messages 回传不落 sandbox。
- normalized_requirement: borrow lease cwd=独立 sandbox；写策略独立于 lender；verify 写边界测试（借用 agent 不能写开发代码区）。
- impacts: Phase 4、§6（daemon.ts/session-manager.ts）、R-02、R-09
- evidence: daemon.ts:2723（cwd=rootPath）、session-manager.ts:1037-1102（PolicyEngine 按 runtime 缓存）、worktree/model.py:26-67（WorktreeLease 不适配）、查证报告第 4 点
- priority: P0

## D-008@v1: 派发收敛=共享 helper 4 路统一调用
- type: architecture
- status: accepted
- source: code（step 5 查证）
- question: 借用兜底加在哪？只改一处够吗？
- answer: 不够。抽共享 helper `_resolve_borrowed_or_own_runtime(workspace_id, user_id, provider)`，4 路派发解析统一调用：_resolve_dispatch_runtime、_resolve_decide_runtime、resolve_runtime_for_writeback、prepare_interactive_dispatch 的 _get_online_runtime。否则重现 D-007 当年"decide 通过但 dispatch 报错"语义割裂。
- normalized_requirement: 新建 borrow_resolver.py 封装 helper + 借用查询；4 路 resolver 改调 helper；verify 单测覆盖每一路。
- impacts: Phase 3、§6（borrow_resolver.py + placement.py + resolver.py）、R-01、R-07
- evidence: placement.py:690-807/855-944/408；member_runtimes/resolver.py:59-150；查证报告第 2 点
- priority: P0

## D-009@v1: 落点=FileService.upload_file，owner_type=workspace
- type: architecture
- status: accepted
- source: code（step 5 查证）
- question: backend 怎么把 agent 方案落成 file 记录？
- answer: 调 FileService.upload_file(data=方案文本 bytes, mime=text/markdown, uploaded_by=业务人员, owner_type="workspace", owner_id=ws)。File 表无 workspace_id，用现成多态 owner_type/owner_id。不经前端上传。
- normalized_requirement: agent run completed 回调里调 FileService.upload_file；确认 text/markdown 在白名单（R-04）。
- impacts: Phase 5、§6（agent run 完成回调链路）、D-001
- evidence: file/service.py:66-109、file/model.py:43-51；查证报告第 3 点
- priority: P0

## D-006@v2: business_member 带 task:run_agent + daemon:borrow（端点鉴权澄清）
- type: 一致性
- status: accepted
- supersedes: D-006@v1
- source: design-grill（主 agent 自审，因子代理 429 降级）
- question: business_member 只有 daemon:borrow，但 agent 端点(agent/router.py:305)要求 task:run_agent，业务人员怎么触发？
- answer: business_member 权限组合 = task:run_agent(触发端点鉴权通过) + daemon:borrow(借用回退授权) + workspace 读。task:run_agent 仅让业务人员能"触发"现有 agent 端点，因无自有 daemon placement 必然走借用回退，回退需 daemon:borrow。复用现有端点、不改端点鉴权。business_member 因无自有 daemon 天然只能借、不会全量跑自有 agent。
- normalized_requirement: business_member 角色带 task:run_agent + daemon:borrow；不新建 /borrow-run 端点；placement 用 daemon:borrow 判定借用回退授权。
- impacts: Phase 2、§6（members_service.py 白名单）、D-006@v1 被取代
- evidence: agent/router.py:305（require_permission TASK_RUN_AGENT）；workspace/members_service.py:42（ROLE_KEY_WHITELIST）；查证报告第 5 点
- priority: P0

## D-007@v2: daemon 沙箱候选 B 为主路径
- type: 可行性
- status: accepted
- supersedes: D-007@v1
- source: design-grill（主 agent 自审）
- question: 独立 runtime_id(候选A)依赖 daemon 注册模型改造，可行性存疑，怎么办？
- answer: 候选 B（复用 lender runtime_id + PolicyEngine 按 lease 而非 runtime 隔离 allowed_roots，borrow lease 显式只读 root_path）为本变更主路径。候选 A（独立 runtime_id）降为可选优化，R-09 待 plan spike。
- normalized_requirement: borrow lease 写策略按 lease 隔离（只读 root_path，不写 lender allowed_roots）；不依赖 daemon runtime 注册模型改造。
- impacts: Phase 4、§6（daemon.ts/session-manager.ts 改造范围收窄到 PolicyEngine 按 lease 隔离）、R-02、R-09
- evidence: session-manager.ts:1037-1102（PolicyEngine 按 runtime 缓存→改为按 lease）；查证报告第 4 点
- priority: P0

## D-010@v1: 落 file 钩子 = close_interactive_run / complete_lease 回调
- type: 定义
- status: accepted
- source: design-grill（主 agent 自审）
- question: agent run 完成后，backend 在哪个回调点落方案到 file？
- answer: interactive 收口走 close_interactive_run / complete_lease 回调（对齐 scan/stage 完成走 close_interactive_run 的既有模式）。在该回调拿方案文本（agent final message）→ 调 FileService.upload_file。
- normalized_requirement: 借用 agent run completed 回调（close_interactive_run/complete_lease）里挂落 file 逻辑；borrowed lease 才落，普通 lease 不影响。
- impacts: Phase 5、§6（agent run 完成回调链路）、§7.5 生命周期契约（落 file+审计行）
- evidence: daemon/router.py close_interactive_run/complete_lease 回调端点；scan-stage-interactive-dispatch memory（完成走 close_interactive_run）
- priority: P1
