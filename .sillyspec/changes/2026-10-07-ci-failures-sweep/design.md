---
author: flow-machine-draft
created_at: 2026-10-07T15:08:47.462Z
---
# 设计记录（Design Record）— 2026-10-07-ci-failures-sweep

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

main 上 backend-ci 5 用例 + frontend-ci 3 用例失败，逐一核对生产契约后确认全部为测试侧债（生产代码零改动）：①迁移链尾锚测试自带「新迁移接续后锚前移」约定（测试注释原文），20261006200000 成为新 head 后锚未随动——更新锚与注释；②test_files_router fixture 取 items[0] 依赖 updated_at desc 排序，fixture 内归档 change（目录在 changes/archive/ 子树）在 CI Linux 同刻 mtime 下稳定排首，拼 changes/<key>/ 写 watcher-events.jsonl FileNotFoundError——fixture 固定选取 location=="active" 行；③群装配用例 member 夹具缺 D-003 新增的 config_snapshot 属性——补属性并顺势断言 model_name 透传/None 兜底两形态；④归档守卫用例断言停留在已退役的懒激活分支语义——改断言现行 409 TOOL_REPORT_TAKEOVER_INVALID，docstring 注明写入口兜底链。选测试侧修复而非改生产：每处均有生产侧契约依据（后端 schema/查表实态/特性 docstring），属规则 9 允许的「测试逻辑/夹具过时」情形。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无对外接口变化（纯测试侧修复，生产代码零行改动）。测试夹具契约对齐四处：fixture workspace_with_changes 返回值固定取活跃 change；group 装配用例 member SimpleNamespace 补 config_snapshot 形态（dict/None 两档）；caps 全对象断言恢复 16 键（含 multimodal）；listProviders mock 补必填 agent_kinds。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用——不涉及事件流；FR-02 的 fixture 选活跃行改为显式 location 过滤后，列表任何排序下行为一致。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用——测试修复不触碰并发路径；attachment_pipeline 群装配用例本身即在验证 gate 解析的串行契约。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

不适用——无运行时状态变化；迁移锚更新仅静态断言当前链尾（单 head 结构测试）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不适用——修复全部落在单仓测试文件内，不涉及跨工作区数据。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：test_files_router 若未来 fixture 只剩归档 change，next(... location=="active") 会 StopIteration——但两活跃 change 是 fixture 固定资产，风险极低。试过放弃：为 FR-04 新增 takeover 端点归档 409 端到端用例——放弃，takeover 前置校验链（原机四级钉定/provider 行解析）夹具过重，且其写入口经 create 链已被 test_session_create_on_archived_returns_409 的 ensure_writable 守卫用例覆盖，加重复用例只增脆弱面。
