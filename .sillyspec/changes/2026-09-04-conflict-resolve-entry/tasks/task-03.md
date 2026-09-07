---
id: task-03
title: backend heartbeat command result persistence and machines view
title_zh: backend 心跳结果链路（新列 + 迁移 + 两态落库 + register 恒清 + 机器视图透出）
author: 'qinyi'
created_at: 2026-09-04 22:40:15
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/model.py
  - backend/app/modules/daemon/runtime/service.py
  - backend/migrations/versions/20260904223000_add_sillyspec_command_result.py
provides:
  - contract: DaemonHeartbeatSillySpecCommandResult
    fields: [action, change, strategy, state, exit_code, error, executed_at]
  - contract: MachineSillySpecCommandResultRead
    fields: [sillyspec_command_result]
expects_from:
  task-06:
    - contract: sillyspec_command_result
      needs: [action, change, strategy, state, exit_code, error, executed_at]
goal: >
  daemon 心跳携带的 sillyspec_command_result 在 backend 落库（两态语义）并经 GET /machines 机器视图透出，为前端回显与 task-02 端点共享 router.py 语境打基础。
implementation:
  - router.py 心跳 DTO 区新增 DaemonHeartbeatSillySpecCommandResult（七字段全宽松可选，风格照 DaemonHeartbeatSillySpecStatus）
  - model.py daemon_instances 新增 sillyspec_command_result JSON nullable 列（紧邻 sillyspec_status）
  - 新增 alembic 迁移 20260904223000_add_sillyspec_command_result（仅 ADD COLUMN，无回填）
  - runtime/service.py heartbeat_daemon 加同名参数，两态处理（对象整包直写 / 键不出现置 NULL，语义照 sillyspec_status 先例）；register 路径恒清（照既有 sillyspec_status 恒清先例）
  - _build_machine_read 组装 MachineSillySpecCommandResultRead 在 GET /machines 透出（落库形态零转换）
acceptance:
  - 心跳携带对象时 daemon_instances.sillyspec_command_result 整包写入七键
  - 心跳缺键时列置 NULL（不是保持旧值）
  - daemon register 后该列为 NULL（恒清）
  - GET /machines 响应含 sillyspec_command_result 读模型且形态与落库一致
  - alembic 迁移可 upgrade，仅加列无数据回填
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/daemon
constraints:
  - 两态语义是 D-004@v1 硬约束，禁止引入三态（缺键保持旧值）分支
  - 不改 sillyspec_status / sillyspec_update 既有通道行为
  - 行为测试归 task-04，本卡不写测试文件
  - 与 task-02 共享 router.py，本卡 W1 先行、task-02 W2 串行接续
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
