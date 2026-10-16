---
id: task-06
title: 'change-write WS 推送 backend 侧（protocol 常量+notify helper+四落库点接线）'
title_zh: 'change-write WS 推送 backend 侧（protocol 常量+notify helper+四落库点接线）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 10:13:55
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/protocol.py
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/change/service.py
  - backend/app/modules/change_writer/proxy.py
  - backend/app/modules/spec_workspace/router.py
  - backend/app/modules/daemon/tests/test_ws_hub.py
target_files:
  - backend/app/modules/daemon/protocol.py
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/change/service.py
  - backend/app/modules/change_writer/proxy.py
  - backend/app/modules/spec_workspace/router.py
  - backend/app/modules/daemon/tests/test_ws_hub.py
provides:
  protocol: 常量 DAEMON_MSG_CHANGE_WRITE_AVAILABLE="daemon:change_write_available"，payload {type, runtime_id, workspace_id(可 null)}
  notify_helper: notify_change_write_available(session, runtime_id)——daemon_id 解析+ws_hub 定向推送 best-effort
goal: >
  change-write pending 行落库后经 WS 主动通知对应 daemon（四个落库点接线），30s 轮询将降级为兜底。
implementation:
  - 改 backend/app/modules/daemon/protocol.py：加常量 DAEMON_MSG_CHANGE_WRITE_AVAILABLE="daemon:change_write_available" 与 payload 形态（runtime_id + workspace_id 恒携带可 null）
  - 改 backend/app/modules/daemon/ws_hub.py：加 notify_change_write_available(session, runtime_id)——先经 _resolve_daemon_id_for_runtime 先例（backend/app/modules/daemon/agent_task_store.py:129）解析 daemon_id，再按连接注册表定向发送；daemon 离线/解析失败仅 debug 日志不抛不重试
  - 四落库点 commit 后接线：backend/app/modules/change/service.py:828 新建 + :821-826 match 更新、backend/app/modules/change_writer/proxy.py:410、backend/app/modules/spec_workspace/router.py:217
  - 改 backend/app/modules/daemon/tests/test_ws_hub.py 补 notify 单测：离线 debug 日志不抛/daemon_id 解析失败 best-effort/在线时定向发送 payload 断言
acceptance:
  - 四个落库点 commit 后均触发推送（测试 spy 断言）
  - 离线/无连接时调用不抛异常不阻塞主流程
  - 既有 change/change_writer/spec_workspace 测试全绿
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_ws_hub.py app/modules/change app/modules/change_writer app/modules/spec_workspace -q --no-cov
constraints:
  - 推送 best-effort：永不阻塞主流程、不重试（兜底轮询覆盖）
  - REST API 面零变化（OpenAPI 不变）
  - payload 字段名与 task-07 daemon 侧逐字对齐
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
