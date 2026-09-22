---
id: task-04
title: 'backend resolve contract: required workspace_id + WS payload + member check'
title_zh: 'backend 裁决契约与成员校验'
author: 'qinyi'
created_at: 2026-09-09 21:29:54
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-01, FR-05]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/router/machines.py
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/daemon/tests/test_sillyspec_platform_commands.py
target_files:
  - backend/app/modules/daemon/router/machines.py
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/daemon/tests/test_sillyspec_platform_commands.py
expects_from:
  task-03:
    - contract: ensure_workspace_member(user_id, workspace_id, action)
      needs: [action]
provides:
  - contract: MachineSillySpecResolveRequest
    fields: [change, strategy, workspace_id]
goal: >
  backend 裁决契约补 workspace_id：REST 请求体必填、WS payload 透传、端点
  workspace 成员校验——写操作防越权。
implementation:
  - MachineSillySpecResolveRequest 加必填 workspace_id: uuid.UUID（pydantic 校验，缺省 422）
  - ws_hub.send_sillyspec_resolve(daemon_id, change, strategy, workspace_id)；payload 加 workspace_id（str 化）
  - 端点 trigger_machine_sillyspec_resolve：实例化 SillySpecCompareService 调 ensure_workspace_member(user.id, data.workspace_id, action="对...下发裁决"语义文案)；透传 hub；docstring 更新成员校验说明
  - 更新 test_sillyspec_platform_commands.py：新增 ① 请求体缺 workspace_id → 422 ② 非成员 → 403（文案含「下发裁决」动作词）③ 成员 → payload 透传 workspace_id 断言 ④ owner/平台管理员机器归属校验回归
acceptance:
  - 请求体缺 workspace_id → 422；非 workspace 成员 → 403 PermissionDenied
  - WS payload 携带 workspace_id（测试断言）
  - 机器归属校验（_get_owned_instance）行为不变（回归）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_sillyspec_platform_commands.py -q --no-cov
constraints:
  - fire-and-forget 语义不变（无回执、不排队、不落库）
  - 成员校验复用 task-03 公开方法，不复制查询逻辑
  - 错误文案中文
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
