---
id: task-03
title: 'Spike cursor headless MCP probe'
title_zh: 'SPIKE-02 cursor headless MCP 实测——审批行为 + 配置落点隔离调查'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-11 00:04:04
priority: P1
depends_on: []
blocks: [task-07]
requirement_ids: [FR-05]
decision_ids: [D-003@v1]
allowed_paths:
  - .sillyspec/changes/2026-10-10-all-engines-mcp-injection/spike-cursor-mcp.md
target_files: []
goal: >
  实测 cursor-agent headless 模式 MCP 工具审批行为与配置落点隔离方案，产出可行/不可行结论留档决定 task-07 走法。
implementation:
  - 配置一个 stdio 测试 MCP server（临时目录 mcp.json），cursor-agent headless 形态（对齐 cursor-driver.ts:241-258 buildTurnArgs：-p --output-format stream-json --trust --force）下观察工具审批行为（自动批准/挂起/拒绝）
  - 调查配置落点隔离：cursor-agent 是否支持 per-process 配置参数或 env 隔离；全局 ~/.cursor/mcp.json 与项目级 .cursor/mcp.json 两个落点对 daemon 场景的污染面评估
  - 留档 spike-cursor-mcp.md：审批行为证据 + 落点隔离结论 + 可行/不可行裁定
acceptance:
  - spike-cursor-mcp.md 存在且含审批行为证据、落点结论、可行/不可行裁定三要素
  - 不可行时裁定理由可支撑 providers.ts 注释三要素（实测证据/坑点/复评条件）
verify:
  - test -f .sillyspec/changes/2026-10-10-all-engines-mcp-injection/spike-cursor-mcp.md
constraints:
  - 纯实测+留档，禁止修改仓内源码
  - 宿主全局 ~/.cursor 与工作区项目级 .cursor/mcp.json 禁止写入（临时目录隔离）


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
