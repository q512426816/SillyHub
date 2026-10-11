---
id: task-01
title: 'Spike pi 1.0 compatibility probe'
title_zh: 'SPIKE-00 pi 1.0 兼容总探——rpc 协议/vendored 扩展装载/MCP 消费形态三档实测 + 量化裁定留档'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-11 00:04:04
priority: P0
depends_on: []
blocks: [task-05]
requirement_ids: [FR-03]
decision_ids: [D-004@v1, D-005@v1]
allowed_paths:
  - .sillyspec/changes/2026-10-10-all-engines-mcp-injection/spike-pi-10-compat.md
target_files: []
goal: >
  宿主安装 pi 1.0+ 后实测三项兼容性（rpc 协议/vendored 扩展/MCP 消费形态），产形态结论（①原生配置②官方 adapter③均不可用）与量化裁定留档，决定 task-05 实现走法或截断。
implementation:
  - 宿主安装 pi 1.0+（npm i -g @earendil-works/pi-coding-agent），记录版本号
  - 实测①--mode rpc：spawn pi --mode rpc --session-dir 临时目录，对照 sillyhub-daemon/src/interactive/pi-rpc-driver.ts:221 基线（0.81.1）核对 get_state 握手/事件流形状/fork 命令兼容性
  - 实测②vendored 扩展：pi --extension 加载 sillyhub-daemon/vendor/pi-extensions/ask-user 与 subagent，确认 ExtensionAPI registerTool 在 1.0 下可装载可执行
  - 实测③MCP 形态三档：原生配置键（settings.json mcpServers 或等价）/官方 pi-mcp-adapter（读 .mcp.json）定位与 PI_CODING_AGENT_DIR 目录重定向相互作用/均不可用——三档留证据
  - 留档 spike-pi-10-compat.md：三项证据 + 形态结论 + 量化裁定（触阈值即截断：rpc 全量重写/≥2 扩展重写/三形态全不可用）
acceptance:
  - spike-pi-10-compat.md 存在且含三项实测证据、形态结论（①/②/③/截断四选一）、量化裁定理由
  - 形态结论与 task-05 实现路径一一对应（截断时 task-05 收窄为维持 false + 适配留档）
verify:
  - test -f .sillyspec/changes/2026-10-10-all-engines-mcp-injection/spike-pi-10-compat.md
constraints:
  - 纯实测+留档，禁止修改任何仓内源码与 vendored 扩展
  - 宿主全局 pi 配置禁止改动（实测用临时 session-dir 与临时目录隔离）
  - 触发量化截断阈值时如实裁定留档，禁止硬闯适配
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
