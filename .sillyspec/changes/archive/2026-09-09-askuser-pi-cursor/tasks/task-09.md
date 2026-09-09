---
id: task-09
title: 'open shadow-session dialog answer authorization to group members'
title_zh: 'backend 影子会话答题授权放开（群成员可答 + manual_approval 守卫豁免 + answered_by 实际答题人）+ 越权反例测试'
author: 'qinyi'
created_at: 2026-09-09 23:09:21
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-004@v2, D-006@v2]
allowed_paths:
  - backend/app/modules/daemon/permission_service.py
  - backend/app/modules/daemon/tests/test_session_permissions.py
target_files:
  - backend/app/modules/daemon/permission_service.py
  - backend/app/modules/daemon/tests/test_session_permissions.py
goal: >
  放开群聊影子会话（session_kind='group_member'）的 ask_user 类 dialog 答题授权——
  该群未移除用户成员先到先得可答（D-004@v2），manual_approval 守卫对影子分支的
  dialog 应答豁免，answered_by 记录实际答题人（修正现为群主失真的归属），
  越权反例单测守住 R-08 边界。
provides:
  - contract: shadow_dialog_answer
    fields: [shadow_member_answer_allowed, answered_by_actual_user]
implementation:
  - permission_service.py respond_permission 授权门（:949 _get_owned_session_for_update 未命中将 404 处）加影子会话群成员分支：request_id 先解析 pending dialog 行，目标会话 session_kind='group_member' 时经 resolve_shadow_member（group/service/helpers.py:288）定位成员行与所属群，再经 get_active_user_membership 校验答题者为该群未移除用户成员 → 放行取影子会话；双条件不满足维持 404 不泄露存在性
  - manual_approval 第二道守卫（:959-963）影子分支豁免：session_kind='group_member' 且为 dialog 行应答（dialog_kind 非空的 ask_user 类）时跳过 DaemonPermissionManualDisabled（群聊影子 manual_approval 恒关是现状）；普通会话与无 dialog_kind 的 canUseTool 权限审批路径语义零变化
  - answered_by 实际答题人：_respond_dialog（:1186 现读 session_obj.user_id，影子会话即群主归属失真）改为透传 respond_permission 实际请求 user_id 落列，SSE permission_resolved payload 同步携带实际答题人标识（前端关闭态显示 ×× 名的数据源）
  - test_session_permissions.py 新增用例：群成员（非群主）答影子会话 pending dialog 成功且 answered_by=该成员；越权反例——非群成员 404、普通单聊非属主 404、影子会话普通权限审批仍被 manual_approval 守卫拒；已答 409 幂等（:1119 既有语义）覆盖影子路径；既有 manual_approval/非属主断言适配
acceptance:
  - 该群未移除用户成员对群聊影子会话 pending ask_user dialog 提交应答成功，dialog 行翻 answered 且 answered_by=答题成员 user_id
  - 非群成员答题 404；普通单聊非属主答题 404；影子会话普通权限审批（无 dialog 行）仍被 manual_approval 守卫拒绝
  - 普通单聊 manual_approval=True 会话答题行为与现状一致（既有测试全绿，授权语义不变）
  - permission_resolved SSE 事件携带实际答题人标识（answered_by 数据源）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_permissions.py -q
constraints:
  - 豁免仅限 ask_user 类 dialog 行应答（dialog_kind 非空）；权限审批（canUseTool）manual_approval 守卫语义不动（D-006@v2 唯一例外边界）
  - 普通单聊（kind='chat'）授权路径零改动——_get_owned_session_for_update 首查单 SQL 与 404 不泄露存在性语义不变
  - 不改 SessionDialogRequest 列结构、answer 端点签名、PERMISSION_RESPONSE 下行协议；已答 409 / 终态 404 幂等语义保持（R-03 不新增锁）
  - R-08 越权反例（非群成员、非影子会话借道）必须有单测覆盖
related_tests:
  - backend/app/modules/daemon/tests/test_session_permissions.py（respond_permission 插入影子放行与守卫豁免分支后，manual_disabled/非属主等既有断言需适配，原语义不变）
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
