---
id: task-11
title: 'backend 单测收口——受理放宽/即时 deny payload/error_code 断言 + 既有 fail-soft 测试断言修订（拒收时断言 hub 收到 deny）+ 相关测试跑绿'
title_zh: 'backend 单测收口——受理放宽/即时 deny payload/error_code 断言 + 既有 fail-soft 测试断言修订（拒收时断言 hub 收到 deny）+ 相关测试跑绿'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 16:45:00
priority: P0
depends_on: ['task-07', 'task-08', 'task-09']
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/test_session_permissions.py
  - backend/app/modules/daemon/tests/test_ws_hub_permission.py
  - backend/app/modules/daemon/tests/test_permission_http_uplink.py
  - backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py
  - backend/app/modules/daemon/permission_service.py
  - backend/app/modules/agent/service.py
goal: >
  backend 侧单测收口：受理放宽、即时 deny payload、error_code 断言补齐，并确认
  既有 fail-soft 测试在新增 deny 推送后仍通过（mock hub 放行，return False 断言不变）。
implementation:
  - 受理放宽用例：background_task=True + run completed 仍受理；run 归属不匹配
    （run.agent_session_id != session_id）拒收且 hub 收到 deny。
  - 即时 deny payload 断言：mock _hub 校验各失败分支推送的 decision / message /
    runtime_id 键形态（对齐 :1503-1510 先例）。
  - error_code 断言：SERVICE_RESTART_INTERRUPTED + error_detail 内容。
  - 既有 fail-soft 测试确认通过：return False / accepted=False 断言不变，新增
    deny 推送用 mock hub 放行。
acceptance:
  - 新用例全部通过，覆盖受理放宽 / 即时 deny / error_code 三类断言。
  - 既有 fail-soft 断言（accepted=False / return False）保持不变且通过。
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/ app/modules/agent/tests/test_cleanup_stale_runs_error_code.py -q --no-cov
constraints:
  - 注释与实现一致（CLAUDE.md 规则18）。
  - 不引入无关变更；本 task 只做测试收口与断言修订。
  - 不许跑全量测试套件（CLAUDE.md 规则0）。
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
