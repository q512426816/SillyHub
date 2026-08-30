---
id: task-05
title: 'notify-owner-and-resolve-pending-on-change-approval-actions'
title_zh: '触发点② change 四门+approve/reject 结果通知 owner 与待办消解'
author: 'qinyi'
created_at: 2026-08-29 21:04:42
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-007@v1]
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/tests/
expects_from:
  - task_id: task-02
    contract: NotificationService.resolve_pending
    needs: [ref_type, ref_id, types]
  - task_id: task-02
    contract: NotificationService.notify_user
    needs: [workspace_id, recipient_user_id, type, title, body, link, ref_type, ref_id]
goal: >
  在 change/service.py 的四个审核门动作（2498/2579/2683/3030）与 approve（687）/reject（702）末尾，
  按 _maybe_notify_session（2396）同层同风格旁路挂通知——先 resolve_pending 消解该变更的 approval_pending
  待办，再 notify_user 向变更 owner 发 approval_result 结果通知（design §7.3 触发点②）。
implementation:
  - 新增私有辅助方法封装消解+定向通知两步（镜像 _maybe_notify_session 的旁路风格），供六个动作点复用
  - 四个门动作与 approve/reject 在动作成功提交后调用辅助方法，先 resolve_pending（ref_type 用 change，ref_id 用 str(change_id)，types 默认 approval_pending，D-007@v1），再 notify_user
  - notify_user 以 owner_id 为 recipient，type 用 approval_result；通过/驳回/回退三种结果都通知，title 按结果区分，body 带审批人与驳回原因等上下文，link 指向变更页
  - owner_id 为 None 时跳过通知不报错；通知整体 best-effort，异常仅 log.warning 不影响审批动作结果
  - 在 change/tests 补用例，覆盖四门+approve/reject 消解待办、owner 收到结果通知、owner 缺失跳过、通知异常不影响动作；跑既有 review/approval_notify_session/step_progress 相关测试回归
acceptance:
  - 任一审批动作成功后，该变更未读的 approval_pending 通知被批量置已读（resolve_pending 生效）
  - 变更 owner 收到 approval_result 通知，通过/驳回/回退 title 与 body 语义正确
  - owner 缺失或通知异常时审批动作仍正常完成
verify:
  - cd backend && python -m pytest app/modules/change/tests -q
constraints:
  - 不改变四门/approve/reject 既有事务与响应语义，通知只在动作成功提交后旁路触发
  - 不修改 _maybe_notify_session 既有行为，不改审批页轮询兜底
related_tests:
  - backend/app/modules/change/tests/test_review_apis.py
  - backend/app/modules/change/tests/test_approval_notify_session.py
  - backend/app/modules/change/tests/test_step_progress.py
  - backend/app/modules/change/tests/test_gate_transitions.py
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
