---
id: task-01
title: 'F2a wire event timestamps - daemon types/event-wire per-message timestamp capture (incl. SSE sync) + backend submit_steps prefer msg timestamp (fallback st.now on missing/invalid/skew>5min) + dual-side tests'
title_zh: 'F2a wire 事件时间戳——daemon types/event-wire 补 timestamp 捕获（含 SSE 同步）+ backend submit_steps 优先取值（钟差>5min/非法回落 st.now）+ 双端测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-12 21:01:59
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-004@v1]
allowed_paths:
  - sillyhub-daemon/src/types.ts
  - sillyhub-daemon/src/event-wire.ts
  - sillyhub-daemon/tests/event-wire.test.ts
  - sillyhub-daemon/tests/task-runner.test.ts
  - backend/app/modules/daemon/run_sync/service/submit_steps.py
  - NEW:sillyhub-daemon/tests/event-wire-timestamp.test.ts
  - NEW:backend/app/modules/daemon/tests/test_run_sync_submit_timestamp.py
target_files:
  - sillyhub-daemon/src/types.ts
  - sillyhub-daemon/src/event-wire.ts
  - sillyhub-daemon/tests/event-wire.test.ts
  - sillyhub-daemon/tests/task-runner.test.ts
  - backend/app/modules/daemon/run_sync/service/submit_steps.py
  - NEW:sillyhub-daemon/tests/event-wire-timestamp.test.ts
  - NEW:backend/app/modules/daemon/tests/test_run_sync_submit_timestamp.py
related_tests: [sillyhub-daemon/tests/event-wire.test.ts, sillyhub-daemon/tests/task-runner.test.ts]
goal: >
  让日志行时间戳反映事件发生时刻：wire 消息对象增加事件到达时刻的 ISO-8601
  timestamp，backend 落库与 SSE 推送优先取该值（缺省/非法/钟差>5min 回落 st.now），
  消除生产会话 47e2ff1a 实证的「同一毫秒 8~31 行聚集」（根因 submit_steps.py
  整批共享单值 st.now）。
implementation:
  - ①sillyhub-daemon/src/types.ts:706 LeaseMessage（submit_messages 单条消息结构）增加可选 timestamp 字段（ISO-8601 字符串，缺省=旧行为）
  - ②sillyhub-daemon/src/event-wire.ts 各消息构造点按事件 new Date().toISOString() 捕获事件到达时刻（非整批转换时刻），注入两轨消息 dict——事件轨 eventToReportWireDict（:77）与渲染轨 eventToSubmitMessages（:132，各 case push 处，含 :149-156 流式分支、:214 tool_use 双行、:222 decline 分支）；:285 现有 tool_call JSON 内嵌 ts 属 content 内嵌值，不替代消息级字段
  - ③backend/app/modules/daemon/run_sync/service/submit_steps.py:569 AgentRunLog timestamp 改为优先解析 msg["timestamp"]（:95 st.now 为单次 submit 整批共享单值，即塌缩根因）；缺省/解析非法/与本地钟差>5min 回落 st.now（防 daemon 时钟漂移污染时间线）
  - ④submit_steps.py:605 区 st.published_logs SSE 推送携带与对应落库行相同的解析后时间戳；:286/:338/:673/:739 同类推送口径一并核对，避免同批两种钟源
  - ⑤新增 NEW:sillyhub-daemon/tests/event-wire-timestamp.test.ts（消息级 timestamp 逐事件在场且互异；缺省不写字段零回归）+ NEW:backend/app/modules/daemon/tests/test_run_sync_submit_timestamp.py（submit_messages via svc 调用模式，先例 backend/app/modules/daemon/tests/test_subagent_log_attribution.py:216）
acceptance:
  - N≥3 条携带互异 timestamp 的消息经 submit_messages 落库后，agent_run_logs 各行 timestamp 与对应消息 timestamp 一致，不再整批同值（FR-02 场景·批量提交时间戳分散）
  - 消息无 timestamp 字段时落库 timestamp=st.now 且无异常，行为与现状完全一致（FR-02 场景·向后兼容）
  - 伪造时戳与本地钟差 6min 的消息落库回落 st.now；SSE published_logs 推送 timestamp 与对应落库行一致
verify:
  - cd sillyhub-daemon && pnpm test -- tests/event-wire.test.ts tests/event-wire-timestamp.test.ts
  - cd backend && uv run pytest app/modules/daemon/tests/test_run_sync_submit_timestamp.py -q --no-cov
constraints:
  - wire timestamp 为可选字段，旧版 daemon 不带时 backend 行为与现状逐字节一致，不收紧 payload 校验
  - 不改 agent_run_logs 表结构 / AgentRunLog 模型字段 / SSE payload 键名（零 migration，前端零适配）
  - 规则 0：只跑 verify 列相关测试，不跑全量套件
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
