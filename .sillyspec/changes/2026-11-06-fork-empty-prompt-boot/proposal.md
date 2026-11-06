---
author: flow-machine-draft
created_at: 2026-11-06T15:11:33.328Z
---
# 提案书（Proposal）— 2026-11-06-fork-empty-prompt-boot

## 动机

任务原话转写：生产事故：会话分叉（native 档）后分叉会话引擎进程从未建立，前端永久转圈（生产实证 2026-11-05 会话 0aa54089：daemon 认领 lease 后 SESSION_NOT_FOUND 连打 8 分钟，300s 僵尸轮清扫判 interactive_turn_not_started；且 fork 建会话未继承源会话 cwd，断线恢复后父子会话双双缺 cwd 无法 reopen——同日 5 个 cwd 空会话被恢复链 /end）。根因两端契约断裂：backend fork 链 native 档首轮 prompt 归零是设计行为（create.py dispatch_prompt 归零），但 daemon _startInteractiveSession 空 prompt 守卫（daemon.ts:10161 附近 interactive_missing_fields）不豁免 fork lease 直接 return 且不回报失败；SessionManager.create 本身支持空 firstPrompt（session-fork.test.ts:536 有单测），守卫与之契约不一致。

成功标准：
- daemon _startInteractiveSession 对带 resumeSessionId 的 lease（fork lease 特征）prompt 为空时不再早退，正常调 SessionManager.create 建引擎会话（复现事故形态的 daemon 级用例：认领 fork 空 prompt lease → 走 create 而非 interactive_missing_fields 早退）
- 非 fork lease（无 resumeSessionId）空 prompt 行为不变仍早退（防回归用例）
- backend fork_session 建 B 时继承 source.cwd（源会话有 cwd 则 B 落同值；源为空则 B 保持空，不伪造）
- 新增/修改的 daemon 与 backend 测试全绿（只跑相关测试，不跑全量）
- ruff/eslint 对触及文件零告警

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. daemon _startInteractiveSession 对带 resumeSessionId 的 lease（fork lease 特征）prompt 为空时不再早退，正常调 SessionManager.create 建引擎会话（复现事故形态的 daemon 级用例：认领 fork 空 prompt lease → 走 create 而非 interactive_missing_fields 早退）
2. 非 fork lease（无 resumeSessionId）空 prompt 行为不变仍早退（防回归用例）
3. backend fork_session 建 B 时继承 source.cwd（源会话有 cwd 则 B 落同值；源为空则 B 保持空，不伪造）
4. 新增/修改的 daemon 与 backend 测试全绿（只跑相关测试，不跑全量）
5. ruff/eslint 对触及文件零告警

## 成功标准（可验证）

1. daemon _startInteractiveSession 对带 resumeSessionId 的 lease（fork lease 特征）prompt 为空时不再早退，正常调 SessionManager.create 建引擎会话（复现事故形态的 daemon 级用例：认领 fork 空 prompt lease → 走 create 而非 interactive_missing_fields 早退）
2. 非 fork lease（无 resumeSessionId）空 prompt 行为不变仍早退（防回归用例）
3. backend fork_session 建 B 时继承 source.cwd（源会话有 cwd 则 B 落同值；源为空则 B 保持空，不伪造）
4. 新增/修改的 daemon 与 backend 测试全绿（只跑相关测试，不跑全量）
5. ruff/eslint 对触及文件零告警
