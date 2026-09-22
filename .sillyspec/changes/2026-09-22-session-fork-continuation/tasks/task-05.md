---
id: task-05
title: 'backend fork 服务与契约——fork.py（校验/native·seed 分派/种子体积帽/快照继承）+POST fork 端点+DTO+SessionRead 透出+placement metadata+claim 白名单+gen:types+pytest（depends_on: task-01, task-03）'
title_zh: 'backend fork 服务与契约——fork.py（校验/native·seed 分派/种子体积帽/快照继承）+POST fork 端点+DTO+SessionRead 透出+placement metadata+claim 白名单+gen:types+pytest（depends_on: task-01, task-03）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-22 20:33:49
priority: P0
depends_on: ['task-01', 'task-03']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-001@v1, D-005@v1, D-007@v1]
provides:
  - POST /api/daemon/sessions/{id}/fork（SessionForkRequest/Response，含 tier 出参）
  - lease.metadata fork 四键（D-012：resume_at_uuid/fork_session/fork_anchor_entry_id/fork_mode，daemon execPayload 消费）
  - SessionRead 增 fork_of_session_id/fork_at_run_id/engine_fork_anchor 透出
allowed_paths:
  - backend/app/modules/daemon/session/service/fork.py
  - backend/app/modules/daemon/session/service/create.py
  - backend/app/modules/daemon/session/service/__init__.py
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/daemon/lease/context.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - backend/app/modules/daemon/tests/test_session_fork.py
  - backend/app/modules/daemon/router/__init__.py
target_files:
  - NEW:backend/app/modules/daemon/session/service/fork.py
  - backend/app/modules/daemon/session/service/create.py
  - backend/app/modules/daemon/session/service/__init__.py
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/agent/placement.py
  - backend/app/modules/daemon/lease/context.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - NEW:backend/app/modules/daemon/tests/test_session_fork.py
goal: >
  backend 侧 fork 全链：fork 点四重校验→native（metadata 两键下行）/seed（前情转述种子 24K 帽）分派→fork 记录+快照继承落库→端点与 DTO→gen:types；A 零字段改动。
implementation:
  - 新建 fork.py：fork_session（归属/终态/caps 档≠none/native 锚点存在四重校验；按 D-012 定 fork_mode——claude：at_run.engine_anchor 有→mode=resume_at（resume_at_uuid=该值）、无→422；pi：at_run 下一轮 engine_anchor 有→mode=rpc_fork（fork_anchor_entry_id=该值）、at_run 为末轮→mode=clone；codex seed→不写 fork 键；seed 档→build_seed_prompt 读截至轮 logs 用户轮全文+助手轮摘要 FORK_SEED_MAX_CHARS=24000 截尾声明）+ create_session 调用（origin='fork'、fork 三件套、workspace/供应商/模型/档案快照继承，不写 parent_session_id）
  - create.py 增 fork 参数组（缺省走原路径零回归）；service/__init__.py re-export
  - session_crud.py 增 POST /sessions/{id}/fork 端点（404/409/422 错误语义按 design 接口定义；pi rpc_fork 源会话不可达→4xx 文案提示）；schema.py 增 SessionForkRequest/Response + SessionRead 透出 fork 三字段
  - placement.py 写 lease.metadata 增 fork 四键（D-012，按 mode 只写相关键）；backend/app/modules/daemon/lease/context.py:459 build_claim_payload interactive 白名单透传四键（Grill B-1 断链点，漏此环节 native 档静默失效）
  - pnpm gen:types 同步 openapi.json+api-types.ts（先确认前端 node_modules 健康）
  - 新建 test_session_fork.py：四重校验矩阵/native·seed 分派/种子帽/A 零字段改动断言/快照继承
acceptance:
  - fork 成功后 B 行含 origin='fork'+fork 三件套+快照四维继承；A 全字段与 fork 前逐字段一致
  - seed 种子含截尾声明且 ≤ 帽；native metadata 两键经白名单进 claim payload（单测断言 context.py 组装）
  - 错误矩阵 404/409/422 各有断言；未分叉路径零回归
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_fork.py -q --no-cov
  - cd backend && uv run ruff check app/modules/daemon app/modules/agent/placement.py && uv run mypy app --no-error-summary 2>&1 | tail -1
constraints:
  - 无新 WS 协议消息（沿既有 lease 认领链）
  - api-types.ts 必须由 gen:types 生成禁手写；产物随变更提交
  - 事务内建 B 行，任一校验失败整体回滚不留半行
  - 禁跑全量测试
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
