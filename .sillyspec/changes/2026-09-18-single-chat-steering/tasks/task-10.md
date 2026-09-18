---
id: task-10
title: '模块文档同步（daemon.md / backend session 模块）+ verify 对照验收'
title_zh: '模块文档同步（daemon.md / backend session 模块）+ verify 对照验收'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 00:36:51
priority: P1
depends_on: ['task-09']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1]
allowed_paths:
  - .sillyspec/docs/SillyHub/modules/daemon.md
target_files:
  - .sillyspec/docs/SillyHub/modules/daemon.md
goal: >
  模块文档同步与 verify 对照验收（design.md Wave D2 / FR-04）——daemon.md 双端契约摘要补 steering 语义增量，按 design.md FR 逐条与全局硬约束对照验收并记录结论，收口本变更至人工确认归档前置态。
implementation:
  - daemon.md 契约摘要同步：「契约摘要（backend 侧）」补单聊忙轮 busy_strategy=inject 能力门控与 SessionInjectResponse.steered 出参、dispatch_now dispatch_mode 三态与不再无条件 interrupt；「契约摘要（sillyhub-daemon Node 侧）」补 codex turn/steer 分支（被拒回落轮边界消费）与 PROVIDER_CAPS steering 第 14 键取值依据
  - 按既有「增量」段落惯例（如 2026-09-18-004 先例）追加本次变更小节，含关键锚点引用（session_crud.py / queue.py / frontend/src/lib/daemon/sessions.ts:274 / message-queue-bar.tsx 等）与零回归声明
  - verify 对照验收：按 design.md 设计目标 FR-1~FR-6 逐条核对实现与测试证据，生命周期契约表 7 行与全局硬约束 7 条逐项对照，符合/偏差逐条记录；偏差项回写设计或开后续任务，不留未解释项
  - 集成冒烟证据核对（判级 integration-critical 强制）：task-02 codex 实机 turn/steer 探测记录 + 至少一条单聊忙轮端到端引导用例（真 daemon 会话）——证据齐则引用记录，不齐则明确标注缺口与影响面
  - 对账：各 task target_files 与实际改动一致性检查（review 视角），未落地遗留项列入风险/后续清单
acceptance:
  - daemon.md 双端契约摘要与增量段落含 steering/steered/dispatch_mode 关键语义，与代码实现一致（文档/注释/实现三者同步，无过时描述）
  - design.md FR-1~FR-6 + 全局硬约束逐条对照结论已记录（verify 产物或 tasks.md 标注），无未解释偏差
  - 集成冒烟两证据（codex 探测记录、端到端引导用例）可引用或缺口已标注
  - 本 task 未修改任何代码与测试文件（纯文档+验收）
verify:
  - grep -n -E "steering|steered|dispatch_mode" .sillyspec/docs/SillyHub/modules/daemon.md
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/message-queue-bar.test.tsx
  - cd backend && python -m pytest app/modules/daemon/tests/test_session_queue_actions.py -k "dispatch_now" -q
constraints:
  - 仅改 .sillyspec/docs/SillyHub/modules/daemon.md，不改代码与测试；发现实现与文档不符时，注释级不一致可顺手修正注释，逻辑级不一致回上游 task 或开后续变更，不在本 task 改逻辑
  - 文档中文，遵循 daemon.md 既有「增量」段落格式与锚点引用惯例
  - 归档（archive）不在本 task 范围——verify 通过后经人工确认再走 sillyspec archive 技能
  - 禁止跑全量测试，复跑仅限 task-09 已验证的定向命令子集
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
