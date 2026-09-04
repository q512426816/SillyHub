---
id: task-07
title: '真实 PI 会话冒烟（onboarding §8+PI 清单）+onboarding 案例锚与档B 盲区修复'
title_zh: '真实 PI 会话冒烟（onboarding §8+PI 清单）+onboarding 案例锚与档B 盲区修复'
author: 'qinyi'
created_at: 2026-09-04 11:38:51
priority: P0
depends_on: ['task-03', 'task-05']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - docs/agent-provider-onboarding.md
  - .sillyspec/changes/2026-09-04-provider-pi-onboarding/smoke-result.md
goal: >
  真实 PI 会话全链路冒烟收口（FR-05）：本机 pi 0.81.1 真环境跑创建→工具执行→
  partial→usage→inject→interrupt→resume→双轨落库，结果记录 smoke-result.md；
  onboarding §5 档C 案例锚（12 步勾选+task-06 subagent 结论）+顺修档B 盲区。
implementation:
  - 冒烟前置：本地栈 backend 运行中+daemon 已注册 pi runtime（provider=pi online）
  - 全链路清单逐项跑并记录（对齐 claude 冒烟 9 项，PI 适配）：创建 pi 会话→prompt 带 Bash 工具执行（真实输出）→partial 流式（SSE text_delta 实时）→usage 实时（SSE summary）→inject 追加（steer 场景验证）→interrupt（rpc abort 打断进行中 turn）→resume（断开 daemon 重启后 --session-id 恢复）→双轨落库（agent_run_logs metadata.agent_event 行计数）→前端渲染（工具卡/thinking/partial）
  - smoke-result.md：逐项 PASS/FAIL/豁免（PI 无审批卡→该项豁免记录；subagent 按 task-06 结论）
  - onboarding.md：§5 档C 案例锚（PI 接入 12 步勾选记录+实测要点+subagent 结论）；顺修档B 盲区两处（EXPECTED_PROVIDERS 断言必改说明/装配行与白名单步骤补列——按实质修不拘步骤号）
acceptance:
  - 冒烟清单全过或有豁免记录（FAIL 项=回实现任务修，不在本 task 打磨）
  - 双轨落库验证（agent_event 行存在+文本行前缀正常）+SSE 渲染正常
  - claude/codex 冒烟级回归（一次 claude 会话确认零回归）
  - onboarding 案例锚完整（12 步+subagent 结论）
verify:
  - 人工+API 断言冒烟（记录进 smoke-result.md）
  - cd sillyhub-daemon && pnpm exec vitest run tests/interactive/ 2>&1 | tail -2
constraints:
  - 冒烟用真机真 CLI（不 mock）；失败项如实记录回修
  - 本 task 不改生产代码（发现 bug 回 task-02/03 修）
  - smoke-result.md 是 verify 阶段 Runtime Evidence 素材
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
