---
author: flow-machine-draft
created_at: 2026-10-13T15:10:14.439Z
---
# 需求规格（Requirements）— 2026-10-13-change-reparse-autobind-remove

## 功能需求

### FR-01: reparse 首次创建变更行（created）不再写任何 change_session_links，即使工作区存在最近活跃会话

- reparse 首次创建变更行（created）时**必须**不写任何 change_session_links 行；变更与会话的绑定**必须**唯一来自命令解析通道（会话内实际执行 `sillyspec run/flow --change <名>` 命令，经 extract_spec_bindings → bind_session_to_change）。

#### 场景：主路径

- Given：工作区存在最近活跃会话（coalesce(last_active_at, created_at) 最新），且磁盘出现新变更目录（镜像同步/新建）
- When：reparse 执行并 created 该变更行
- Then：change_session_links 中该变更对应的行为 0

### FR-02: _bind_change_to_session 方法及其唯一调用点删除，无死代码残留

- ChangeService._bind_change_to_session 方法及其在 reparse created 分支的唯一调用点**必须**删除；backend/app 源码内**禁止**残留对该方法的任何引用（注释/文案引用一并清理）。

#### 场景：主路径

- Given：本变更合并后的代码库
- When：全仓检索 `_bind_change_to_session`
- Then：backend/app 源码（含测试）零命中，仅历史归档文档允许留存

### FR-03: reparse docstring 与 .sillyspec/docs/backend/modules/change.md、_module-map.yaml 中「自动绑定最近活跃会话」描述同步更新

- 三处描述**必须**同步改为「created 不产生会话绑定」口径；**禁止**注释/文档与实现不一致的残留（CLAUDE.md 规则 18）。

#### 场景：主路径

- Given：FR-01/FR-02 改动完成
- When：读取 reparse docstring、change.md 关键逻辑段、_module-map.yaml reparse 符号注释
- Then：均无「自动绑定最近活跃会话」表述

### FR-04: 既有命令解析通道绑定行为不变（test_spec_binding.py 全绿）

- 命令解析通道（extract_spec_bindings / bind_session_to_change，run_sync 与 agent-logs 两分支）行为**必须**不变；test_spec_binding.py 全部用例**必须**零逻辑改动通过（仅允许 docstring 文案引用修正）。

#### 场景：主路径

- Given：会话内执行含 `sillyspec flow start --change <名>` 的命令
- When：命令解析通道触发绑定
- Then：change_session_links 照常写入（既有用例断言不变全绿）

### FR-05: test_change_session_binding.py 重写为断言新行为：存在最近活跃会话时 reparse created 仍零 link，重复 reparse 仍零 link

- test_change_session_binding.py **必须**重写为新行为断言：工作区存在最近活跃会话时，全量 reparse created 后零 link、重复 reparse（updated）后仍零 link、scoped reparse created 同样零 link；并**必须**含已删方法防复活守卫（ChangeService 不再拥有 _bind_change_to_session 属性）。

#### 场景：主路径

- Given：预置最近活跃会话 + 新变更目录
- When：reparse 执行三次（全量首次 / 全量重复 / scoped 新目录）
- Then：三次执行后该变更 link 数均为 0

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/change/tests/test_change_session_binding.py「test_reparse_created_writes_no_session_link」
FR-02: backend/app/modules/change/tests/test_change_session_binding.py「test_bind_change_to_session_removed」
FR-03: 不适用：文档/docstring 描述同步由收口文档面与评审校验，无运行时行为可测
FR-04: backend/app/modules/change/tests/test_spec_binding.py「既有全部用例回归零改动通过」
FR-05: backend/app/modules/change/tests/test_change_session_binding.py「test_reparse_repeat_and_scoped_still_no_link」
