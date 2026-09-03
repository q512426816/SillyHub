---
id: task-12
title: 'golden 三源对照测试收口（normalizer ≡ 三处现状实现联合语义）'
title_zh: 'golden 三源对照测试收口（normalizer ≡ 三处现状实现联合语义）'
author: 'qinyi'
created_at: 2026-09-03 23:55:50
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - sillyhub-daemon/tests/interactive/golden/claude-events-golden.test.ts
  - sillyhub-daemon/tests/fixtures/claude-sdk-messages
  - backend/app/modules/daemon/tests/test_run_sync_golden_parity.py
goal: >
  golden 三源对照测试收口：真实 SDK 消息序列 fixture 驱动端到端链路，断言新轨产物 ≡ 现状三处
  实现联合语义（backend _extract_sdk_messages 完整展开行 + daemon session-manager partial
  flush 行 + submit_messages 落库行），覆盖 partial→override→撤回、实时 usage、子代理归属
  （FR-02 验收锚 / D-003@v1 / D-004@v1）。
implementation:
  - fixture：扩充 task-03 的 claude-sdk-messages 为完整会话序列（多 turn、Task 子代理、Edit patch、partial 流+override、usage 帧含中途 partial usage）
  - daemon 侧 golden 测试：序列喂 ClaudeEventNormalizer → 事件流过（mock）submit 包装 → 断言事件序列快照；同序列在旧链路（backend _extract_sdk_messages + 旧 flush 行为联合）的产物快照对照等价
  - backend 侧 parity 测试：同 fixture 两种载荷（旧 dict 序列 vs kind:'agent_event' 序列）分别 submit_messages → 落库行（channel/文本行/结构化列/metadata_）逐字段对照等价；usage 实时更新断言（partial 中途即更新 agent_runs + SSE summary）；override 撤回后无 partial 残留
  - 旧链路产物快照生成方式：改造期间以现实现跑 fixture 生成并固化（golden 文件提交入库）
acceptance:
  - 三源对照全绿：新轨（normalizer+agent_event 落库）≡ 旧轨联合语义（R-01 验收）
  - usage 断言含 partial 中途与 turn 终态两处（D-003@v1）
  - override 链断言含 DB DELETE 与 SSE stale 清除（D-004@v1）
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/golden/
  - cd backend && python -m pytest app/modules/daemon/tests/test_run_sync_golden_parity.py -q
constraints:
  - 纯测试任务：不改生产代码（发现不一致=实现 bug 回 task-03/07/09 修）
  - golden 快照文件入库（防实现回归漂移）；fixture 脱敏（不得含真实 token/路径敏感信息）
  - 双份逻辑并存期（R-06）：本测试即两份实现一致性锚
expects_from:
  - task-03: ClaudeEventNormalizer
  - task-07: _persist_agent_event
  - task-09: 上报形态
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
