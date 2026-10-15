# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| api-types | `sillyhub-daemon/src/api-types.ts` | 接口变更（GroupChatRead/Create/Update 加 cross_mention_mode，gen:types 同源再生成） | done（规则 21 daemon 义务，随 task-04 提交 fbfc10056） |
| lib-api | `frontend/src/lib/api-types.ts` | 接口变更（同上，前端侧同源再生成） | done（随 task-04 提交） |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/agent/model.py` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：数据结构变更（AgentGroupChat 加列 cross_mention_mode））
- `backend/migrations/versions/<rev>_add_group_cross_mention_mode.py` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：数据结构变更（迁移 20261015120000，实际文件名 20261015120000_add_group_cross_mention_mode.py——NEW: 占位名与实际名差异，无实质影响））
- `backend/app/modules/agent/schema.py` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：接口变更（GroupChatCreate/Update/Read 三 DTO 加字段））
- `backend/app/modules/daemon/group/router.py` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：无改动（design 初稿列入、execute 期确认读体经基类 model_validate 自动透出，实际零 diff——对账 undeclared 空转））
- `backend/app/modules/daemon/group/service/helpers.py` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：新增（ROLE_PROMPT_AGENT_PUBLIC 常量））
- `backend/app/modules/daemon/group/service/mentions.py` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：逻辑变更（互@触发三态分流 D-011））
- `backend/app/modules/daemon/run_sync/service/group_bridge.py` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：逻辑变更（ctx 识别 agent_public/delegation_of/收口钩子轻通知挂接））
- `backend/app/modules/daemon/group/service/delegation_notice.py` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：新增（轻注入纯日志 helper））
- `backend/app/modules/agent/tests/test_group_chat_models.py` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：逻辑变更（迁移四断言+DTO 契约+字段集/默认更新+钉子锚））
- `backend/app/modules/daemon/tests/test_group_cross_mention.py` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：逻辑变更（TestCrossMentionModeRouting 四用例））
- `backend/app/modules/daemon/tests/test_group_bridge_projection.py` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：逻辑变更（TestPublicDelegation 六用例））
- `frontend/src/components/group-chat/member-panel.tsx` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：逻辑变更（群设置区互@模式控件三态联动））
- `frontend/src/components/group-chat/create-group-wizard.tsx` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：逻辑变更（向导第三步模式可选项默认 private））
- `frontend/src/components/group-chat/__tests__/member-panel.test.tsx` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：逻辑变更（三态联动四用例+makeGroup 字段））
- `backend/openapi.json` → 归属：backend 群聊子域 / frontend 群聊组件（module-map 未建群聊模块条目，索引粒度按子项目级——非索引过期；影响：接口变更（gen:types 副产物））

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/api-types.md` | 更新api-types模块卡（本次变更涉及） | done（gen:types 再生成为机械产物，模块卡描述的再生成流程未变，无需改卡） |
| `modules/lib-api.md` | 更新lib-api模块卡（本次变更涉及） | done（同上） |
| `_module-map.yaml` | 未匹配文件均为群聊子域文件（backend daemon/group 子域+frontend group-chat 组件），module-map 按子项目级粒度索引、无群聊模块条目——群聊功能跨 2026-09 起多个变更均未建模块条目，维持现状不为本变更单建（modules rebuild 留给群聊模块化整理时统一处理） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
