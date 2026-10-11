---
id: task-06
title: 'Codex channel MCP wiring'
title_zh: 'codex 通道落地——config.toml [mcp_servers.*] 托管段扩展 + driver 消费 + 单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-11 00:04:04
priority: P0
depends_on: [task-02]
blocks: [task-08]
requirement_ids: [FR-04]
decision_ids: [D-006@v1]
allowed_paths:
  - sillyhub-daemon/src/codex-settings.ts
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - sillyhub-daemon/tests/codex-settings-mcp.test.ts
target_files:
  - sillyhub-daemon/src/codex-settings.ts
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - NEW:sillyhub-daemon/tests/codex-settings-mcp.test.ts
goal: >
  按 SPIKE-01 结论实现 codex 通道：config.toml 托管段 [mcp_servers.*] 差量替换写入与 driver 消费。
implementation:
  - codex-settings.ts（sillyhub-daemon/src/codex-settings.ts:38-56）托管段差量替换扩展 [mcp_servers.<name>] 段：序列化能力扩展（args 字符串数组 + env 表/子表 TOML 序列化，现序列化器仅字符串标量 :53-55）、[mcp_servers.*] 段头纳入托管段识别集合、非托管行保留语义不变
  - codex-app-server-driver.ts start 链路（:820-878 ctx 组装）把 mcpServers 传给 codex-settings writer（SPIKE-01 结论决定仅文件层或附加实验位）
  - SPIKE-01 不生效且实验位不通则收窄：codex.mcp 维持 false + providers.ts 注释留档，本 task 仅交付注释与测试骨架说明
  - 新增 sillyhub-daemon/tests/codex-settings-mcp.test.ts：托管段写入/非托管行保留/幂等/args 数组与 env 表序列化往返（round-trip）
acceptance:
  - codex-settings-mcp.test.ts 全绿（写入/保留/幂等/序列化往返四组）
  - 生成 config.toml 被 codex 可解析（SPIKE-01 实测形态下工具面可见或按截断分支留档）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/codex-settings-mcp.test.ts
constraints:
  - 禁止写宿主全局 ~/.codex（仅 per-session CODEX_HOME）
  - TOML 序列化必须往返单测覆盖（防产出 codex 无法解析的 config.toml——D-006 故障面）
  - 现有托管段（model/model_providers.sillyhub）行为零回归


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
