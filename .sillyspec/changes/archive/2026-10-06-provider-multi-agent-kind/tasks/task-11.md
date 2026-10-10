---
id: task-11
title: '端到端验收——UI 实测多引擎供应商双引擎会话命中 + 设默认互斥（含扩张）+ 热切换多引擎扇出 + pi×openai 禁用 UI 复验（手动验收记录留变更目录）'
title_zh: '端到端验收——UI 实测多引擎供应商双引擎会话命中 + 设默认互斥（含扩张）+ 热切换多引擎扇出 + pi×openai 禁用 UI 复验（手动验收记录留变更目录）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-06 14:31:42
priority: P0
depends_on: ['task-07', 'task-10']
blocks: []
requirement_ids: [FR-01, FR-03, FR-04, FR-05]
decision_ids: [D-001@v1, D-003@v1, D-006@v1]
allowed_paths:
  - .sillyspec/changes/2026-10-06-provider-multi-agent-kind/
target_files:
goal: >
  端到端手动验收多引擎供应商全链路（design 总体方案 Wave3 第 10 条）：UI 实测
  双引擎会话命中、设默认互斥（含扩张与收缩空缺）、热切换多引擎扇出、pi×openai
  禁用 UI 复验，验收记录留变更目录 docs/verification-e2e.md。
implementation:
  - 场景 1 双引擎会话命中：新建一条智谱供应商同时勾选 claude+pi（同 key/base_url），分别新建 Claude 会话与 Pi 会话，确认两会话供应商解析命中同一行（会话面板供应商显示与 claim 下发 provider_config.agent_kind 为各自会话引擎）
  - 场景 2 设默认互斥（D-003/D-006）：该行设默认后 claude 与 pi 新会话均默认它；编辑扩张（追加 codex）后 codex 原默认兄弟行被清；编辑收缩（去掉 pi）后 pi 默认空缺、表单出空缺提示（R-05）且不自动转移
  - 场景 3 热切换多引擎扇出（D-006/R-07）：保持两个不同引擎的 active interactive 会话，对多引擎默认行触发供应商热切换，确认各引擎会话各自收到 agent_kind 为本会话引擎的 config 且 daemon reload 生效；顺带观察单引擎场景行为等价（回归）
  - 场景 4 pi×openai 禁用 UI 复验：表单 api_format=openai_chat 时 pi 复选禁用并有提示；构造该组合提交被后端 422 兜底拦截
acceptance:
  - 四场景（双引擎命中、设默认互斥含扩张与收缩空缺、热切换多引擎扇出、pi×openai 禁用复验）UI 实测全部通过并留痕
  - .sillyspec/changes/2026-10-06-provider-multi-agent-kind/docs/verification-e2e.md 存在且四场景结论齐全，失败项有回执任务标记
verify:
  - 人工核对 .sillyspec/changes/2026-10-06-provider-multi-agent-kind/docs/verification-e2e.md 四场景结论齐全（前置：task-07 后端测试与 task-10 前端测试均已全绿）
constraints:
  - 只写验收记录文档，不改任何产品代码与测试；daemon 仓零改动边界不破
  - 手动实操验收（本地 dev 或部署栈），不得以单测/集成测试替代；失败不改验收口径，回对应 task 修复后复验
  - 不清理/合并存量重复供应商行（D-002 用户手动处理）
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
