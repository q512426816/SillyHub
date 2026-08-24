---
id: task-08
title: 'service.py inject 路径简报前缀——SESSION_INJECT prompt 组装（简报+---+用户消息），user_input 保持干净'
title_zh: 'service.py inject 路径简报前缀——SESSION_INJECT prompt 组装（简报+---+用户消息），user_input 保持干净'
author: 'qinyi'
created_at: 2026-08-24 18:49:24
priority: P0
depends_on: ['task-06']
blocks: [task-09]
requirement_ids: [FR-01]
decision_ids: [D-004@v1, D-013@v1]
allowed_paths:
  - backend/app/modules/daemon/session/service.py
  - backend/app/modules/daemon/tests/test_inject_orchestrator_tagging.py
  - backend/app/modules/daemon/tests/
goal: >
  _inject_into_session 首主控轮判定命中时把 SESSION_INJECT 的 prompt 组装为「简报+---+用户消息」，AgentRunLog(user_input) 与前端展示保持干净原文——主控盲区修复的 inject 侧落地（FR-01/D-004@v1）。
expects_from:
  task-06:
    - contract: mission_context
      needs: [should_inject_first_turn_briefing, build_orchestrator_briefing]
implementation:
  - _inject_into_session 在活跃 mission 查询（service.py:1682-1696 双标记段旁）调 task-06 的 should_inject_first_turn_briefing——活跃 mission ∧ prompt 非空 ∧ 无已消耗 orchestrator run（已消耗=status ∈ pending/running/completed，failed 不烧断）
  - 命中时用 build_orchestrator_briefing 产简报，SESSION_INJECT inject_payload 的 prompt（service.py:1953-1960）改为 简报+\n\n---\n\n+用户消息；未命中保持原文
  - AgentRunLog(user_input)（service.py:1759-1774）与 SESSION_SWITCH_CONFIG 分支的 prompt（:1940-1951）保持原值不动
  - 补测试——命中注入/无 mission 逐字节不变/空 prompt 切换轮不注入/已有非 failed orchestrator run 不注入/failed 轮后重注/user_input 干净断言
acceptance:
  - 命中轮 SESSION_INJECT payload 的 prompt=简报+\n\n---\n\n+用户消息（简报在前），AgentRunLog(user_input)=干净用户原文（不含简报）
  - 空 prompt 纯配置切换轮不注入也不消耗一次性名额；mission 已有 pending/running/completed orchestrator run 的轮不再注入，仅 failed 后下一条带文本消息重注（D-013@v1）
  - 无活跃 mission 普通会话与懒建路径（回填 orchestrator run 使判定短路）行为不变，仅多一次判定查询
verify:
  - cd backend && uv run pytest app/modules/daemon -q --no-cov -n auto
constraints:
  - 仅改 inject 路径——create 路径首 prompt 简报前缀（service.py:919 组装点）归 task-09；同文件 W3 在前，本卡先落地勿越界改 create 段
  - SESSION_INJECT 协议字段不变（仅 prompt 内容），零 daemon 改动（D-004@v1）；截断口径沿用既有（AgentRunLog 5000 字符不动）
  - 简报内容与格式由 task-06 helper 产出，本卡只做判定调用+拼接
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
