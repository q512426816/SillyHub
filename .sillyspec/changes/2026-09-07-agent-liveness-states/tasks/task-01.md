---
id: task-01
title: 'daemon liveness 基座——types.ts + registry.ts（format→deriver 注册表）'
title_zh: 'daemon liveness 基座——types.ts + registry.ts（format→deriver 注册表）'
author: 'qinyi'
created_at: 2026-09-07 13:43:27
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-003@v1]
provides:
  - contract: liveness_deriver
    fields: [LivenessState, DeriverInput, DeriverOutput, getDeriver]
allowed_paths:
  - sillyhub-daemon/src/agent-log/liveness/types.ts
  - sillyhub-daemon/src/agent-log/liveness/registry.ts
target_files:
  - NEW:sillyhub-daemon/src/agent-log/liveness/types.ts
  - NEW:sillyhub-daemon/src/agent-log/liveness/registry.ts
goal: >
  建立 daemon liveness 子层基座：五态模型、deriver 纯函数签名与 format→deriver 注册表查询入口，为 task-02/03/10/11 的推导器提供统一扩展点。
implementation:
  - 新建 sillyhub-daemon/src/agent-log/liveness/types.ts：按 design §7 定义 LivenessState 五态字面量联合（working/blocked/idle/ended/unknown）、DeriverInput（tail/prev/now 全注入）、DeriverOutput（state+evidence 短摘要）与 LivenessDeriver 签名。
  - 新建 sillyhub-daemon/src/agent-log/liveness/registry.ts：仿既有 src/agent-log/registry.ts 的 PARSERS ReadonlyMap + getAgentLogParser 扩展点模式，导出 getDeriver(format)——命中返回 deriver，未注册返回 null（调用方回落 L0 mtime 兜底）。
  - 模块头注释声明与 parse-zcode-model-io.ts 同源的纯函数约束（不读文件系统/时钟，now 经入参注入），注册表 key 与 platform_agent_logs.format 落库串逐字一致。
acceptance:
  - getDeriver 对未注册 format（含 zcode-model-io-jsonl，deriver 注册归 task-02）返回 null，语义即 L0 only。
  - types.ts 与 registry.ts 不 import node:fs、RpcError、ws-client（纯类型+纯映射，与既有 agent-log/registry.ts 同构零副作用）。
verify:
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 不修改既有 agent-log/registry.ts 与 parse-zcode-model-io.ts。
  - 注册表本任务保持空表，不预写未实现 format 的占位分支。
  - 不引入 design §7 之外的状态值或字段（evidence 保持 string 短摘要）。
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
