# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| sillyhub-daemon | interactive/pi-rpc-driver.ts | 逻辑变更（四方法桥接+挂起表+denormalize+兜底） | 是（Grill/QA 已审） |
| sillyhub-daemon | interactive/session-manager/driver-factory.ts | 逻辑变更（sessionPermission 注入扩 pi） | 是 |
| sillyhub-daemon | interactive/providers.ts | 接口变更（caps dialog string 键；pi permission_dialog 翻 true） | 是 |
| sillyhub-daemon | tests/interactive/pi-rpc-driver.test.ts | 新增（四态 22 用例） | 否 |
| backend | daemon/permission_service.py | 逻辑变更（影子答题授权放开+answered_by+SSE 契约） | 是（9 越权反例） |
| backend | agent/provider_caps.py + 对齐测试 | 接口变更（dialog 键镜像+解析器扩展） | 否 |
| backend | daemon/tests/test_session_permissions.py | 新增（影子授权 9 例） | 否 |
| frontend | lib/askuser-marker.ts（NEW） | 新增（标记解析器 31 用例） | 否 |
| frontend | components/ask-user-marker-card.tsx（NEW） | 新增（marker 卡 18 用例） | 否 |
| frontend | components/daemon/turn-timeline.tsx | 逻辑变更（双路径 marker 渲染+已答判定） | 是 |
| frontend | components/ask-user-dialog-card.tsx | 逻辑变更（推荐条+已答关闭态） | 否 |
| frontend | components/group-chat/group-chat-panel.tsx | 逻辑变更（聚合+marker 卡+先到先得） | 是 |
| frontend | lib/provider-caps.ts + session-sse.ts + sessions.ts | 接口变更（dialog 镜像；answered_by_actual_user 透传） | 否 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `sillyhub-daemon/src/interactive/pi-rpc-driver.ts` → sillyhub-daemon（interactive）
- `sillyhub-daemon/src/interactive/session-manager/driver-factory.ts` → sillyhub-daemon（session-manager 包）
- `sillyhub-daemon/src/interactive/session-manager.ts` → 声明未交付（task-08 挂起，无实际改动）
- `sillyhub-daemon/src/interactive/providers.ts` → sillyhub-daemon（interactive）
- `sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts` → sillyhub-daemon（tests）
- `backend/app/modules/agent/provider_caps.py` → backend（agent）
- `backend/app/modules/agent/tests/test_provider_caps_alignment.py` → backend（agent 测试）
- `backend/app/modules/daemon/permission_service.py` → backend（daemon）
- `NEW:frontend/src/lib/askuser-marker.ts` → frontend（lib）
- `NEW:frontend/src/components/ask-user-marker-card.tsx` → frontend（components）
- `frontend/src/lib/provider-caps.ts` → frontend（lib）
- `frontend/src/components/daemon/turn-timeline.tsx` → frontend（components/daemon）
- `frontend/src/components/ask-user-dialog-card.tsx` → frontend（components）
- `frontend/src/components/group-chat/group-chat-panel.tsx` → frontend（components/group-chat）
- `NEW:frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx` → frontend（group-chat 测试）
- `NEW:frontend/src/lib/__tests__/askuser-marker.test.ts` → frontend（lib 测试）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无新增顶层模块/目录——全部改动落在既有模块文件内（askuser-marker.ts 入 frontend lib、marker 卡入 frontend components、桥接入 daemon interactive），_module-map 无需增改 | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
