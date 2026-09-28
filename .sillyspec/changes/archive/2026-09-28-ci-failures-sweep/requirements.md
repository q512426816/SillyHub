---
author: flow-machine-draft
created_at: 2026-09-28T04:20:18.434Z
---
# 需求规格（Requirements）— 2026-09-28-ci-failures-sweep

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: frontend-ci 4 用例稳定失败（分身会话浮层找不到关闭按钮 ×2 / getProvide
Given 系统就绪
When frontend-ci 4 用例稳定失败（分身会话浮层找不到关闭按钮 ×2 / getProviderCaps 14vs13 键 / ChangesOvervi
Then 行为符合本条标准描述

### FR-02: daemon-ci 12 用例 60s 超时（batch runLease spawn 集成）+ r
Given 系统就绪
When daemon-ci 12 用例 60s 超时（batch runLease spawn 集成）+ runtime-handler 注册器多了 knowledge
Then 行为符合本条标准描述

### FR-03: e2e N2/N3 侧边栏导航 toBeVisible 元素找不到（含重试均失败）
Given e2e 相关模块就绪
When e2e N2/N3 侧边栏导航 toBeVisible 元素找不到（含重试均失败）
Then 行为符合本条标准描述

### FR-04: turn-control-attachment-atomic mtimeMs 0.001ms 浮点差
Given 系统就绪
When turn-control-attachment-atomic mtimeMs 0.001ms 浮点差异为 flaky（09-27 过 09-28 挂）
Then 行为符合本条标准描述

### FR-05: 上列 backend/frontend/daemon/e2e 失败用例根因定位并修复，本地仅跑相关测
Given e2e / 测试 相关模块就绪
When 上列 backend/frontend/daemon/e2e 失败用例根因定位并修复，本地仅跑相关测试通过
Then 行为符合本条标准描述

### FR-06: 修复不违背「非测试逻辑本身有误时禁止改测试通过」原则：实现 bug 修实现，测试过时
Given 测试 相关模块就绪
When 修复不违背「非测试逻辑本身有误时禁止改测试通过」原
Then ：实现 bug 修实现，测试过时

### FR-07: 平台差异修测试断言并注明依据
Given 测试 相关模块就绪
When 平台差异修测试断言并注明依据
Then 行为符合本条标准描述

### FR-08: flaky 用例（mtime 精度）改为精度容差断言，注明文件系统精度依据
Given 系统就绪
When flaky 用例（mtime 精度）改为精度容差断言，注明文件系统精度依据
Then 行为符合本条标准描述

### FR-09: 推送后四 workflow CI 转绿（或仅剩与本次无关的新失败并说明）
Given 系统就绪
When 推送后四 workflow CI 转绿（或仅剩与本次无关的新失败并说明）
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/src/components/daemon/__tests__/session-panel-team.test.tsx › SessionPanel task-14 分身会话浮层（FR-08 / design §5.E） › dialog 模式：浮层复用 SessionPanel（attach 到 sub_session_id）→ 关闭还原主控面板；page 模式用例
frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx › cursor 态 caps 门控前置事实（getProviderCaps 查表值） › 十六键与 daemon 单源一致；未知 provider 默认拒绝（boolean 全 false + dialog/sessionFork none）不抛错
frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx › ChangesOverviewCard（task-06 / 活跃变更总览） › ghost 折叠组——默认折一行（计数+跳变更中心入口），展开逐行，再点收起

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
sillyhub-daemon/tests/stats-passthrough.test.ts › task-06 / case3~case5、task-07 a/b（5 用例，waitForSpawn 替换固定一拍）
sillyhub-daemon/tests/cache-passthrough.test.ts › ndjson / stream-json provider 成功路径（2 用例）
sillyhub-daemon/tests/task-runner-budget.test.ts › task-08 budget 软切断 4 用例
sillyhub-daemon/tests/task-runner-policy-cache.test.ts › T2 claude/codex 各取各的 roots（不串扰）（waitForSpawn(10_000, 2)）
sillyhub-daemon/tests/runtime-handler.test.ts › daemon._registerRuntimeRpcHandler 注册器 › 六方法名逐字对齐（runtime.* 四键 + knowledge.* 两键）

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend/e2e/navigation.spec.ts › N2 侧边栏点击智能体会话进入 /sessions；N3 侧边栏进入智能体档案与技能管理（e2e-ci 全栈环境验证，本机无 Docker 未实证）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
sillyhub-daemon/tests/turn-control-attachment-atomic.test.ts › 同内容再写：size 相符 → 复用既有文件（mtime 不变）——亚毫秒容差断言

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/platform_sync/tests/test_thin_stage_guard.py（5 用例：thin 守卫 B + 事件归属两前提）
backend/app/modules/platform_sync/tests/test_change_deleted_guard.py（16 用例：含 archived 复活 3 用例）
backend/tests/modules/auth/test_rbac_broadcast.py › test_platform_level_grant_hit（语义反转双断言）
backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py › TestPruneSpecBackups › test_throttled_second_call_is_noop（fd 透传）
sillyhub-daemon/tests/helpers/fake-child.ts waitForSpawn 全消费方 12 文件 140 用例回归

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：过程性原则条（修复方式约束），无独立测试面——落地证据为实现侧三处修复：frontend/src/components/daemon/session-panel/worker-session-overlay.tsx aria-label 恢复、backend/app/modules/platform_sync/service.py 守卫 B 应用与复活通道恢复、其余漂移项逐处注明变更号依据

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py › TestPruneSpecBackups › test_throttled_second_call_is_noop（Linux rmtree fd 优化路径依据：shutil._rmtree_safe_fd os.scandir(topfd) 传 int fd，注释注明）

<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
sillyhub-daemon/tests/turn-control-attachment-atomic.test.ts › 同内容再写用例（utimes timespec 秒+纳秒 vs stat().mtimeMs 浮点毫秒 ≤1ms 舍入，注释注明文件系统精度依据）

<!--AGENT:测试绑定FR-09 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：CI 推送后由 GitHub Actions 四 workflow（backend-ci/frontend-ci/daemon-ci/e2e-ci）在线验证，本仓库内无对应测试文件
