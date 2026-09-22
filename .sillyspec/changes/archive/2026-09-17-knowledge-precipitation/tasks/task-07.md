---
id: task-07
title: 'add-distill-dispatch-service-and-endpoints'
title_zh: 'backend distill 派发服务 + 端点（AgentRun metadata_/源校验/任务列表；落地后重跑 pnpm gen:types）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-17 10:44:49
priority: P0
depends_on: ['task-02', 'task-04']
blocks: ['task-08']
requirement_ids: [FR-01, FR-03]
decision_ids: [D-002@v1]
expects_from:
  - contract: Permission.KNOWLEDGE_WRITE
    needs: [权限枚举值]
provides:
  - contract: DistillDispatchIn
    fields: [source_type, source_ref, focus]
  - contract: DistillTaskRead
    fields: [agent_run_id, source_type, source_ref, status, created_at]
related_tests:
  - backend/app/modules/knowledge/tests/test_router.py
allowed_paths:
  - NEW:backend/app/modules/knowledge/distill.py
  - backend/app/modules/knowledge/router.py
  - backend/app/modules/knowledge/schema.py
  - backend/app/modules/knowledge/tests/
  - backend/app/modules/knowledge/tests/test_distill.py
  - backend/app/modules/knowledge/tests/test_router.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files:
  - NEW:backend/app/modules/knowledge/distill.py
  - backend/app/modules/knowledge/router.py
  - backend/app/modules/knowledge/schema.py
  - NEW:backend/app/modules/knowledge/tests/test_distill.py
  - backend/app/modules/knowledge/tests/test_router.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
goal: >
  新增 DistillDispatchService 与 POST /knowledge/distill、GET /knowledge/distill/tasks 两端点，
  会话/变更双来源派发复用 spec_workspace bootstrap 链路创建 knowledge-distill 类 AgentRun
  （源校验 + prompt 模板 + daemon 离线立即 failed），任务列表按 metadata_ 过滤 kind，
  兑现 FR-01/FR-03 蒸馏派发（D-002 派发 agent 会话、后端不直调 LLM）。
implementation:
  - 新增 distill.py 定义 DistillDispatchService——dispatch 源校验后创建 AgentRun 并 fire-and-forget，list_tasks 过滤 knowledge-distill 类任务按 created_at 倒序返回 DistillTaskRead
  - 源校验实名调用既有服务——会话源 SessionService.get_agent_session(session_id, user_id)（daemon/session/service，不存在沿 DaemonSessionNotFound 404 语义）且 turn_count > 0 否则 422；变更源 ChangeService.get_by_key(workspace_id, change_key)（不存在沿 ChangeNotFound 语义）且 status 为 archived 否则 422
  - 创建 AgentRun 照 bootstrap 先例（backend/app/modules/spec_workspace/bootstrap.py:128）——status=pending、agent_type=claude_code、provider/model 取 workspace.default_agent/default_model 兜底，metadata_ ORM 属性（backend/app/modules/agent/model.py:412，DB 列名 metadata）写 kind=knowledge-distill 与 source_type/source_ref/focus 四键，建 AgentRunWorkspace(agent_run_id, workspace_id) 关联，后台执行任务持强引用防 GC（_BACKGROUND_BOOTSTRAP_TASKS 同款 holder）
  - 后台执行链照 backend/app/modules/spec_workspace/bootstrap.py:456——RunPlacementService.decide_backend 抛 NoOnlineDaemonError 时立即置 status=failed、error_code=no_online_daemon、finished_at、exit_code=1、output_redacted 后 commit 并发 done 事件，任务创建本身成功且状态立即可查
  - prompt 模板固化（R-05）——按 source_type 分会话/变更两式，内嵌 source_ref 与可选 focus，指令为读源记录提炼后执行 sillyspec knowledge propose 并写死 --title/--category/--body 用法，产物经既有上行同步回流（daemon 零改动）
  - schema.py 增 DistillDispatchIn（source_type 取 session/change、source_ref、focus 可选）与 DistillTaskRead（agent_run_id/source_type/source_ref/status/created_at，自 AgentRun 与 metadata_ 投影）；dispatch 响应复用 DistillTaskRead 形状供前端任务条立即渲染
  - router.py 增 POST /knowledge/distill 挂 require_permission(Permission.KNOWLEDGE_WRITE) 与 GET /knowledge/distill/tasks 挂 KNOWLEDGE_READ——两字面量路由注册在 knowledge 通配读路由（filename path 参数）之前，防 GET 任务列表被通配吞掉（design 接口定义注册序规则）
  - 新增 tests/test_distill.py 覆盖源校验分支（无记录会话 422/未归档变更 422/正常派发）、metadata_ 四键形状、AgentRunWorkspace 关联、daemon 离线立即 failed(no_online_daemon)；test_router.py 补端点权限两态与任务列表只含 distill 类用例
  - 落地后重跑 pnpm gen:types 提交 backend/openapi.json 与 frontend/src/lib/api-types.ts（禁手写类型，供 task-08 消费）
acceptance:
  - 派发成功创建 AgentRun 且 metadata_ 含 kind=knowledge-distill/source_type/source_ref/focus 四键、AgentRunWorkspace 关联建立，响应含 agent_run_id 与 status
  - daemon 离线时任务创建成功且状态立即可查为失败态（error_code=no_online_daemon）
  - 无记录会话与未归档变更派发返回 422；不存在的会话/变更沿既有 404 语义
  - GET /knowledge/distill/tasks 仅返回 knowledge-distill 类任务（其它 AgentRun 不混入），字段 agent_run_id/source_type/source_ref/status/created_at 齐全
  - 写端点对仅 KNOWLEDGE_READ 用户 403；openapi.json 与 api-types.ts 已再生成随变更提交
verify:
  - cd backend && uv run pytest app/modules/knowledge -q
  - cd frontend && pnpm gen:types && pnpm exec tsc --noEmit
constraints:
  - daemon 与 lease/session 状态机零改动（生命周期契约表 5/6 事件全复用既有，本 task 仅新增 dispatch 事件生产者）
  - 不做后端直调 LLM 蒸馏（D-002）；distill 无独立状态机以 AgentRun 状态为准
  - 源校验只读调用既有服务方法不改其签名；路由字面量先于通配注册的规则与 task-04 一致；writer 写路径（task-04 产物）不动
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
