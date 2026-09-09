---
id: task-05
title: 'cursor-marker-spike-compliance-gate'
title_zh: 'cursor spike——真机 10 次澄清场景遵守率判定（≥8/10 门槛，go/no-go）'
author: 'qinyi'
created_at: 2026-09-09 23:09:59
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v2]
provides: 'spike go/no-go 结论（spike-cursor-marker.md 内 10 场景判定明细 + 遵守率 + 结论）→ task-08 仅 go 才执行；task-12 的 cursor dialog 取值 marker/none 按此联动（R-01 门槛）'
allowed_paths:
  - NEW:.sillyspec/changes/2026-09-09-askuser-pi-cursor/spike-cursor-marker.md
target_files:
  - NEW:.sillyspec/changes/2026-09-09-askuser-pi-cursor/spike-cursor-marker.md
goal: >
  真机 cursor 无头会话（同生产形态 -p --trust --force）构造 10 次互不重复的需澄清场景，以等效未来 prompt 前缀的协议说明驱动模型输出 askuser 标记，统计合法标记遵守率，≥8/10 判 go（task-08 启用注入），否则 no-go（cursor 降级自然语言提问、caps=none），结论落盘 spike 记录文件（FR-04）。
implementation:
  - 起草协议说明前缀文案（何时问、```askuser fenced JSON 尾块格式样例含 kind/question/options/allowCustom/recommendResponders、答案将作为下一条用户消息回来、推荐人可选）——与 task-08 待注入常量同稿
  - 真机逐场景发送「前缀 + 澄清场景 prompt」，共 10 个场景并覆盖 select/confirm/input/editor 四 kind
  - 逐条按判据打分——合法 = 输出文本尾部 ```askuser fenced 块 + JSON 可解析 + kind/question 必填齐（与 task-06 解析器宽容口径一致，design §Wave B.2）
  - 落盘 spike-cursor-marker.md——frontmatter（author/created_at）+ 10 场景明细表（场景摘要/原始输出摘录/合法与否）+ 遵守率 + go/no-go 结论 + no-go 降级路径注记（不注入 prompt、caps=none、前端资产保留）
acceptance:
  - spike-cursor-marker.md 存在且含 10 个场景的判定明细（每条可溯源到原始输出摘录）
  - 文件含明确 go/no-go 结论与遵守率计数（合法 ≥8/10 → go；<8 → no-go）
  - 10 场景互不重复且覆盖 select/confirm/input/editor 四 kind
verify:
  - manual（真机人工操作，无自动化命令）——按 implementation 前三步执行并记录
  - test -f .sillyspec/changes/2026-09-09-askuser-pi-cursor/spike-cursor-marker.md
  - grep -cE 'go|no-go' .sillyspec/changes/2026-09-09-askuser-pi-cursor/spike-cursor-marker.md
constraints:
  - 只产出 spike 记录文件，不改任何产品代码（解析器/卡片/prompt 注入均不在本任务）
  - 判定口径与 task-06 解析器一致（合法性门槛三项，宽容多形态不另设分项标准）
  - no-go 不阻塞 Wave 1 并行任务（task-02/06/12 无依赖），仅决定 task-08 是否执行与 cursor caps 取值
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
