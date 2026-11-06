---
id: task-05
title: 'backend notify 端点 cwd 落库（confirm + ready + schema 可选字段）+ 落库测试'
title_zh: 'backend notify 端点 cwd 落库（confirm + ready + schema 可选字段）+ 落库测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-11-06 23:03:28
priority: P0
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@v1, D-007@v1]
depends_on: [task-02]
allowed_paths:
  - backend/app/modules/daemon/router/notify.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/tests/test_session_reopen.py
target_files:
  - backend/app/modules/daemon/router/notify.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/tests/test_session_reopen.py
goal: >
  backend 两接收端点解析可选 cwd 键落库 agent_sessions.cwd——daemon 回报的数据落地侧；daemon 为目录真相源，异值以回报覆写。
implementation:
  - backend/app/modules/daemon/schema.py：SessionRuntimeRequest 加可选 cwd 字段（可选字符串缺省 None；confirm 与 mark-recovery-failed 共享模型，后者 OpenAPI 暴露该键按忽略处理——daemon 不发）；ready 端点新增可选 body 模型（同款可选 cwd 字段，Pydantic extra 容忍）
  - backend/app/modules/daemon/router/notify.py confirm_session_reconnected（:140）：解析 body.cwd，非空字符串才 UPDATE agent_sessions.cwd（daemon 覆写语义）；缺键/空串/None no-op；随端点既有事务提交，不影响 lease_id 防陈旧确认判定
  - backend/app/modules/daemon/router/notify.py notify_session_ready（:247-248）：加 `Optional[BodyModel] = None` 参数（老 daemon POST 空 body 得 None 零影响），同款非空落库/no-op 语义；响应 200+{"ok":true} 不动（hub-client 固定 JSON.parse）
  - 测试：非空 cwd 落库断言（session.cwd 更新）；缺键/空串 no-op（值不变）；ready 空 body 零影响；乱序并发（ready 与 confirm 先后到达）幂等无部分写（盲区 #2）；原样透传不归一化（盲区 #3）
acceptance:
  - 两端点非空 cwd 落库、缺键/空串 no-op 有测试覆盖
  - confirm 既有 lease 防陈旧确认与状态判定路径不受 cwd 字段影响
  - ready 端点老 daemon 空 body 兼容（盲区 #5）
  - 不新增 REST 端点（router 装饰器数不变，D-008 负向）
verify:
  - uv run --project backend pytest app/modules/daemon/tests/test_session_reopen.py -x -q
constraints:
  - 无 backend 侧 cwd 推导/分配逻辑（D-005 负向）——仅落 daemon 回报值
  - 不改 agent_sessions 表结构（无迁移）
  - 聚焦测试，禁跑全量
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
