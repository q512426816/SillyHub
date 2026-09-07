---
id: task-03
title: 'backend compare 测试先行（权限/白名单/504/diff/截断/containment）'
title_zh: 'backend compare 测试先行（权限/白名单/504/diff/截断/containment）'
author: 'qinyi'
created_at: 2026-09-07 13:53:21
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-06, FR-07, FR-08]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/test_sillyspec_compare.py
target_files:
  - NEW:backend/app/modules/daemon/tests/test_sillyspec_compare.py
goal: >
  为 backend compare 编排端点与 diff 服务先行落地失败测试，把权限、change 白名单、
  504、spec-tree 四分类与 diff 对齐、截断护栏、containment、progress 归一化这些
  行为契约冻结成可执行断言，task-04 的实现以本测试文件转绿为验收靶。
implementation:
  - 新建 test_sillyspec_compare.py，沿用 daemon/tests/conftest.py 既有客户端与用户 fixtures；mock 边界打在 ws_hub.send_rpc（ws_hub.py:495）与平台侧 SpecWorkspaceService/PlatformSyncService 调用上，不真连 daemon
  - 权限用例——owner 200、平台管理员 200、非 owner 非管理员 404（_get_owned_instance 语义）；change 白名单非法值（含 .. 段）422，复用 resolve 端点同款 _validate_change 正则（router.py:1401 区）
  - 离线与超时用例——send_rpc 离线/超时 → 504（DaemonRuntimeOffline 范式），并断言显式 15s 超时参数传入（默认 10s 不可用）
  - spec-tree diff 用例——构造双侧文件内容，断言 status 四分类（modified/local_only/platform_only/identical）、modified 的 diff_rows 对齐（equal/delete/insert + 双侧 lineno/text）、双侧均缺失剔除并计 dropped_paths、本地 truncated 无 content 的文件不出 diff_rows
  - containment 用例——daemon 回报含 .. 段或 resolve 落点越出 spec_root 的路径，按平台侧缺失处理且不发生读取（spec_workspace/service.py:1486-1504 同款范式）
  - 截断护栏用例——单文件 diff 超 5000 行置 diff_truncated；整响应超 2MB 置 response_truncated 并按文件倒序丢 diff_rows
  - progress 用例——白名单字段（当前阶段/阶段标签/步骤进度/最近活跃/ql_id/ghost）归一化为 progress_rows（label/local_value/platform_value/differ），本地缺失字段显式「—」，ql_id 透传
acceptance:
  - 全部新测试在当前代码上失败，失败原因仅为端点与 service 未实现，非测试自身错误
  - 用例覆盖 design §5 Phase 2 全部行为契约点（权限/白名单/504/四分类/diff 对齐/containment/双截断/dropped_paths/progress 归一化/ql_id）
  - ruff 检查通过，daemon 模块既有测试零回归
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_sillyspec_compare.py -q
  - cd backend && uv run ruff check app/modules/daemon/tests/test_sillyspec_compare.py
constraints:
  - 只写测试，不实现 sillyspec_compare.py 与 compare 端点（实现归 task-04）
  - 不改任何既有测试与生产代码；新增 mock 仅打在本变更新边界上
  - 测试兼容 Windows/Linux/macOS（用 tmp_path，不硬编码路径分隔符）
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
