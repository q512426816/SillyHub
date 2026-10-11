---
id: task-09
title: 'End-to-end acceptance per flipped engine'
title_zh: '端到端验收——每翻值引擎平台会话 upload_file 实测上传成功并留档'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-11 00:04:04
priority: P0
depends_on: [task-08]
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-001@v1, D-003@v1, D-004@v1, D-006@v1]
allowed_paths:
  - .sillyspec/changes/2026-10-10-all-engines-mcp-injection/acceptance-e2e.md
target_files: []
goal: >
  每个翻值引擎在平台真实会话内端到端实测 MCP 工具可见与 upload_file 上传成功，验收记录留档。
implementation:
  - 启动本地平台（docker compose 或 dev 环境），确认 daemon 跑本变更构建产物
  - 对每翻值引擎（caps.mcp=true 全集）：平台创建该引擎交互式会话，验证平台 MCP 工具（sillyhub-daemon 编排 5 工具 + sillyhub-file 上传 2 工具）在会话工具面可见
  - 逐引擎让 agent 调 upload_file 上传测试文件，验证文件中心可见（POST /api/agent/file-artifacts 链路落库）
  - 验收记录留档 acceptance-e2e.md：逐引擎证据（会话日志锚点/上传文件 id）
acceptance:
  - acceptance-e2e.md 存在且逐翻值引擎含工具可见 + upload_file 成功证据
  - 截断引擎（若有）在留档中记录为暂缺并注明决策号
verify:
  - test -f .sillyspec/changes/2026-10-10-all-engines-mcp-injection/acceptance-e2e.md
constraints:
  - 验收环境用本地 dev/compose，禁止动生产部署
  - 实测失败不掩盖——失败证据照录并走风险登记升厚


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
