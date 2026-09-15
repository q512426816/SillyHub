---
id: task-07
title: 'backend 协议字段——PermissionRequestPayload.background_task: bool | None = None'
title_zh: 'backend 协议字段——PermissionRequestPayload.background_task: bool | None = None'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 16:45:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/protocol.py
target_files:
  - backend/app/modules/daemon/protocol.py
provides: [PermissionRequestPayload.background_task]
goal: >
  在 PermissionRequestPayload 增加 background_task: bool | None = None 协议字段，
  让 daemon 能标记后台任务发起的权限请求，缺省 None 兼容不发该字段的旧 daemon。
implementation:
  - "在 backend/app/modules/daemon/protocol.py 的 PermissionRequestPayload 字段区
    （dialog_payload 之后）新增 background_task: bool | None = None 字段，注释说明
    True=后台任务触发（FR-02 / D-001@v1）、缺省 None 时按普通前台请求处理。"
  - 不改动既有字段（session_id / run_id / request_id / tool_name / input /
    tool_use_id / dialog_kind / dialog_payload）及其类型与语义。
acceptance:
  - 不传 background_task 时 pydantic 校验通过且字段值为 None（旧 daemon 兼容）。
  - 传 True / False 时 pydantic 校验通过且值原样保留。
  - 既有字段解析行为不破坏，本 task 相关既有测试保持通过。
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_permissions.py -q --no-cov
constraints:
  - 注释与实现一致（CLAUDE.md 规则18）。
  - 不引入无关变更；只改 protocol.py 的 PermissionRequestPayload 字段区。
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
