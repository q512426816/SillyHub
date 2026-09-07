---
id: task-15
title: '集成验收——10s 可见性/裸会话自发现/R-01 空闲无通知/R-02 崩溃隔离/E-03 轮转恢复/长任务不抢跑'
title_zh: '集成验收——10s 可见性/裸会话自发现/R-01 空闲无通知/R-02 崩溃隔离/E-03 轮转恢复/长任务不抢跑'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: ['task-05', 'task-06', 'task-09', 'task-10', 'task-11', 'task-12', 'task-13', 'task-14']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/agent/mcp_tools.py
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  全链路集成验收（不改产品代码）：对照 plan.md 全局验收标准把验收场景清单化逐项实测——
  10s 可见性、裸会话自发现、R-01/R-02 回归、E-03 轮转恢复、blocked 升级非 kill、
  长任务不抢跑、旧落库行 unknown——结果留档供 verify 阶段引用。
implementation:
  - 场景 A（10s 可见性，FR-01/03）：派发一个 zcode 会话，观察平台会话视图在 10s 内出状态（tailer 10s 周期 → POST /agent-logs/states → 前端展示），记录时间线
  - 场景 B（自发现回归，FR-02）：开一个全程不调 sillyspec 的裸 agent 会话（codex 或 claude 裸 CLI），确认 10s 内被自发现并以 origin=liveness-discovered 建行出状态
  - 场景 C（R-01 回归，FR-04）：空闲会话静置超 15 分钟，确认不产生任何 agent_blocked 通知（blocked 绝不以"没动静"推断）
  - 场景 D（R-02 回归，FR-01）：人为停用/搞崩 tailer（如 kill 掉 liveness 定时任务），确认 read_agent_log_messages 与 CLI 登记链路不受影响（fail-open）
  - 场景 E（E-03 轮转，FR-01）：zcode 会话触发上下文压缩换文件后，确认 tailer 经 offset reset + 窗口重扫恢复跟踪，不串台到他会话
  - 场景 F（P1e，FR-06）：worker 卡权限确认 → list_workers 可见 blocked 且走升级（通知+待办）而非 kill；长任务（日志持续增长）不被抢跑 kill
  - 场景 G（兼容，FR-03/05）：迁移前的旧落库行（state 列为空）在前端显示 unknown，既有功能不变
  - 汇总：每场景记录实测结果（时间线/截图/日志摘录）与全局验收标准 1-5 的对照结论，留给 verify 阶段引用
acceptance:
  - 场景 A/B：zcode 会话与裸 agent 会话均在派发/启动后 10s 内出状态（有实测时间线佐证）
  - 场景 C：空闲会话零 agent_blocked 通知；场景 D：tailer 停用后登记与对话视图链路正常
  - 场景 E：轮转后状态恢复且 session 归属不串台；场景 F：blocked 升级非 kill、长任务不被抢跑
  - 场景 G：旧落库行显示 unknown；CLI 上报契约零变更（既有登记回归通过）
  - plan.md 全局验收标准 1-5 逐项有"通过/不通过+证据"记录
verify:
  - cd sillyhub-daemon && pnpm test tests/agent-log/liveness
  - cd backend && uv run pytest app/modules/platform_sync/tests -x -q --no-cov
  - cd frontend && pnpm gen:types && pnpm typecheck
  - 场景 A-G 手工实测逐项执行并留档（对照 plan.md 全局验收标准；结果回填 verify 报告）
constraints:
  - 不改产品代码，只验证与记录；发现缺陷另开 task/quick 修复，不在本卡顺手改
  - 本项目未正式上线，测试数据可重置（CLAUDE.md 规则 11）；在 Windows 本机执行（顺带观察 E-04 文件共享冲突表现）
  - 单测/迁移/类型门禁仅复跑与本变更相关者，不跑全量（CLAUDE.md 规则 0，全量留 CI）
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
