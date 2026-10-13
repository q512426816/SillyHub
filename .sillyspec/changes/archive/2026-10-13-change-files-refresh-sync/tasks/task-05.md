---
id: task-05
title: 'backend 测试——pytest（mock send_rpc/binding/online）：在线触发成功后才 list、未绑定/离线/超时/远端错误四路降级均正常返回、change_key+workspace_id 透传正确；既有 test_files_router.py 回归全绿 [target: NEW:backend/app/modules/change/tests/test_files_refresh_sync.py]'
title_zh: 'backend 测试——pytest（mock send_rpc/binding/online）：在线触发成功后才 list、未绑定/离线/超时/远端错误四路降级均正常返回、change_key+workspace_id 透传正确；既有 test_files_router.py 回归全绿 [target: NEW:backend/app/modules/change/tests/test_files_refresh_sync.py]'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-13 12:58:32
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/change/tests/test_files_refresh_sync.py
target_files: [NEW:backend/app/modules/change/tests/test_files_refresh_sync.py]
goal: >
  backend 前置行为的 pytest 闭环：触发成功路径 + 四路降级 + 参数透传——FR-01/FR-02 可验证化与回归防线。
implementation:
  - 新建 backend/app/modules/change/tests/test_files_refresh_sync.py（pytest asyncio_mode=auto，fixture 惯例参照同目录既有测试如 test_files_router.py）
  - mock 面：monkeypatch get_daemon_ws_hub（FakeHub.capture send_rpc 调用参数与可编程返回/异常）、resolve_member_binding_or_none、query_daemon_online_by_id
  - 用例：①绑定在线 + send_rpc 正常 → send_rpc 被调且 method='sillyspec_sync_change'、change=change_key、workspace_id 正确 → 200 返回清单；②未绑定（None）→ send_rpc 不被调 → 200；③离线（None）→ 不被调 → 200；④send_rpc 抛 DaemonRpcTimeout → 200 正常返回；⑤send_rpc 抛 DaemonRpcRemoteError（模拟老 daemon method not found）→ 200 正常返回；⑥DaemonRuntimeOffline → 200
acceptance:
  - 新测试文件全绿；四路降级用例断言 HTTP 200 且响应 schema 与现状一致
  - 既有 test_files_router.py 复跑全绿（service 零改动回归证据）
verify:
  - cd backend && uv run pytest -q app/modules/change/tests/test_files_refresh_sync.py app/modules/change/tests/test_files_router.py --no-cov
constraints:
  - 不跑全量后端测试（CLAUDE.md 规则 0）
  - 不 mock 镜像文件系统本体（沿用既有 fixture 目录搭建惯例）
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
