---
id: task-02
title: 'change/binding.py 绑定基座 + tool_kind 分段提取（default 守卫/解析规则/幂等绑定）'
title_zh: 'change/binding.py 绑定基座 + tool_kind 分段提取（default 守卫/解析规则/幂等绑定）'
author: 'qinyi'
created_at: 2026-08-25 22:54:07
priority: P0
depends_on: ['task-01']
blocks: [task-05, task-06, task-08]
requirement_ids: [FR-01]
decision_ids: [D-003@v1, D-004@v1, D-005@v2]
allowed_paths:
  - backend/app/modules/change/binding.py
  - backend/app/modules/agent/tool_kind.py
  - backend/tests/modules/agent/test_tool_kind.py
  - backend/app/modules/change/tests/test_spec_binding.py
expects_from:
  task-01:
    - contract: QuicklogSessionLink
      needs: [workspace_id, ql_id, session_id]
provides:
  - contract: SpecCommandBinding
    fields: [kind, change_key]
  - contract: SpecBindingFunctions
    fields: [iter_command_segments, extract_spec_bindings, bind_session_to_change, bind_session_to_quicklog]
goal: >
  建立 change/binding.py 绑定基座（命令解析出变更绑定目标 + 两幂等 best-effort bind 函数，
  default 伪键在 bind 内统一守卫 D-005@v2）并从 _is_sillyspec_command 提取公共
  iter_command_segments（行为不变），供 task-05/06/08 检测写入口复用（FR-01）。
implementation:
  - agent/tool_kind.py 把 _is_sillyspec_command 内部「&&/;/| 分段 + 剥 pnpm/npx/yarn/sudo/node 包装」
    逻辑提为公共 iter_command_segments(command)，_is_sillyspec_command 改为消费该函数且行为零变化
    （test_tool_kind.py 既有共享用例锁行为，daemon 侧 tool-kind.ts 零改动）
  - 新建 change/binding.py 定义 frozen dataclass SpecCommandBinding（kind 取值 change + change_key），
    quick 不经命令解析通道产出（ql_id 此刻未知，D-004@v1）
  - extract_spec_bindings 规则为 quick 子命令无产出（其 --change 是 CLI quick 会话 id）、其他 run
    阶段支持「--change 名」空格与「--change=名」等号两形式、名为 default 跳过、progress/status/archive
    等其余子命令无产出、复合命令多段逐一判定、剥包装后判定
  - bind_session_to_change 内 change_key 等于 default 直接返回（D-005@v2 双通道统一生效）；按
    workspace_id+change_key 查 Change 不存在建 placeholder（对齐 _ensure_change_row defaults，
    status=draft、location=active、path=changes/<名>）；upsert ChangeSessionLink 唯一约束幂等
  - bind_session_to_quicklog 直接 upsert QuicklogSessionLink，无需 quicklog_entries 行存在（D-001@v1
    到达顺序不保证，先绑后补条目合法）
  - 两 bind 均 savepoint（begin_nested）best-effort，失败仅 log.warning 不抛（对齐
    _bind_change_to_session 既有风格）
  - 新建 test_spec_binding.py 覆盖解析样例库（空格/等号、quick 不产出、default 跳过、复合命令多段、
    包装前缀、grep sillyspec 误归不产出）+ bind 幂等 + default 不建 placeholder + 无条目行先绑
acceptance:
  - iter_command_segments 提取后 test_tool_kind.py 全绿（行为零变化）
  - 解析样例库全部命中预期（quick/default/非 run 子命令/误归样例均无产出）
  - bind_session_to_change 重复调用不重复建行；default 不建 placeholder 也不建 link；失败仅告警不抛
verify:
  - cd backend && uv run pytest app/modules/change/tests/test_spec_binding.py -q
  - cd backend && uv run pytest tests/modules/agent/test_tool_kind.py -q
constraints:
  - 不接线任何调用方（run_sync/platform_sync/创建落绑定归 task-05/06/08）
  - bind 签名按 design §7（async、db AsyncSession 首参），不引入额外依赖方
  - 不改 ChangeSessionLink/QuicklogSessionLink 表结构（消费 task-01 契约）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
