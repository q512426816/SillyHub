---
author: sillyspec-fr-index
created_at: 2026-10-15T08:08:39.731Z
---

# FR 索引 — deploy

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/deploy.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-auto-claude-001 onlyoffice-restore-fonts.sh 两处 tar 解包 docker exec 与同文件既有调用一致带 MSYS_NO_PATHCONV=1，Git Bash 下路径参数不再被 MSYS 改写
变更：2026-10-09-msys-fonts-guard
状态：active
摘要：Git Bash 下字体恢复不再中断
全文：.sillyspec/changes/archive/2026-10-09-msys-fonts-guard/requirements.md#FR-01
最近确认：f8f068a1fa86fad636f25df52ea68838e7b1c73b

## FR-auto-claude-002 .claude/skills/sillyhub-docker-deploy/SKILL.md 与 .codex 副本同步为 .zcode 现行版内容（claude-data 卷/claude --version 等退役面描述消除）
变更：2026-10-09-msys-fonts-guard
状态：active
摘要：三副本一致
全文：.sillyspec/changes/archive/2026-10-09-msys-fonts-guard/requirements.md#FR-02
最近确认：f8f068a1fa86fad636f25df52ea68838e7b1c73b

## FR-auto-claude-003 shell 语法门通过（bash -n），无其它回归面（脚本其余行零改动）
变更：2026-10-09-msys-fonts-guard
状态：active
摘要：最小改动面
全文：.sillyspec/changes/archive/2026-10-09-msys-fonts-guard/requirements.md#FR-03
最近确认：f8f068a1fa86fad636f25df52ea68838e7b1c73b

## FR-auto-deploy-001 回显命令经 sh -c 传路径（MSYS 安全），grep 模式兼容 "version": 与 "version":两种形态
变更：2026-10-08-deploy-script-version-echo-msys
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-deploy-script-version-echo-msys/requirements.md#FR-01
最近确认：45240ef8baaa17b5f1cb4c03bc262ee0a4244a9e

## FR-auto-deploy-002 本地实跑 docker run 回显 3.32.1 成功
变更：2026-10-08-deploy-script-version-echo-msys
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-deploy-script-version-echo-msys/requirements.md#FR-02
最近确认：45240ef8baaa17b5f1cb4c03bc262ee0a4244a9e

## FR-deploy-001 build-and-save.sh 打包前必须校验当前分支为 main（非 main 时告警并需 ALLOW_NON_MAIN_DEPLOY=1 显式放行），并打印将要打包的 commit hash 与分支供留痕
变更：2026-10-16-deploy-convergence-guard
状态：active
摘要：主路径；非 main 分支
场景正文：
- 场景：主路径 — Given 主仓处于 main 分支且应用目录干净；When 执行 build-and-save.sh；Then 必须打印打包源分支与 short-sha 后继续构建
- 场景：非 main 分支 — Given 当前分支不是 main；When 执行 build-and-save.sh 且未设 ALLOW_NON_MAIN_DEPLOY；Then 必须打印「非 main 覆盖部署会回退主线修复」告警并退出（exit 非 0）
全文：.sillyspec/changes/archive/2026-10-16-deploy-convergence-guard/requirements.md#FR-01
最近确认：d581d40b43ea8078957e915ff68709fb9f082b94

## FR-deploy-002 deploy-to-server skill 必须新增「部署并流校验」节：打包前基于 main 校验、部署后 health commit_sha 与打包一致核对（不一致=被覆盖，附识别与恢复路径）
变更：2026-10-16-deploy-convergence-guard
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 部署 agent 阅读 deploy-to-server skill；When 按 skill 执行更新部署；Then 必须能在 §0 看到并执行「打包前 main 校验 + 部署后 commit_sha 核对」两个动作
全文：.sillyspec/changes/archive/2026-10-16-deploy-convergence-guard/requirements.md#FR-02
最近确认：d581d40b43ea8078957e915ff68709fb9f082b94

## FR-deploy-003 skill 中过期的 PROD_API_URL 示例必须更新为当前生产值 https://crrcdt.ppdmq.top
变更：2026-10-16-deploy-convergence-guard
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given agent 复制 skill 的打包命令；When 执行该命令；Then 前端 build-arg 必须指向 crrcdt.ppdmq.top（而非失效的 192.168.0.143）
全文：.sillyspec/changes/archive/2026-10-16-deploy-convergence-guard/requirements.md#FR-03
最近确认：d581d40b43ea8078957e915ff68709fb9f082b94

## FR-deploy-004 pi 会话/预会话下供应商控件显示按引擎（agent_kinds）过滤后的默认供应商名，无引擎匹配默认时显示「本机默认」而非 claude/codex 供应商名
变更：2026-10-28-session-config-default-provider-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-28-session-config-default-provider-fix/requirements.md#FR-01
最近确认：04d4ae8d7a510ebb8293790905b49dcce63d4fb3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-session-config-default-provider-fix:flow:测试绑定FR-01
  tests: frontend/src/lib/api/__tests__/llm-providers.test.ts「engine 参数：默认供应商覆盖引擎 → 其名；不覆盖（跨引擎默认）→ 『不指定（本机默认）』」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-session-config-default-provider-fix
  status: active

## FR-deploy-005 未显式选供应商但存在引擎匹配的默认供应商时模型下拉渲染且候选跟随该供应商模型列表，显式选择行为与请求载荷不变（不新增 llm_provider_id 上送）
变更：2026-10-28-session-config-default-provider-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-28-session-config-default-provider-fix/requirements.md#FR-02
最近确认：04d4ae8d7a510ebb8293790905b49dcce63d4fb3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-session-config-default-provider-fix:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/session-config-bar.test.tsx「claude 会话未显式选供应商 + 引擎匹配默认存在 → 模型下拉渲染，『不指定』项保持当前高亮（显示层回退不改选择语义）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-session-config-default-provider-fix
  status: active

## FR-deploy-006 工作区弹窗（dialog 模式）新建会话首句携带用户填写的模型值（有值才带，空值零回归）
变更：2026-10-28-session-config-default-provider-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-28-session-config-default-provider-fix/requirements.md#FR-03
最近确认：04d4ae8d7a510ebb8293790905b49dcce63d4fb3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-28-session-config-default-provider-fix:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx「model prop 为 null → createSession 载荷不带 model 键（空值零回归）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-28-session-config-default-provider-fix
  status: active

## FR-deploy-007 session-config-bar 与 session-panel-dialog 相关既有测试不回归，新增用例覆盖上述三点
变更：2026-10-28-session-config-default-provider-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-28-session-config-default-provider-fix/requirements.md#FR-04
最近确认：04d4ae8d7a510ebb8293790905b49dcce63d4fb3

## FR-deploy-008 排队派发链路核查：运行中暂存配置随排队消息派发时生效（reloadWithConfig 先重载后喂消息），与用户期望「agent 接收到新消息时切换」一致，结论落档不改动切换时序
变更：2026-10-28-session-config-default-provider-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-28-session-config-default-provider-fix/requirements.md#FR-05
最近确认：04d4ae8d7a510ebb8293790905b49dcce63d4fb3
