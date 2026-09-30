---
id: task-04
title: 'takeover service core with 4-tier matching and fork creation'
title_zh: 'takeover 服务核心：四级匹配 + fork 分叉落库 + native resume + DTO/端点'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-30 11:07:12
priority: P0
depends_on: [task-03]
blocks: [task-05, task-06, task-07]
requirement_ids: [FR-02, FR-03]
decision_ids: [D-001@v1, D-002@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service/takeover.py
  - backend/app/modules/daemon/session/service/fork.py
  - backend/app/modules/daemon/session/service/create.py
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/tests/
target_files:
  - NEW:backend/app/modules/daemon/session/service/takeover.py
  - backend/app/modules/daemon/session/service/fork.py
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/schema.py
  - NEW:backend/app/modules/daemon/tests/test_takeover.py
provides:
  - contract: TakeoverResponse
    fields: [session_id, run_id, tier, handoff_doc]
expects_from:
  task-03:
    - contract: reported machine identity persistence
      needs: [latest_reported_machine, reported_machine_id, reported_machine_name]
goal: >
  新建 takeover 服务与端点：原机四级钉定匹配（machineId→hostname→allowed_roots 唯一→409）、经 create 链 fork 三件套分叉落库（源会话只读）、native 档 lease 携带 resume_session_id（FR-02/FR-03，D-006@v1）。
implementation:
  - takeover.py 实现 resolve_takeover_runtime 四级匹配（读 config_snapshot.latest_reported_machine 与最新 entry 兜底；匹配 daemon_runtimes 在线行 + allowed_roots 前缀判定用 file-rpc 同款 containment 口径；多台/零台 raise ToolReportTakeoverNoMachine 409 中文含机器名）
  - 从 fork.py 抽取可复用段（fork 三件套写入/快照继承/源机钉定）为 takeover 调用；不改变既有 fork 端点行为与签名
  - takeover_session 主流程：会话校验（origin=tool_report、status=pending、属主）→ 四级匹配 → 分档（harness ∈ 可 resume 集合走 native：provider 沿用会话、lease metadata 写 resume_session_id=platform_agent_logs.session_id；handoff 档本卡留桩位 return tier='handoff' 交 task-05 填充）→ create_session 链落 fork 形态新会话（origin='fork'+fork_of_session_id，零 run 源 fork_at_run_id/engine_fork_anchor 传 NULL）
  - session_crud.py 新增 POST /sessions/{id}/takeover 路由；schema.py 加 TakeoverRequest/TakeoverResponse DTO（prompt 必填、provider/agent_profile_id/llm_provider_id 可选）
  - test_takeover.py 核心用例：四级匹配各级命中/零台/多台、源会话零写 active、fork 三件套落库（NULL 锚点形态）、native 档 resume_session_id 进 lease metadata、非 pending 会话 409
acceptance:
  - 四级匹配语义逐级可测（①精确 ②hostname 唯一在线 ③allowed_roots 唯一 ④409 含机器名中文文案，MUST NOT 静默换机）
  - takeover 成功后源会话 status/turn_count/lease/runtime 不变；新会话 origin='fork' 且 fork_of_session_id=源会话
  - native 档 lease metadata 含 resume_session_id；handoff 档返回桩位 tier='handoff'
  - daemon tests 相关用例通过
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_takeover.py -q --no-cov
constraints:
  - 源会话任何路径禁止写 active/lease/runtime（D-006 红线）
  - 不改既有 fork 端点行为；create.py 改动仅限支持 fork 三件套 NULL 形态透传
  - 409 错误文案中文含机器名与开机/装 daemon 指引
  - 并发双 takeover 不加锁（R-08 接受冗余，plan 已登记）
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
