---
id: task-02
title: 'Spike codex app-server MCP probe'
title_zh: 'SPIKE-01 codex app-server MCP 生效实测——per-session CODEX_HOME config.toml [mcp_servers.*] 工具面可见性 + 实验位评估'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-11 00:04:04
priority: P0
depends_on: []
blocks: [task-06]
requirement_ids: [FR-04]
decision_ids: [D-006@v1]
allowed_paths:
  - .sillyspec/changes/2026-10-10-all-engines-mcp-injection/spike-codex-mcp.md
target_files: []
goal: >
  实测 codex app-server 协议模式下 per-session CODEX_HOME config.toml [mcp_servers.*] 是否生效（工具进 thread 工具面），评估 initialize capabilities 实验位，产生效性结论留档决定 task-06 走法。
implementation:
  - 准备临时 per-session CODEX_HOME 目录，手写 config.toml 含 [mcp_servers.spike_test]（stdio echo server，command/args 最小可复现）
  - spawn codex app-server --listen stdio://（对齐 codex-app-server-driver.ts:820-829 spawn 形态），initialize params 带 capabilities.experimentalApi=true
  - thread/start 后枚举会话工具面，确认 spike_test 工具是否出现；不出现则实验 initialize capabilities 其他 MCP 相关方法面
  - 留档 spike-codex-mcp.md：生效性证据（协议帧/工具列表）+ 实验位评估 + 结论（生效/仅实验位/不生效三选一）
acceptance:
  - spike-codex-mcp.md 存在且含协议帧证据、生效性结论、实验位评估三要素
  - 结论与 task-06 实现路径一一对应（不生效且实验位不通则 task-06 收窄为维持 false 留档）
verify:
  - test -f .sillyspec/changes/2026-10-10-all-engines-mcp-injection/spike-codex-mcp.md
constraints:
  - 纯实测+留档，禁止修改仓内源码
  - 宿主全局 ~/.codex 禁止改动（临时 CODEX_HOME 隔离）


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
