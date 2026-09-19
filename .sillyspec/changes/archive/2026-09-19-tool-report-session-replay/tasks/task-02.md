---
id: task-02
title: 'zcode 文件解析器补字段（顶层 turnId/model/durationMs + response.usage 附着 + task-notification/system-reminder → system_event）+ totalUsage 累计；连带更新 tests/agent-log 既有形状断言'
title_zh: 'zcode 文件解析器补字段（顶层 turnId/model/durationMs + response.usage 附着 + task-notification/system-reminder → system_event）+ totalUsage 累计；连带更新 tests/agent-log 既有形状断言'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 21:03:54
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-003@v1, D-004@v1, D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts
  - sillyhub-daemon/tests/agent-log/
target_files:
  - sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts
  - sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts
expects_from:
  task-01:
    - contract: NormalizedLogMessage
      needs: [sender, turn_id, model, duration_ms, usage]
    - contract: AgentLogMessagesResult
      needs: [totalUsage]
related_tests:
  - sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts
  - sillyhub-daemon/tests/agent-log/read-agent-log-messages.test.ts
goal: >
  zcode 文件解析器（sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts:147 parseZcodeModelIoLog）
  补齐 token 链路与系统事件归一——顶层 turnId/model/durationMs 与 response.usage 附着到段、伪用户消息归 system_event、totalUsage 全量累计（FR-02/FR-03）。
implementation:
  - extractModelIoLine（sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts:263）扩读行顶层 turnId/model/durationMs 与 response.usage 五项 token（结构校验缺失置 null）；行级元数据随统一 offset 对齐落槽（MergedSlot 扩展），user/assistant/tool 段产出与末行补产（parse-zcode-model-io.ts:370 responseSupplementSegments）签名扩展透传——该行产出的全部段（含补产段）带同一 turn_id/model/duration_ms/usage
  - user_input 归一（D-003@v1）——段正文以 <task-notification> 或 <system-reminder> 开头 → sender='system_event'，其余缺省 'human'；前缀常量置 SYSTEM_REMINDER_BLOCK_RE 同区（parse-zcode-model-io.ts:58 先例）
  - totalUsage（D-004@v1）——全量段（beforeSeq 切片与 200 段窗口截断前，保轮完整性）usage 四项（inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens）求和；零 usage 数据 → null（不伪造 0——全局硬约束）
  - 连带更新既有形状断言——parse-zcode-model-io.test.ts 九字段 toEqual 补新字段（fixture 行补 turnId/usage 形状 + 老形状行缺省断言）；read-agent-log-messages.test.ts parsed 结果补 totalUsage 断言
acceptance:
  - fixture 行含 turnId/model/durationMs/response.usage 时其产出段（含补产段）逐段带新字段与 usage 五项；老形状行新字段缺省，九字段语义零回归
  - <task-notification> 与 <system-reminder> 开头的 user_input 段 sender='system_event'，普通用户文本缺省 'human'
  - totalUsage 等于全量段 usage 四项之和（与窗口/beforeSeq 切片无关）且无 usage 恒 null；status 分层与 truncated/totalSegments/skippedLines 语义逐字不变，unsupported/too_large 早退结果零新字段
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/agent-log/parse-zcode-model-io.test.ts tests/agent-log/read-agent-log-messages.test.ts tests/agent-log/zcode-sqlite-dispatch.test.ts && pnpm typecheck
constraints:
  - 纯函数约束维持（parse-zcode-model-io.ts:23 先例）——不读 env/时钟/文件系统，参数注入签名不变；不改 registry.ts/read-zcode-sqlite.ts/host-fs-handler.ts（注册透传归 task-06，sqlite 路径归 task-03）
  - 新字段全部可选缺省（老 daemon/老日志不返回即缺省——全局硬约束）；fixture 禁带真实路径/业务内容，统一脱敏占位
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
