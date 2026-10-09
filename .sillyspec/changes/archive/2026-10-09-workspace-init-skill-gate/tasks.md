---
author: qinyi
created_at: 2026-10-09 02:04:06
generated_by: fourpiece
---
# 任务清单（Tasks）

- [x] task-01: daemon runSillyspecInit 去 --no-skills + 门控提升 3.32.2 + run-sillyspec-init.test.ts 断言反转（spec-sync.ts / tests/run-sillyspec-init.test.ts）
- [x] task-02: daemon SILLYSPEC_VALID_TOOLS 补 zcode + 新增映射测试（task-runner/runner-types.ts / NEW:tests/sillyspec-tool-mapping.test.ts）
- [x] task-03: backend complete_lease init 回写段加成败门（失败不回写 init_synced_at）+ 失败/成功对照用例（daemon/lease/service.py / lease/tests/test_init_claim_tokens.py）
- [x] task-04: 前端创建弹窗两步状态机与自动初始化（initDispatch 串行 + 2s 轮询 + 三态 UI + 失败不回滚 + 卸载清理）+ 四用例（components/workspace-scan-dialog.tsx / components/__tests__/workspace-scan-dialog.test.tsx）(depends_on: task-03)
- [x] task-05: 前端详情页未初始化引导 Alert + 文案断言（components/workspace-config-card.tsx / components/workspace-config-card.test.tsx）
