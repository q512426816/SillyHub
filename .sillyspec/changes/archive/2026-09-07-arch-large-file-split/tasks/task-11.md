---
id: task-11
title: 'backend-light-refactor-background-task-mixin-event-publish-attachment-pipeline'
title_zh: 'Wave2 轻重构——_background_tasks.py mixin + event_publish.py + attachment_pipeline.py（白名单 ③④⑤）'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P1
depends_on: ['task-08', 'task-09', 'task-10']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-002@v1, D-005@v3]
allowed_paths:
  - backend/app/modules/daemon/_background_tasks.py
  - backend/app/modules/daemon/event_publish.py
  - backend/app/modules/daemon/attachment_pipeline.py
  - backend/app/modules/daemon/tests/test_background_tasks_mixin.py
  - backend/app/modules/daemon/tests/test_event_publish.py
  - backend/app/modules/daemon/tests/test_attachment_pipeline.py
  - backend/app/modules/daemon/session/service/
  - backend/app/modules/daemon/group/service/
  - backend/app/modules/daemon/run_sync/service/
goal: >
  落地 backend 轻重构白名单 ③④⑤——新增 _background_tasks.py、event_publish.py、attachment_pipeline.py 三个共享模块消灭跨文件重复实现，且不改任何调用方可见行为。
implementation:
  - 新增 _background_tasks.py 共享 mixin，_fire_background_task 从 SessionService 与 RunSyncService 的逐字节相同实现原样提取，_on_background_task_done 消除仅类名引用差异，改为经 self 多态解析 _background_tasks 集合
  - 新增 event_publish.py，统一 session/run_sync/group 四文件 5+ 处同构 Redis publish helper，保持原调用签名不变
  - 新增 attachment_pipeline.py，收敛 session 侧 inject 附件校验/装配与 group 侧 _validate_group_attachments/_assemble_group_inject_attachments 两份实现，两处调用签名不变
  - 三个 service 包内被收敛的调用点改为消费共享模块，被 patch 符号仍按 D-007 经原模块命名空间延迟解析
  - 三个新定向测试文件覆盖 mixin 多态解析、publish helper、附件管线收敛路径
acceptance:
  - 三个新模块与三个新测试文件存在且各自定向测试通过
  - 后台任务双份实现、同构 publish helper 与附件校验/装配双份实现全部收敛，原调用签名与既有行为不变
  - 白名单 ③④⑤ 之外零行为改动，既有测试零修改通过
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_background_tasks_mixin.py app/modules/daemon/tests/test_event_publish.py app/modules/daemon/tests/test_attachment_pipeline.py -q --no-cov
  - cd backend && uv run pytest app/modules/daemon/tests -q --no-cov -n auto
  - cd backend && uv run ruff check app
constraints:
  - 仅做白名单 ③④⑤ 三项且不进 daemon/schema.py 公共 DTO，不改对外 API 与事件 payload（FR-05）
  - 每项独立 git 提交可单独 revert，零既有测试文件改动
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
