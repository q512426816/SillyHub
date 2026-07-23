---
author: qinyi
created_at: 2026-07-23 13:40:32
---
# 验证报告 — 里程碑明细移动端整页完整复刻（2026-07-23-milestone-mobile）

## 结论

**PASS WITH NOTES**

桌面 milestone-details（3049 行三层结构 + 8 mode 表单 + 流程 + Timeline + 工作日 + 版本链 + 导入导出）已完整复刻到移动 APP UI（竖屏钻取式）。自动化测试全绿、桌面零回归、typecheck/lint/build 全绿。两条实现组织偏离（列表组件内联、Timeline/工作日/版本随 DetailDrawer 复用内置）功能等价，已记 plan.md。唯一 NOTE：真机/部署竖屏验收待做（自动化测试已覆盖核心契约）。

本变更纯前端（无 daemon/session/lease/lifecycle 关键词），非 integration/deployment-critical，PASS WITH NOTES 不降级 FAIL。

## 任务完成度

16/16 功能实现（tasks.md T-01~T-16，完成率 100%）：
- T-01 三层钻取主页 + 返回栈 ✅
- T-02 project-plans 移动入口加「里程碑」✅
- T-03 里程碑列表（内联 page.tsx）✅
- T-04 模块列表 + 新建/导入入口 ✅
- T-05 明细列表（双徽标 + 变更版标识）✅
- T-06/06a/06b 8 mode 表单（create/edit/changeInfo/view MVP + audit/approve/change/changeApprove 预留经 modeForStatus 接线）✅
- T-07 save/reject/change 流程 + 422/409 并发兜底 ✅
- T-08 Timeline（DetailDrawer 内置 processColor 染色）✅
- T-09 工作日联动（DetailDrawer 内置 recomputeComplete + addWorkingDaysDate）✅
- T-10 版本链（DetailDrawer 内置 listPsPlanNodeDetailVersions）✅
- T-11 Excel 导入 3 步（ImportModuleModal 复制抽取复用）✅
- T-12 导出（MobileExportButton + exportMilestoneDetails）✅
- T-13 权限 readOnly 总开关 + 块级（DetailDrawer 内置 baseEditable/auditEditable/changeApproveEditable + matchAnyUser）✅
- T-14 移动单测（page.test.tsx 5 用例）✅
- T-15 桌面零回归（milestone-details + ImportModuleModal 24 测试）✅
- T-16 集成验收 ⚠️（page.test.tsx 覆盖核心契约；真机/部署竖屏验收待做 — NOTE）

## 设计一致性

design.md §4.1-4.11 全节覆盖：路由+入口 / 三层钻取（竖屏）/ 8 mode 表单 / 审批流程（表单内提交）/ Timeline / 工作日联动 / 版本链 / Excel 导入 / 导出 / 权限（readOnly + 块级）/ 数据层 100% 复用 lib/ppm（21 API）。

实现组织偏离（功能等价，非 design 行为违背）：
- ① design §5 文件清单列独立组件（mobile-milestone-list/module-list/detail-list/detail-form/timeline/import-module），实际列表层内联 page.tsx（对齐 W2 已确立的内联策略，省去跨组件 props 透传）。
- ② design §4.5/4.6/4.7 的 Timeline/工作日/版本链随 W1 抽取的 DetailDrawer 复用内置（plan.md W4 关键发现已记录），非移动端独立实现。

## 探针结果

- 探针 1（未实现标记）：变更文件（components/ppm/milestone + app/m/ppm/milestone-details）TODO/FIXME/HACK/XXX 零匹配 ✅
- 探针 2（设计能力覆盖）：核心符号全在 frontend/src（modeForStatus/processColor/addWorkingDaysDate/listPsPlanNodeDetailVersions/importModulesPreview+Commit/exportMilestoneDetails/matchAnyUser/save+reject+changePlanNodeDetailProcess）✅
- 探针 3（测试覆盖）：page.test.tsx 覆盖列表渲染/readOnly/三层钻取/mode 分发核心契约 ✅
- 探针 4（decisions.md）：不存在（决策在 design 第 10 节 D-001~D-007），跳过 ✅
- 探针 5（API Contract Parity）：纯前端复用 lib/ppm 既有 21 API，后端契约未变（桌面 milestone-details 已验证），无 parity 风险 ✅

## 测试结果

- frontend 全量 vitest（test_strategy:module，本变更命中 frontend）：**passed**（1053 测试 passed / 零失败，含本变更 page.test.tsx + 桌面 milestone-details·ImportModuleModal 零回归）。
- ppm 后端 pytest（CLI 实测把 `frontend/src/components/ppm/*` 路径关联到 ppm 后端模块，本变更未改 backend）：**405 passed / 零失败**（手动 `cd backend && uv run pytest app/modules/ppm -q --no-cov` 确认，耗时 704s）。ppm 全绿只是测试量大；首次 verify 因 ppm 704s > 默认 600s timeout **超时阻断（非测试失败）**，重跑 `SILLYSPEC_TEST_TIMEOUT_MS=900000` 通过。
- typecheck（tsc --noEmit）：通过
- lint（next lint 全量）：通过（变更文件零告警，仅既有文件 no-unused-vars Warning）
- build（next build 生产构建）：绿（完整路由表输出无错误）

## 变更风险等级

**低**。纯前端增量（移动新页 + 桌面组件复制抽取），无后端 / 无 schema / 无状态机改动；桌面 page.tsx 零改动（复制抽取保桌面原定义 + 原测试）；数据层 100% 复用既有 API。

NOTE 级风险：
- DetailDrawer（桌面 antd Modal width720）/ ImportModuleModal（antd Table 预览）竖屏观感待真机验收（design R-02/R-04 点名）。
- 复制抽取漂移：import-module-modal.tsx 与桌面 page.tsx 的 ImportModuleModal 是两份，改导入逻辑需同步两处（与 W1 抽取件一致策略）。
- verify 工具行为：CLI module 命中把 `frontend/src/components/ppm/*` 关联到 ppm 后端模块，ppm 全量 405 passed 但 704s 超 600s 默认 timeout，需 `SILLYSPEC_TEST_TIMEOUT_MS=900000`（非本变更问题，记录工具行为供后续 PPM 前端变更参考）。

## Runtime Evidence

本变更非 integration/deployment-critical（纯前端 PPM 移动页，无 daemon/session/lease/lifecycle），本节不适用。自动化证据见「测试结果」（frontend 1058 passed + build 绿）。
