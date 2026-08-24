---
id: task-01
title: '共享 scope 查询+渲染函数——orchestrator.py 新增 collect_scope_workspace_statuses/render_scope_brief/render_session_orchestrator_briefing，render_orchestrator_prompt 改调共享函数（patrol 不引入探测）'
title_zh: '共享 scope 查询+渲染函数——orchestrator.py 新增 collect_scope_workspace_statuses/render_scope_brief/render_session_orchestrator_briefing，render_orchestrator_prompt 改调共享函数（patrol 不引入探测）'
author: 'qinyi'
created_at: 2026-08-24 18:47:00
priority: P0
depends_on: []
blocks: [task-03, task-06, task-10]
requirement_ids: [FR-01]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/agent/orchestrator.py
  - backend/app/modules/agent/tests/test_orchestrator_project_context.py
provides:
  - contract: collect_scope_workspace_statuses
    file: backend/app/modules/agent/orchestrator.py
    fields: [collect_scope_workspace_statuses, id, name, type, description, daemon_online, daemon_name, "git_mode(可选)"]
    consumers: [task-03, task-10]
  - contract: render_scope_brief
    file: backend/app/modules/agent/orchestrator.py
    consumers: [task-03, task-06, task-08, task-09]
  - contract: render_session_orchestrator_briefing
    file: backend/app/modules/agent/orchestrator.py
    consumers: [task-06, task-08, task-09]
goal: >
  把 render_orchestrator_prompt（orchestrator.py:107-225）的 scope 查询/渲染段抽为共享函数
  collect_scope_workspace_statuses（结构化）与 render_scope_brief（文本，git_probe 可选回调），
  并新增会话主控简报 render_session_orchestrator_briefing，供 task-03/06/08/09/10 复用同一
  「任一成员 binding + 在线状态 + git 模式」口径；patrol 旧调用零影响（FR-01 / D-004@v1，design §5.A）。
implementation:
  - 新增共享查询 collect_scope_workspace_statuses(mission, session, *, git_probe=None)——遍历 mission.scope_workspace_ids（无效 uuid 跳过，沿用现状 :157-192 语义），逐 ws 查 Workspace + 任一成员 WorkspaceMemberRuntime（daemon_id 非空首行），在线判定沿用 query_daemon_online_by_id + binding 属主 user_id（BE-P1-5 修正口径，禁回退全零 UUID 占位），机器名取该 daemon 的 display_alias||hostname；返回结构化条目，git_probe 探测回调传入时逐 ws 附加 git_mode
  - 新增 render_scope_brief(mission, session, *, git_probe=None)——每工作区一行 - <name>（id=..., type=..., desc=..., 机器=<display_alias||hostname>, daemon=在线|离线），未绑定机器显示「未绑机器」；git_probe 未传时模式字段整体省略（不渲染 模式=未知），传入时追加 模式=git隔离|直通|未知
  - 新增 render_session_orchestrator_briefing(mission, session, *, git_probe=None) -> str——主控角色说明 + mission_id + 锚点工作区（mission.workspace_id 对应 ws 名与 id）+ 目标 + scope 清单（调 render_scope_brief）+ dispatch_worker 用法（target_workspace_id 跨工作区必传）+ mission_status 工具提示 + 禁越权约束（复用 render_orchestrator_prompt 既有文案段 :215-224）
  - render_orchestrator_prompt 的 scope_context 段（:148-196）改调上述共享函数且不传 git_probe；函数签名与其余段（preset_hint / project_context / 五工具用法 / 禁越权文案）不动，输出与现状结构等价+新增机器名字段
  - 扩展 backend/app/modules/agent/tests/test_orchestrator_project_context.py——collect 结构化字段断言（daemon_name 口径与 git_mode 缺省省略）、render_scope_brief 机器/模式字段断言、render_session_orchestrator_briefing 关键段断言、render_orchestrator_prompt 既有断言零回归+新增机器名断言
acceptance:
  - collect_scope_workspace_statuses 条目字段= id/name/type/description/daemon_online/daemon_name，daemon_name 取任一成员 binding 的 daemon display_alias||hostname（未绑=None），git_mode 仅当传入 git_probe 时存在
  - 在线判定= query_daemon_online_by_id + binding 属主 user_id（BE-P1-5），无全零 UUID 占位回退
  - render_scope_brief 每工作区一行含 机器= 与 daemon=在线|离线 字段，git_probe 未传时无模式字段
  - render_session_orchestrator_briefing 输出含 mission_id、锚点工作区、目标、scope 清单、dispatch_worker 用法（target_workspace_id）、mission_status 工具提示与禁越权约束段
  - render_orchestrator_prompt 输出与改前结构等价+新增机器名字段，test_orchestrator_project_context.py 既有断言及 test_orchestrator.py / test_patrol.py 全部零回归
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_orchestrator_project_context.py -q
  - cd backend && uv run pytest app/modules/agent/tests/test_orchestrator.py app/modules/agent/tests/test_patrol.py -q
  - cd backend && uv run ruff check app/modules/agent/orchestrator.py && uv run mypy app/modules/agent/orchestrator.py
constraints:
  - patrol 调用零影响——patrol.py 仍走 render_orchestrator_prompt 且不传探测回调、不引入任何探测 RPC，输出结构等价+仅新增机器名字段（design §9 CC-08 口径），desc/type 等既有字段保留
  - git_probe 回调可选，不传时模式字段省略而非写「未知」；本 task 不实现探测本身（task-02 提供 helper，task-03/06 接线）
  - 不改 render_orchestrator_prompt 函数签名与其余段落（preset_hint / project_context / 五工具用法 / 禁越权文案原文保留）
  - 机器名与在线口径=任一成员 binding（不限本人），与 §5.C probe 端点同一口径（UB-2）；未绑机器渲染「未绑机器」
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
