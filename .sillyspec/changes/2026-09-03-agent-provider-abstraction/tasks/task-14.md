---
id: task-14
title: 'docs/agent-provider-onboarding.md 三档接入清单'
title_zh: 'docs/agent-provider-onboarding.md 三档接入清单'
author: 'qinyi'
created_at: 2026-09-03 23:55:50
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-001@v1]
allowed_paths:
  - docs/agent-provider-onboarding.md
goal: >
  新 provider 接入操作手册：三档路径（换 wrapper 零代码/族内成员描述符/新协议族
  driver+归一化器+注册）可执行 checklist，含 multica 对照引用与升级顺序约定（FR-07 /
  D-001@v1 兼容策略的文档落点）。
implementation:
  - docs/agent-provider-onboarding.md 章节：①总览（AgentEvent 契约/注册表/caps 三件套架构图）②档A 换 wrapper：注册表条目改 command（零代码路径）③档B 族内新成员：descriptor 条目 + 差异微调点清单（stderr 嗅探/工具名映射/模型发现预留）④档C 新协议族：实现 InteractiveDriver + 归一化器 + 注册条目 checklist（每步指向 design.md §5/§7 与代码锚点）⑤能力矩阵维护（三端表同步+守护测试）⑥升级顺序约定（backend 先于 daemon，SILLYHUB_LEGACY_TEXT_EVENTS 回退开关）⑦multica 参照（research-multica-agent-adaptation.md 引用）
  - 中文行文（仓库惯例），代码引用带文件路径
acceptance:
  - 三档路径各有可执行 checklist（新成员零代码路径明确成立条件）
  - 升级顺序约定与 design §9 一致；回退开关文档化
  - 与 providers.ts/caps 表现状字段逐一对应（不写未实现字段为可用）
verify:
  - 文档评审：对照 design.md §5/§9 与 providers.ts 实际字段逐条核对（人工+grep 字段名）
constraints:
  - 纯文档任务，不改代码
  - 未实现的预留字段（envKeys/contextFile 注入）明确标注"预留未实现"
  - 不复制 multica 代码，只引用模式与教训
expects_from:
  - task-05: 注册表结构（descriptor 字段实测）
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
