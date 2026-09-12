# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/agent/model.py` <!--归属 agent 域（AgentGroupChat 实体两列+共识任务表，2026-09-10 变更）-->
- `backend/migrations/versions/20260910130000_group_consensus.py` <!--归属 backend 迁移（daemon-group 共识状态机落库，跨域唯一落点）-->
- `backend/app/modules/agent/schema.py` <!--归属 agent 域（GroupChatCreate/Patch consensus 字段）-->
- `backend/app/modules/daemon/group/service/helpers.py` <!--归属 daemon 域 group 子域-->
- `backend/app/modules/daemon/group/service/messages.py` <!--归属 daemon 域 group 子域-->
- `backend/app/modules/daemon/group/service/mentions.py` <!--归属 daemon 域 group 子域-->
- `backend/app/modules/daemon/group/service/shadow.py` <!--归属 daemon 域 group 子域-->
- `backend/app/modules/daemon/group/service/consensus.py` <!--归属 daemon 域 group 子域（本变更新建）-->
- `backend/app/modules/daemon/run_sync/service/group_bridge.py` <!--归属 daemon 域 run_sync 子域（投影拦截）-->
- `backend/app/modules/daemon/run_sync/service/submit_steps.py` <!--归属 daemon 域 run_sync 子域-->
- `backend/app/main.py` <!--归属 backend 入口（lifespan 挂载 consensus-sweeper）-->
- `backend/app/modules/daemon/tests/test_group_consensus.py` <!--归属 daemon 域测试（本变更新建）-->
- `backend/app/modules/daemon/tests/test_group_cross_mention.py` <!--快照残留——最终 diff 未改动该文件（存量用例覆盖）-->
- `backend/app/modules/daemon/tests/test_group_mention_pipeline.py` <!--快照残留——最终 diff 未改动该文件（存量用例覆盖）-->
- `frontend/src/lib/api-types.ts` <!--归属 frontend API 类型-->
- `frontend/src/components/group-chat/create-group-wizard.tsx` <!--归属 frontend 群聊组件-->
- `frontend/src/components/group-chat/member-panel.tsx` <!--归属 frontend 群聊组件-->
- `frontend/src/components/group-chat/group-chat-panel.tsx` <!--归属 frontend 群聊组件-->
- `frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx` <!--归属 frontend 群聊组件测试-->
- `frontend/src/components/group-chat/__tests__/member-panel.test.tsx` <!--归属 frontend 群聊组件测试-->

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | <!--判定：模块索引无需 rebuild——未匹配项均为既有域内文件（module-map paths 粒度未细到 group/service 子目录与 migrations），归属判定已逐行标注；无游离新模块--> | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
