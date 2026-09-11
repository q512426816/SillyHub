---
id: task-09
title: 'consensus sweeper loop and lifespan mount'
title_zh: '超时扫描循环与 main.py 挂载'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 22:17:10
priority: P0
depends_on: ['task-07']
blocks: []
requirement_ids: [FR-1.4, FR-3.1]
decision_ids: [D-004@v1, D-008@v1]
allowed_paths:
  - NEW:backend/app/modules/daemon/group/service/consensus.py
  - backend/app/main.py
  - NEW:backend/app/modules/daemon/tests/test_group_consensus.py
target_files:
  - NEW:backend/app/modules/daemon/group/service/consensus.py
  - backend/app/main.py
  - NEW:backend/app/modules/daemon/tests/test_group_consensus.py
provides: "consensus_sweeper_loop"
expects_from: "task-07 inject_converge_directive 与状态卡 helper"
goal: >
  超时兜底必收口：30s 常驻循环扫 status=open 且 deadline_at 过期任务，行锁逐个强制收口；main.py lifespan 挂载照 lease_expiry_sweeper 先例。
implementation:
  - "consensus.py consensus_sweeper_loop()：asyncio 常驻，30s 间隔查 status=open AND deadline_at<now，FOR UPDATE 行锁逐任务：未终态成员标 timeout；≥1 delivered→inject_converge_directive(timed_out=True)+status=timeout；0 delivered→aborted+状态卡终态"
  - "main.py lifespan：asyncio.create_task(consensus_sweeper_loop(), name=consensus-sweeper)，finally cancel+await gather（照 lease_expiry_sweeper 段先例，注释标变更名）"
  - "test_group_consensus.py 补超时用例：伪造过期任务→sweeper 单轮逻辑（抽可测函数或 monkeypatch 间隔）→状态与注入断言"
acceptance:
  - "过期任务被扫到且 0 delivered→aborted、≥1 delivered→timeout+超时版收口指令"
  - "未过期任务不受影响；行锁下并发双扫不重复注入（幂等复验）"
  - "应用启动日志出现 consensus_sweeper 挂载记录"
verify:
  - "cd backend && uv run ruff check app/modules/daemon/group/service/consensus.py app/main.py && uv run pytest -q --no-cov app/modules/daemon/tests/test_group_consensus.py"
constraints:
  - "循环只做超时兜底不接管正常推进"
  - "挂载形态与既有 sweeper 完全一致（不加开关）"
---

<!-- task-09: 超时扫描循环与 main.py 挂载（骨架由 taskcard CLI 预生成，主代理降级直填——环境无子代理） -->
