---
author: flow-machine-draft
created_at: 2026-09-28T04:20:18.432Z
---
# 提案书（Proposal）— 2026-09-28-ci-failures-sweep

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:665aaef2ad26e58f55b7682b2ab9cf11bb8f4526020a0789080bd98556864d94:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-ci-failures-sweep 留痕重锚 -->
任务原话转写：修复近期 CI 全线失败（backend/frontend/daemon/e2e 四 workflow 红）：
- backend-ci 6 用例稳定失败（rbac 广播空集 / thin_stage_guard 409+422+stage 覆写 / soft_delete 节流 TypeError int→Path）
- frontend-ci 4 用例稳定失败（分身会话浮层找不到关闭按钮 ×2 / getProviderCaps 14vs13 键 / ChangesOverviewCard ghost 文案）
- daemon-ci 12 用例 60s 超时（batch runLease spawn 集成）+ runtime-handler 注册器多了 knowledge.action/knowledge.digest 2 方法
- e2e N2/N3 侧边栏导航 toBeVisible 元素找不到（含重试均失败）
- turn-control-attachment-atomic mtimeMs 0.001ms 浮点差异为 flaky（09-27 过 09-28 挂）

成功标准：
- 上列 backend/frontend/daemon/e2e 失败用例根因定位并修复，本地仅跑相关测试通过
- 修复不违背「非测试逻辑本身有误时禁止改测试通过」原则：实现 bug 修实现，测试过时/平台差异修测试断言并注明依据
- flaky 用例（mtime 精度）改为精度容差断言，注明文件系统精度依据
- 推送后四 workflow CI 转绿（或仅剩与本次无关的新失败并说明）
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:9e23cf2f5e002a371a443b10013053541ac34331fe5edec7e6d2bd875ef03569:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-ci-failures-sweep 留痕重锚 -->
按成功标准机械推导，共 9 条验收面：
1. frontend-ci 4 用例稳定失败（分身会话浮层找不到关闭按钮 ×2 / getProviderCaps 14vs13 键 / ChangesOverviewCard ghost 文案）
2. daemon-ci 12 用例 60s 超时（batch runLease spawn 集成）+ runtime-handler 注册器多了 knowledge.action/knowledge.digest 2 方法
3. e2e N2/N3 侧边栏导航 toBeVisible 元素找不到（含重试均失败）
4. turn-control-attachment-atomic mtimeMs 0.001ms 浮点差异为 flaky（09-27 过 09-28 挂）
5. 上列 backend/frontend/daemon/e2e 失败用例根因定位并修复，本地仅跑相关测试通过
6. 修复不违背「非测试逻辑本身有误时禁止改测试通过」原则：实现 bug 修实现，测试过时
7. 平台差异修测试断言并注明依据
8. flaky 用例（mtime 精度）改为精度容差断言，注明文件系统精度依据
9. 推送后四 workflow CI 转绿（或仅剩与本次无关的新失败并说明）
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:e685479f5bb3521b77cc34677e7d4711622a665e2f368f71711ed95d00c77f3e:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-ci-failures-sweep 留痕重锚 -->
1. frontend-ci 4 用例稳定失败（分身会话浮层找不到关闭按钮 ×2 / getProviderCaps 14vs13 键 / ChangesOverviewCard ghost 文案）
2. daemon-ci 12 用例 60s 超时（batch runLease spawn 集成）+ runtime-handler 注册器多了 knowledge.action/knowledge.digest 2 方法
3. e2e N2/N3 侧边栏导航 toBeVisible 元素找不到（含重试均失败）
4. turn-control-attachment-atomic mtimeMs 0.001ms 浮点差异为 flaky（09-27 过 09-28 挂）
5. 上列 backend/frontend/daemon/e2e 失败用例根因定位并修复，本地仅跑相关测试通过
6. 修复不违背「非测试逻辑本身有误时禁止改测试通过」原则：实现 bug 修实现，测试过时
7. 平台差异修测试断言并注明依据
8. flaky 用例（mtime 精度）改为精度容差断言，注明文件系统精度依据
9. 推送后四 workflow CI 转绿（或仅剩与本次无关的新失败并说明）
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
