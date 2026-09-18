---
id: task-05
title: 'backend 单聊忙轮改 busy_strategy=inject + provider 能力门控（router/session_crud.py；SessionInjectResponse 加 steered 映射 mid_turn）'
title_zh: 'backend 单聊忙轮改 busy_strategy=inject + provider 能力门控（router/session_crud.py；SessionInjectResponse 加 steered 映射 mid_turn）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 00:36:51
priority: P0
depends_on: ['task-01']
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-002@v1]
blocks: [task-07, task-09]
allowed_paths:
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/session/service/inject.py
  - backend/app/modules/daemon/session/service/__init__.py
  - backend/app/modules/daemon/service.py
target_files:
  - backend/app/modules/daemon/router/session_crud.py
goal: >
  单聊忙轮普通消息由 queue_when_busy 排队改为 busy_strategy=inject 引导注入活跃轮（provider 能力门控降级），
  响应 DTO 加 steered 映射 result.mid_turn，供 task-07 前端「引导中」态消费（FR-01/FR-02）。
implementation:
  - 'router/session_crud.py:605 忙轮分支 queue_when_busy=True 改为 busy_strategy="inject"（service 既有 Literal["queue","inject"] 形参 inject.py:279；复用群聊 _inject_mid_turn_into_run 链路 control.py:92，mid_turn 端到端自动可用）'
  - '同文件能力门控：经 svc.get_agent_session(session_id, user.id)（read_model.py:227 只读无锁先例）取 session.provider，get_provider_caps(provider)["steering"]（compact.py:103 同款门控先例）为 False（cursor/未知 provider）时维持 queue_when_busy=True 排队现状，不报错'
  - 'SessionInjectResponse（router/session_crud.py:83 本地 DTO）加 steered: bool = False 字段，响应构造处映射 steered=result.mid_turn（results.py:39 既有字段）；带切换维度消息不进 inject 分支——既有守卫（queue.py:76-99）零改动'
acceptance:
  - '支持 provider（pi/claude/codex）忙轮发普通消息（不带切换维度）→ 不建新 run、不 interrupt，响应 steered=true 且 queued=false，user_input 留痕挂活跃 run（FR-01）'
  - '不支持 provider（cursor/未知）忙轮 → 维持排队现状：queued=true、queue_entry_id 非空、steered=false，不报错（降级分支，FR-02）'
  - '带切换维度（agent_profile/provider/model 任一）忙轮消息既有排队/409 语义零回归；服务身份 409 语义零回归'
  - '既有 test_session_queue.py 忙轮用例（service 层直调 queue_when_busy，如 test_busy_inject_queues_instead_of_409）零回归通过'
verify:
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/daemon/tests/test_session_queue.py -k busy
constraints:
  - '复用既有 mid_turn 字段（results.py:39），不新建平行 steered 服务层字段；steered 仅 router 层 DTO 映射'
  - '能力门控用生成镜像 get_provider_caps（task-01 产出），不新建手维护常量；未知 provider 默认 false'
  - '带切换维度排队/409 与服务身份 409 语义零回归；禁跑全量测试'
  - '改动仅限 router/session_crud.py；三分支新用例与测试文件改动归 task-09，本任务不写测试文件'
expects_from:
  task-01:
    - contract: provider_caps steering 键
      needs: [PROVIDER_CAPS steering 第 14 键, get_provider_caps 未知 provider 默认 false 语义]
provides:
  - contract: SessionInjectResponse.steered
    fields: [steered 布尔（映射 result.mid_turn；消费方 task-07）]
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
