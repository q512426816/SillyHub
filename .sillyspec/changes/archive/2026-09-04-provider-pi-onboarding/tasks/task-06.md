---
id: task-06
title: 'subagent 实证（examples 扩展接入+事件归属实测→翻值或如实留 false）'
title_zh: 'subagent 实证（examples 扩展接入+事件归属实测→翻值或如实留 false）'
author: 'qinyi'
created_at: 2026-09-04 11:38:51
priority: P0
depends_on: ['task-02', 'task-03']
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/vendor/pi-extensions
  - sillyhub-daemon/scripts/build-bundle.sh

  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/src/interactive/providers.ts
  - backend/app/modules/agent/provider_caps.py
  - frontend/src/lib/provider-caps.ts
  - sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
  - docs/agent-provider-onboarding.md
goal: >
  subagent 实证（R-02）：定位 pi examples/subagent 扩展→真实跑子代理→事件归属形状
  实测→可落 parent 三列则 caps.subagent 翻 true（三端同步），否则如实留 false+
  报告记录（FR-03 / D-002@v1，先实现后翻值纪律）。
implementation:
  - 定位扩展：pi 包内 examples/extensions/subagent/（@earendil-works/pi-coding-agent）；接入路径二选一评估——a) vendor 拷贝进 daemon 分发目录（随 daemon 版本钉住，防 pi 升级漂移）b) 运行时解析包内绝对路径（nvm 目录定位，脆弱）——选 a 并在 driver spawn 参数加 --extension <vendored 路径>（可选开关，默认开）
  - 真实实测：本机跑一次 pi rpc + subagent 工具调用，捕获事件流——观察子代理是否产生 per-child 事件（parent_tool_use_id 类归属）还是聚合进 tool result details（Grill 预判后者）
  - 结论落值：归属可落（事件带可映射字段）→ pi-events.ts 补归属映射+caps.subagent 翻 true（providers.ts 单源+两镜像+守护测试同步）；聚合不可落 → 如实留 false
  - onboarding.md §5 案例锚记录结论（无论真假，含实测证据摘要）
acceptance:
  - subagent 结论有实测证据支撑（事件流样本落 fixture 或报告引用）
  - caps 值与结论一致：翻 true 则三端同步+对齐测试绿；留 false 则报告/onboarding 如实记录
  - vendored 扩展路径方案有版本脆弱性说明（R-02 应对）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/pi-rpc-driver.test.ts tests/interactive/pi-events.test.ts
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/agent/tests/test_provider_caps_alignment.py -q（若翻 true）
constraints:
  - 不为翻 true 而翻 true——归属映射必须基于真实事件形状，聚合型结果如实 false
  - vendor 只拷 subagent 扩展本体（不引入 pi 包整个 examples）
  - 本 task 不动 caps 其它 7 键
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
