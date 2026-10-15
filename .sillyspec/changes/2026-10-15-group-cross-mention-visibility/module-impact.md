# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| api-types | `sillyhub-daemon/src/api-types.ts` | <!--TODO--> | <!--TODO--> |
| lib-api | `frontend/src/lib/api-types.ts` | <!--TODO--> | <!--TODO--> |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/agent/model.py` <!--TODO: 归属判定-->
- `backend/migrations/versions/<rev>_add_group_cross_mention_mode.py` <!--TODO: 归属判定-->
- `backend/app/modules/agent/schema.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/group/router.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/group/service/helpers.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/group/service/mentions.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/run_sync/service/group_bridge.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/group/service/delegation_notice.py` <!--TODO: 归属判定-->
- `backend/app/modules/agent/tests/test_group_chat_models.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/tests/test_group_cross_mention.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/tests/test_group_bridge_projection.py` <!--TODO: 归属判定-->
- `frontend/src/components/group-chat/member-panel.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/group-chat/create-group-wizard.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/group-chat/__tests__/member-panel.test.tsx` <!--TODO: 归属判定-->
- `backend/openapi.json` <!--TODO: 归属判定-->

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/api-types.md` | 更新api-types模块卡（本次变更涉及） | pending |
| `modules/lib-api.md` | 更新lib-api模块卡（本次变更涉及） | pending |
| `_module-map.yaml` | <!--TODO: 有未匹配文件，判定模块索引是否需增改（modules rebuild）--> | pending |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
