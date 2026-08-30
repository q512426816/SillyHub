---
id: task-04
title: 'hook-pending-approval-broadcast-in-upsert-progress'
title_zh: '触发点① platform_sync.upsert_progress 待办产生钩子（in-hand latest_progress 判定，best-effort）'
author: 'qinyi'
created_at: 2026-08-29 21:04:42
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-011@v1, D-009@v2, D-001@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/platform_sync/service.py
  - backend/app/modules/platform_sync/tests/
expects_from:
  - task_id: task-02
    contract: NotificationService.notify_broadcast
    needs: [workspace_id, permission, type, ref_type, ref_id, dedupe_key]
goal: >
  在 platform_sync.upsert_progress 尾部旁路挂接待办产生钩子——用 in-hand latest_progress（本次刚提交的 body）
  判定 pending 审核门，命中时调用 task-02 的 notify_broadcast 广播 approval_pending 通知，
  钩子整体 best-effort 不影响进度落库（design §7.3 触发点①）。
implementation:
  - 在 upsert_progress 进度落库提交后的尾部加旁路钩子，数据源用 in-hand latest_progress（D-011@v1），复用 _project_current_stage 提取与 StageProjectionService._map 的既有语义（先例 change/service.py 1882-1943），单值返回同一时刻至多一门 pending，无需多门循环
  - 禁止改读 compute_pending_review（其读 sillyspec.db 镜像文件，时点滞后会漏发/迟发）
  - pending 命中时调用 NotificationService.notify_broadcast，permission=CHANGE_CREATE，type=approval_pending，ref_type 用 change，ref_id 用 str(change_id)，dedupe_key 用 change_id 加 review_kind 拼接；title 形如 变更「{change_name}」等待{门中文名}审核，body 摘要阶段信息，link 指向变更页
  - 幂等检查由 task-02 service 内统一执行，触发点不做存在性检查（D-009@v2）
  - 钩子整体 try/except 包裹，判定或通知任何异常仅 log.warning，不影响 progress 落库结果（D-006@v1）
  - 在 platform_sync/tests 下补钩子用例，覆盖 pending 命中广播、非 pending 不广播、通知异常不炸进度落库；跑既有 test_pk_semantics/test_router 回归
acceptance:
  - 本次 progress 推送使审核门进入 pending 时，持有 CHANGE_CREATE 权限的活跃用户收到 approval_pending 广播
  - 非 pending 或门未变化的推送不产生通知（幂等由 service 保证，重复推送不重复通知）
  - 通知路径抛异常时 upsert_progress 仍正常返回，进度已落库
verify:
  - cd backend && python -m pytest app/modules/platform_sync/tests -q
constraints:
  - 不修改 upsert_progress 既有签名与落库语义，钩子只在尾部旁路
  - 不重读 sillyspec.db 或 compute_pending_review（D-011@v1）
  - 深链 link 格式在 execute 时对照前端路由确定（自审存疑 S-02），本卡不锁死格式
related_tests:
  - backend/app/modules/platform_sync/tests/test_pk_semantics.py
  - backend/app/modules/platform_sync/tests/test_router.py
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
