---
id: task-03
title: 'backend compare: RPC workspace_id passthrough + member-check helper public'
title_zh: 'backend 对比腿透传与成员校验公开'
author: 'qinyi'
created_at: 2026-09-09 21:29:54
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/sillyspec_compare.py
  - backend/app/modules/daemon/tests/test_sillyspec_compare.py
target_files:
  - backend/app/modules/daemon/sillyspec_compare.py
  - backend/app/modules/daemon/tests/test_sillyspec_compare.py
provides:
  - contract: ensure_workspace_member(user_id, workspace_id, action)
    fields: [action]
goal: >
  backend 对比腿把 workspace_id 透传进 daemon RPC params，并把 workspace 成员
  校验方法公开（可选 action 参数）供 resolve 端点复用。
implementation:
  - SillySpecCompareService.compare() 与 _fetch_snapshot 增加 workspace_id 形参；send_rpc params 变为 {change, kind, workspace_id: str(workspace_id)}
  - _ensure_workspace_member 改名 ensure_workspace_member 公开；签名加 action: str = "查看"；PermissionDenied 文案改 f"仅工作区成员可{action}该冲突对比。"（compare 调用点不传 action → 文案不变）
  - 更新 test_sillyspec_compare.py：新增 ① RPC params 断言含 workspace_id（mock hub.send_rpc 捕获）② ensure_workspace_member(action=...) 文案分叉单测 ③ compare 既有用例回归
acceptance:
  - RPC params 携带 workspace_id（测试断言 mock 捕获的 params）
  - compare 路径 403 文案不变（回归）；action 参数可定制文案
  - pytest 相关用例全绿
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_sillyspec_compare.py -q --no-cov
constraints:
  - 不改 compare 编排顺序（成员校验 → 平台侧定位 → RPC，ql-20260909-012 顺序化结论不动）
  - 错误文案中文（test_error_message_l10n 守护）
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
