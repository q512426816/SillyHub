---
id: task-06
title: 'backend 心跳 upsert（保留 since/无字段清除）+ machines 与 runtimes/page 透出（depends_on: task-02）'
title_zh: 'backend 心跳 upsert（保留 since/无字段清除）+ machines 与 runtimes/page 透出（depends_on: task-02）'
author: 'qinyi'
created_at: 2026-08-29 15:04:03
priority: P0
depends_on: [task-02]
blocks: [task-07, task-08]
requirement_ids: [FR-04]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/tests/test_pending_update_upsert.py
expects_from:
  task-02:
    - contract: PendingUpdateColumn
      needs: [pending_update]
goal: >
  backend 心跳端点接收可选 pending_update 并 upsert daemon_instances.pending_update（同内容保留原 since、无字段置 NULL），经 /machines 与 /runtimes/page 机器级透出（含 since，nullable），打通 FR-04 服务端链路。
implementation:
  - router.py 心跳请求内联 DTO（DaemonHeartbeatRequest）加可选 pending_update 嵌套模型——reason/current_version/target_version 三字段，缺省 None 兼容旧 daemon
  - service.py heartbeat_daemon 加 pending_update 可选参数与 upsert——已有同内容（reason+两版本一致）保留原 since 不退化；首次落库或内容变化盖 since=now 重写 JSON
  - 心跳无该字段置 NULL 清除——与兄弟字段 daemon_version/build_id「非空才覆盖」语义相反，代码注释注明刻意为之（单机单 daemon 无新旧进程交错，靠无字段显式清除才收敛）
  - router.py /machines 响应组装 _build_machine_read（约 :537）加 pending_update=instance.pending_update（含 since，nullable）
  - router.py /runtimes/page 机器级注入——照 _runtime_read 的 instance 版本字段注入先例（约 :526-531）挂 pending_update
  - 新增 tests/test_pending_update_upsert.py——upsert 保留 since/内容变化刷新/无字段置 NULL/两端点透出四组断言
acceptance:
  - 心跳带 pending_update 首次落库 since=now；同内容重复心跳 since 保持不变（不退化为最后心跳时间）
  - reason/current_version/target_version 任一变化时整对象与 since 刷新
  - 心跳无该字段置 NULL 清除（旧 daemon 不带字段即走清除路径）
  - GET /machines 与 GET /runtimes/page 响应均含 pending_update 字段（含 since，无 pending 时为 null）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_pending_update_upsert.py -q --no-cov && uv run mypy app
provides:
  - contract: MachinePendingUpdateView
    fields: [pending_update]
constraints:
  - 不改 model.py/不加迁移（pending_update 列归 task-02，本卡仅消费）；openapi.json 再导出与三端 gen:types 归 task-08
  - 置 NULL 反向语义必须代码注释锚定 D-004@v1，防后续被「对齐兄弟字段非空才覆盖」误改
  - 不动心跳响应体 DaemonHeartbeatResponse（pending_update 仅请求方向+机器视图方向）
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
