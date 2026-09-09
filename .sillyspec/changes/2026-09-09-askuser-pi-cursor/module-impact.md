# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `sillyhub-daemon/src/interactive/pi-rpc-driver.ts` <!--TODO: 归属判定-->
- `sillyhub-daemon/src/interactive/session-manager/driver-factory.ts` <!--TODO: 归属判定-->
- `sillyhub-daemon/src/interactive/session-manager.ts` <!--TODO: 归属判定-->
- `sillyhub-daemon/src/interactive/providers.ts` <!--TODO: 归属判定-->
- `sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts` <!--TODO: 归属判定-->
- `backend/app/modules/agent/provider_caps.py` <!--TODO: 归属判定-->
- `backend/app/modules/agent/tests/test_provider_caps_alignment.py` <!--TODO: 归属判定-->
- `backend/app/modules/daemon/permission_service.py` <!--TODO: 归属判定-->
- `NEW:frontend/src/lib/askuser-marker.ts` <!--TODO: 归属判定-->
- `NEW:frontend/src/components/ask-user-marker-card.tsx` <!--TODO: 归属判定-->
- `frontend/src/lib/provider-caps.ts` <!--TODO: 归属判定-->
- `frontend/src/components/daemon/turn-timeline.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/ask-user-dialog-card.tsx` <!--TODO: 归属判定-->
- `frontend/src/components/group-chat/group-chat-panel.tsx` <!--TODO: 归属判定-->
- `NEW:frontend/src/components/group-chat/__tests__/group-askuser-aggregate.test.tsx` <!--TODO: 归属判定-->
- `NEW:frontend/src/lib/__tests__/askuser-marker.test.ts` <!--TODO: 归属判定-->

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无新增顶层模块/目录——全部改动落在既有模块文件内（askuser-marker.ts 入 frontend lib、marker 卡入 frontend components、桥接入 daemon interactive），_module-map 无需增改 | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
