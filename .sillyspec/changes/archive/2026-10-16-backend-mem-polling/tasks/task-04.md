---
id: task-04
title: 'ws_hub 修复（_pending_rpcs 两泄漏径+disconnect 身份校验）+ 回归测试'
title_zh: 'ws_hub 修复（_pending_rpcs 两泄漏径+disconnect 身份校验）+ 回归测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 10:13:55
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/daemon/tests/test_ws_hub.py
target_files:
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/daemon/tests/test_ws_hub.py
goal: >
  修复 ws_hub 两条 _pending_rpcs 泄漏路径与 disconnect 无身份校验问题（重连风暴自我放大器）。
implementation:
  - 改 backend/app/modules/daemon/ws_hub.py:594-612 send_rpc 的 CancelledError 分支：补 _pending_rpcs 条目清理（对齐 TimeoutError 分支的 _cancel_rpc）
  - 改 backend/app/modules/daemon/ws_hub.py:630-647 resolve_rpc：done future 早退（ws_rpc_already_resolved）前先 pop 条目
  - 改 backend/app/modules/daemon/ws_hub.py:114-131 disconnect：加连接实例身份校验——仅当传入 ws 与注册表当前 ws 为同一实例才 pop（对齐 :133-158 _evict_stale 先例）
  - 改 backend/app/modules/daemon/tests/test_ws_hub.py 补三径回归：外部取消后表清空/迟到回包后条目不残留/旧连接滞后 disconnect 不踢新连接
acceptance:
  - 三路径执行后 _pending_rpcs 对应条目不残留（测试）
  - 滞后 disconnect 后新连接仍在注册表且可收推送（测试）
  - 既有 ws_hub 测试全绿
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_ws_hub.py app/modules/daemon/tests/test_ws_rpc.py -q --no-cov
constraints:
  - 不改 connect/_evict_stale 既有语义
  - send_rpc 超时清理行为保持不变
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
