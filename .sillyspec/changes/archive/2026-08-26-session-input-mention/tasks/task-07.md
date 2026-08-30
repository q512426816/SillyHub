---
id: task-07
title: add-inject-bind-fields-and-binder
title_zh: inject 新增 bind 字段三层透传并接入幂等 binder
author: qinyi
created_at: 2026-08-26 23:43:50
priority: P0
depends_on: []
blocks: [task-08]
requirement_ids: [FR-06]
decision_ids: [D-003, D-004, D-005]
allowed_paths:
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_session_service.py
  - backend/app/modules/daemon/tests/test_session_router.py
  - backend/app/modules/daemon/tests/test_session_queue.py
provides:
  - contract: SessionInjectRequest
    fields: [bind_change_key, bind_quick_id]
goal: >
  SessionInjectRequest 新增 bind_change_key 与 bind_quick_id 可选字段，
  经 router 与 Facade 与 SessionService 三层透传，在行锁后与 tool_report
  早退前调用既有幂等 binder，使忙轮排队路径同样完成会话绑定。
implementation:
  - schema.py 的 SessionInjectRequest 加 bind_change_key（str 或 None，max_length 200）与 bind_quick_id（str 或 None，max_length 128 加 ql- 前缀正则），缺省 None，不纳入 _require_prompt_or_switch 空 prompt 豁免
  - router.py inject_session 端点与 daemon/service.py Facade inject_session 同步加参透传（三层漏透传会 500，必须同步）
  - session/service.py 的 SessionService.inject_session 在 _get_owned_session_for_update 之后与 tool_report 懒激活早退之前插入 binder 调用，覆盖忙轮 queue_when_busy 排队早退分支
  - binder 调用显式传 session.workspace_id，None 时照抄 create 路径守卫记 warning 跳过；binder 自带 savepoint 不抛，调用后记结构化日志即可
  - pytest 三文件补用例——test_session_service 幂等与 None 守卫与跨 workspace 仅在会话自有工作区建 placeholder 与 bind 失败不阻断发送；test_session_router 超长与非法 ql 前缀 422 且不豁免空 prompt；test_session_queue 忙轮排队仍绑定
acceptance:
  - 请求体不带 bind 字段时后端行为与旧版完全一致（零回归）
  - 携带字段时 bind_session_to_change 与 bind_session_to_quicklog 幂等调用，重复 inject 不产生重复 link 行
  - 忙轮排队路径（queue_when_busy）消息入队前完成绑定
  - workspace_id 为 None 记 warning 跳过不抛错，binder 失败不阻断消息发送
  - bind_quick_id 超 128 或非 ql- 前缀返回 422，bind 字段不豁免空 prompt 校验
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_service.py app/modules/daemon/tests/test_session_router.py app/modules/daemon/tests/test_session_queue.py -q
constraints:
  - inject_session_as_service 服务身份旁路不经三层链路，零改动
  - 不改消息模型与渲染协议，绑定不注入 prompt 前导
  - 跨 workspace 维持 binder 既有 placeholder 行为，不为 inject 单开分歧分支（D-004）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
