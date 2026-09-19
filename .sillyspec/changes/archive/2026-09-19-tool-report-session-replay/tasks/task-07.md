---
id: task-07
title: 'daemon 解析器矩阵单测（真实日志脱敏 fixture 三 harness + 字段断言）'
title_zh: 'daemon 解析器矩阵单测（真实日志脱敏 fixture 三 harness + 字段断言）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 21:03:54
priority: P0
depends_on: ['task-02', 'task-03', 'task-04', 'task-05', 'task-06']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: []
allowed_paths:
  - NEW:sillyhub-daemon/tests/agent-log-matrix.test.ts
target_files:
  - NEW:sillyhub-daemon/tests/agent-log-matrix.test.ts
goal: >
  为 task-02/03/04/05/06 落成的三 harness 解析器矩阵补 daemon 侧验收单测——
  zcode（137ddfff 主日志截段同构）/ claude-code（6f02be06 截段同构）/ cursor-agent
  （transcript 截段同构）各内嵌脱敏 fixture，断言新字段存在性、sender 归一规则、
  totalUsage 求和与窗口/beforeSeq 切片语义不回归（FR-02/FR-03 daemon 验收锚）。
implementation:
  - 新建测试文件，风格照 sillyhub-daemon/tests/agent-log/parse-zcode-model-io.test.ts——fixture 内嵌脱敏 JSONL 字符串（真实键集 + 占位内容），解析器纯函数直调零 vi.mock
  - zcode 样本——model_io 行带顶层 turnId/model/durationMs 与 response.usage 五项，断言 usage/turn_id/model/duration_ms 附着到该次调用产出段（含末行 response 补产段）
  - zcode 归一与累计——user_input 以 task-notification/system-reminder 开头 → sender=system_event、其余缺省 human；totalUsage 四项等于全样本各次调用求和
  - claude-code 样本——user/assistant 行产段、queue-operation/attachment/mode/last-prompt/system 行跳过；isMeta=true 与注入前缀白名单（【当前用户信息】等）→ system_event；message.usage 透传到该行产出段
  - claude-code 配对——纯 tool_result 载体 user 行按 tool_use_id 配对成工具段、失配走孤儿结果断言
  - cursor-agent 样本（工具段形态按 task-05 spike-02 fixture 核对结论构造）——turn_ended 事件产出轮边界 turn_id；usage 恒缺省、totalUsage 为 null（不落盘即未知，不伪造 0）
  - 窗口与 registry——三 harness 各断言超窗截断 + beforeSeq 切片（口径同 parse-zcode-model-io.test.ts Z7 用例）；getAgentLogParser（sillyhub-daemon/src/agent-log/registry.ts:74）三键命中、未注册返回 null
acceptance:
  - zcode 断言全过——新字段附着正确、system_event 归一、totalUsage 等于样本全调用求和
  - claude-code 断言全过——行过滤、isMeta/前缀归一、tool_result 配对与孤儿、usage 透传
  - cursor-agent 断言全过——turn_ended 切轮产出 turn_id、usage/totalUsage 恒未知
  - 三 harness 窗口/beforeSeq/truncated/totalSegments 语义与既有 Z7 口径一致（不回归）
  - fixture 全脱敏——无真实用户路径/业务内容/凭证残留
verify:
  - cd sillyhub-daemon && pnpm test -- tests/agent-log-matrix
  - pnpm -C sillyhub-daemon run typecheck
constraints:
  - 只新增测试文件不改解析器/registry 源码——实现缺陷回写 task-02/03/04/05/06 对应卡修复，本卡不代改
  - fixture 内嵌字符串禁外挂本机真实日志文件路径，内容统一脱敏占位（全局硬约束 execution 防线）
  - 禁跑全量测试仅定向本文件；sqlite 读取器字段由 task-03 既有 sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts 覆盖，本卡不重复
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
