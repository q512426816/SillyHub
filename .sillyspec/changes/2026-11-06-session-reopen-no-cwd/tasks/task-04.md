---
id: task-04
title: 'backend SESSION_RESUME payload cwd 条件键（lifecycle + sweep 两处构造）+ 测试'
title_zh: 'backend SESSION_RESUME payload cwd 条件键（lifecycle + sweep 两处构造）+ 测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-06 23:03:28
priority: P0
blocks: []
requirement_ids: [FR-01, FR-05]
decision_ids: [D-002@v2]
depends_on: [task-01, task-03]
allowed_paths:
  - backend/app/modules/daemon/session/service/session_lifecycle.py
  - backend/app/modules/daemon/sweep.py
  - backend/app/modules/daemon/tests/test_session_reopen.py
  - backend/app/modules/daemon/tests/test_session_reconnect_sweep.py
target_files:
  - backend/app/modules/daemon/session/service/session_lifecycle.py
  - backend/app/modules/daemon/sweep.py
  - backend/app/modules/daemon/tests/test_session_reopen.py
  - backend/app/modules/daemon/tests/test_session_reconnect_sweep.py
goal: >
  SESSION_RESUME payload 的 cwd 由恒发改为条件键（session.cwd 非空才入键、不发 null）——reopen 主路径与 sweep 恢复路径两处构造同步，daemon 三级链自然接管空 cwd 会话。
implementation:
  - backend/app/modules/daemon/session/service/session_lifecycle.py :296-303 resume_payload 构造：`"cwd": session.cwd` 恒发改条件入键（cwd 非空字符串才写入 dict，空/None 省略整键——对齐同函数 provider_config 条件入键先例 :304-307）
  - backend/app/modules/daemon/sweep.py 恢复路径 payload 构造（:611-755 区间内，enqueue_and_push 通道同款字段）同步条件化
  - 测试：空 cwd 会话 resume payload 无 cwd 键（断言 dict 无键，非 None 值）；工作区会话 payload 含 cwd 且值与 session.cwd 一致（逐字节不变断言，FR-05）
acceptance:
  - 空 cwd 会话的 SESSION_RESUME payload 序列化后无 cwd 键（不发 null）
  - 工作区会话 payload 与现状逐字节一致（FR-05 零回归）
  - lifecycle 与 sweep 两处构造行为一致（两测试文件各有形态覆盖）
verify:
  - uv run --project backend pytest app/modules/daemon/tests/test_session_reopen.py app/modules/daemon/tests/test_session_reconnect_sweep.py -x -q
constraints:
  - 不改 payload 其它字段与 enqueue 通道
  - 聚焦测试，禁跑全量
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
