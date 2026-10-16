---
id: task-03
title: '权限定时器会话治理（新短会话+全路径提交+事务边界收窄）+ 回归测试'
title_zh: '权限定时器会话治理（新短会话+全路径提交+事务边界收窄）+ 回归测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 10:13:55
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/permission_service.py
  - backend/app/modules/daemon/control_commands.py
  - backend/app/modules/daemon/tests/test_permission_http_uplink.py
target_files:
  - backend/app/modules/daemon/permission_service.py
  - backend/app/modules/daemon/control_commands.py
  - backend/app/modules/daemon/tests/test_permission_http_uplink.py
goal: >
  权限 5 分钟超时定时器不再 pin 已关闭的 AsyncSession、全路径正确提交、事务不跨 WS 推送——消除生产 postgres idle-in-transaction FATAL。
implementation:
  - 改 backend/app/modules/daemon/permission_service.py:1543-1648 _on_timeout：经 session_factory() 开全新短会话执行收尾；:1620-1638 route_key None 早退路径补 commit/rollback 后关闭
  - 改 backend/app/modules/daemon/control_commands.py:182 enqueue_and_push 事务收窄：commit 落 pending 行后再做 WS 推送（推送移出数据库事务）
  - 改 backend/app/modules/daemon/tests/test_permission_http_uplink.py 补四态回归：超时 deny/正常应答/route_key None/通知失败——断言每路径 session 关闭且 commit/rollback 被调
acceptance:
  - 各路径不再复用外层已关闭 session（测试断言新 factory 会话）
  - 全路径 commit/rollback 后关闭，无挂起事务
  - 既有 permission 相关测试全绿（verify 命令两文件零回归）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_permission_http_uplink.py app/modules/daemon/tests/test_session_permissions.py -q --no-cov
constraints:
  - 5min 超时时长与 deny 放行语义不变
  - 通知 best-effort 语义不变（失败不抛）
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
