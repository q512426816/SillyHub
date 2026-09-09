---
id: task-03
title: 'cursor-events.ts normalizer + fixture-driven golden test'
title_zh: 'cursor-events.ts 归一化器 + cursor-events.test.ts golden 测试（fixture 驱动）'
author: 'qinyi'
created_at: 2026-09-08 13:00:34
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-001@v1]
expects_from:
  task-01:
    - contract: CursorStreamJsonFixtures
      needs: [fixtures_ndjson, session_id_source, result_frame_shape, resume_semantics]
allowed_paths:
  - sillyhub-daemon/src/interactive/cursor-events.ts
  - sillyhub-daemon/tests/interactive/cursor-events.test.ts
target_files:
  - NEW:sillyhub-daemon/src/interactive/cursor-events.ts
  - NEW:sillyhub-daemon/tests/interactive/cursor-events.test.ts
goal: >
  新建 cursor-events.ts 归一化器——导出无状态纯函数
  normalizeCursorFrame(frame: unknown): AgentEvent[]，按 design「总体方案 Wave 1」
  映射表把 cursor stream-json 帧（claude stream-json 同构子集）映射为 AgentEvent v2，
  每条产出过 safeParseAgentEvent；并用 task-01 落盘的真实帧 fixture
  （tests/fixtures/cursor/*.ndjson）写 golden 测试逐字段断言，为 task-04
  CursorDriver 提供逐帧归一化契约（chatId/跨帧状态归 driver，本归一化器零状态）。
implementation:
  - 新建 src/interactive/cursor-events.ts：导出 normalizeCursorFrame（入参 frame 宽收 unknown，返回 0..N 条 AgentEvent）——无状态纯函数（codex toAgentEvent 无状态映射表 + pi-events 纯函数先例）；文件头 docblock 中文标注映射表（design Wave 1 表逐行）与帧形状依据（task-01 实测记录 / fixture 锚点）
  - 映射表实现（逐行对应 design Wave 1 实测修正版映射表，帧形状依据 spike-cursor-frames.md + fixture）——system/init 帧 → status + subtype='session_started'，session_id 一等字段携带；**user 回显帧 → 忽略（返回 []，cursor 每轮回显用户 prompt，透传会重复渲染）**；assistant message content 文本块（实测仅 {type:text,text}） → text 完整事件；**thinking 顶层帧** subtype=delta → thinking（is_partial+segment_id 流式，segment 计数归 driver 或本函数内自增参数——若需跨帧计数则提供 normalizeCursorFrame(frame, ctx?) 重载，ctx 由 driver 持有，保持本函数可无状态调用）、subtype=completed → 返回 []（吸收）；**tool_call 顶层帧** subtype=started → tool_use（tool_name 取 tool_call 判别联合键如 shellToolCall，原生保留不重命名；call_id 配对）、subtype=completed → tool_result（result.success.stdout/stderr 进 content，exitCode/executionTime 进 metadata）；**connection/retry 传输帧 → 忽略（返回 []）**；result 帧 → turn_result + usage 四字段短名映射（**cursor 侧 camelCase：inputTokens→input_tokens / outputTokens→output_tokens / cacheReadTokens→cache_read_tokens / cacheWriteTokens→cache_creation_tokens**；非 number 字段不设值不伪造 0）+ session_id
  - 未知帧型降级桶（fail-safe 不丢不抛）——status + subtype='task_notification' + metadata.original_event_type 保留原 type（codex toAgentEvent #9 同款——schema superRefine 强制 status 必带闭合枚举 subtype，task_notification 走瞬时通道不污染持久化）；坏 JSON / 非对象 / 缺字段 → 返回 [] 不抛（入口防御守卫，畸形行 warn 归 driver 层）
  - 新建 tests/interactive/cursor-events.test.ts golden 测试——用 task-01 的 tests/fixtures/cursor/*.ndjson 真实样本（tests/helpers loadLines，pi-events.test.ts 同款加载手法）逐帧喂 normalizeCursorFrame，按映射表逐字段断言：system/init → session_started + session_id；assistant 文本 → text；thinking delta → thinking(is_partial)；tool_call started/completed → tool_use/tool_result（call_id 配对、stdout/stderr 进 content）；result → turn_result + usage camelCase→短名映射 + session_id；user 回显帧/connection/retry → 忽略（[]）；未知帧 → 降级桶 + metadata.original_event_type 保留原值（可手工构造一帧未类型验证）
  - golden 断言补充——全部产出事件逐条 safeParseAgentEvent 通过（失败打印 issues 定位，pi-events.test.ts expectValid 同款）；type='status' 恒带 subtype；畸形输入（坏 JSON / 非对象 / 缺字段）不抛且空产出
acceptance:
  - normalizeCursorFrame 为无状态纯函数导出，映射表七类分支（system/init、assistant 文本、thinking、tool_use、tool_result、result、未知降级）全部落地且与 design Wave 1 表逐行一致（FR-03）
  - golden 测试由真实 fixture 驱动且逐字段断言全绿；全部产出过 safeParseAgentEvent；type='status' 恒带 subtype；未知帧不丢弃不抛错（metadata.original_event_type 保留原值）
  - usage 五字段短名与 AgentEventUsage 对齐；tool_use/tool_result 的 tool_name/call_id 原生保留不重命名
verify:
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/cursor-events.test.ts
  - pnpm -C sillyhub-daemon run typecheck
constraints:
  - 不改 types.ts / agent-event-schema.ts——契约不够用（如需新 subtype 枚举值）停下报告，不得自行扩 schema
  - 不动批量 adapters/（stream-json.ts cursor 分支仅作映射依据锚点，零修改）；不实现 stderr→error 嗅探（driver 层职责归 task-04）
  - ESM import 带 .js 后缀；不引新依赖；注释中文标注映射依据
  - fixture 文件由 task-01 产出，本 task 只读不改；若 fixture 与映射表假设不符，按 task-01 实测记录修正映射并回注依据，不迁就坏假设
provides:
  - contract: normalizeCursorFrame
    fields: [normalizeCursorFrame]
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
