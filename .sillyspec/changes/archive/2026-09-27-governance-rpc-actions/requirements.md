---
author: flow-machine-draft
created_at: 2026-09-27T12:01:05.918Z
---
# 需求规格（Requirements）— 2026-09-27-governance-rpc-actions

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: daemon 新增 knowledge.digest RPC（RuntimeHandler 同款 s
Given 系统就绪
When daemon 新增 knowledge.digest RPC（RuntimeHandler 同款 spawn 模式：root_path 三道校验
Then cwd=仓库根跑 sillyspec knowledge digest --json，stdout JSON 透传

### FR-02: 缓存回退读点时降级跑——绑定信号随 cwd 缺工作树自然缺席）与 knowledge.action 
Given 系统就绪
When 缓存回退读点时降级跑——绑定信号随 cwd 缺工作树自然缺席）与 knowledge.action RPC（kind 白名单 repair-paths
Then 行为符合本条标准描述

### FR-03: redomain
Given 系统就绪
When redomain
Then 行为符合本条标准描述

### FR-04: 域名参数过 [a-z0-9-]+ 元字符防线）
Given 系统就绪
When 域名参数过 [a-z0-9-]+ 元字符防线）
Then 行为符合本条标准描述

### FR-05: backend governance 端点 RPC 优先（workspace 绑定 daemon 在
Given 端点 相关模块就绪
When backend governance 端点 RPC 优先（workspace 绑定 daemon 在线时直采 digest JSON 透传，含绑定信号），dae
Then 行为符合本条标准描述

### FR-06: POST /knowledge/governance/actions（KNOWLEDGE_WRITE
Given 系统就绪
When POST /knowledge/governance/actions（KNOWLEDGE_WRITE）：kind+params
Then RPC 执行

### FR-07: 伪域信号增 domains:[{name,count}] 数组供逐域迁移按钮
Given 迁移 相关模块就绪
When 伪域信号增 domains:[{name,count}] 数组供逐域迁移按钮
Then 行为符合本条标准描述

### FR-08: frontend：坏绑定卡[执行 repair]按钮、伪域卡逐域[迁移到…输入目标域]按钮，muta
Given 迁移 相关模块就绪
When frontend：坏绑定卡[执行 repair]按钮、伪域卡逐域[迁移到…输入目标域]按钮，mutation 后 refetch
Then 行为符合本条标准描述

### FR-09: daemon 离线时按钮降隐藏（本地计算模式无动作能力）
Given 系统就绪
When daemon 离线时按钮降隐藏（本地计算模式无动作能力）
Then 行为符合本条标准描述

### FR-10: daemon vitest（digest 透传/动作白名单/元字符拒）+ backend pytes
Given 端点 / 组件 / 测试 相关模块就绪
When daemon vitest（digest 透传/动作白名单/元字符拒）+ backend pytest（RPC 优先/回退/动作端点）+ frontend 组件
Then 行为符合本条标准描述

### FR-11: 显式 pathspec 提交
Given 系统就绪
When 显式 pathspec 提交
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
sillyhub-daemon/tests/knowledge-governance-handler.test.ts「digest 成功」（CLI JSON 信封透传 + cwd=仓库根断言）

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：降级语义属性——由 FR-05 的回退用例覆盖（绑定缺席→source=local）；daemon 侧缓存回退场景属运行时读点选择，handler 测试注入 cwd 覆盖

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
handler 测试「redomain 域名合法透传」（--from/--to/--write 命令串断言）

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
handler 测试「元字符/大小写拒」+「root_path 元字符→forbidden」（sillyspecCmd 未被调用断言）

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
backend test_governance.py test_governance_local_fallback_marks_source（RPC 尝试失败→回退本地，source=local/actions_available=false）

<!--AGENT:测试绑定FR-06 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
test_governance.py test_action_rejects_unknown_kind / test_action_rejects_bad_redomain_domains（422 校验）+ test_action_requires_write_permission（权限门后进入执行层）

<!--AGENT:测试绑定FR-07 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：本轮实现以 signal.detail 首词解析域名（组件内 firstDomain），未增 domains 数组——按钮可用性由组件测试覆盖，结构化 domains 数组留 v3（design 已披露差异）

<!--AGENT:测试绑定FR-08 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
frontend governance-cards.test.tsx「v2 actions_available 时伪域卡渲染迁移按钮」（输入目标域+fireEvent 触发→actionMocked 断言 from/to 参数）

<!--AGENT:测试绑定FR-09 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
同文件「local 模式不渲染动作按钮」（queryByTestId null 断言）

<!--AGENT:测试绑定FR-10 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
不适用：汇总面——daemon 7 用例 + backend 8 用例（模块回归 136 passed）+ frontend 5 用例，三模块 tsc/typecheck 0 错（提交信息与 EXP 在案）

<!--AGENT:测试绑定FR-11 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
提交 330646058 git show --stat 核实：11 个交付文件+变更目录，零夹带（他会话 42 条 staged 原样保留）
