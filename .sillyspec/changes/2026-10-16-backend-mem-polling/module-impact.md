# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | `backend/app/modules/knowledge/embedding_worker.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/knowledge/vector_search.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/core/config.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/spec_workspace/service.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/daemon/permission_service.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/daemon/ws_hub.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/daemon/router/gateway_misc.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/session_attachment/router.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/daemon/protocol.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/change/service.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/change_writer/proxy.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/spec_workspace/router.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/agent/model.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/migrations/versions/20261016100000_agent_session_title_fallback.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/daemon/router/session_crud.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/docker-entrypoint.sh` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/knowledge/tests/test_embedding_subprocess.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/daemon/tests/test_ws_hub.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/daemon/tests/test_permission_http_uplink.py` | <!--TODO--> | <!--TODO--> |
| backend | `backend/app/modules/daemon/tests/test_session_router.py` | <!--TODO--> | <!--TODO--> |
| deploy | `deploy/docker-compose.yml` | <!--TODO--> | <!--TODO--> |
| sillyhub-daemon | `sillyhub-daemon/src/protocol.ts` | <!--TODO--> | <!--TODO--> |
| sillyhub-daemon | `sillyhub-daemon/src/daemon.ts` | <!--TODO--> | <!--TODO--> |
| sillyhub-daemon | `sillyhub-daemon/src/config.ts` | <!--TODO--> | <!--TODO--> |
| sillyhub-daemon | `sillyhub-daemon/tests/protocol.contract.test.ts` | <!--TODO--> | <!--TODO--> |
| sillyhub-daemon | `sillyhub-daemon/tests/config.test.ts` | <!--TODO--> | <!--TODO--> |
| sillyhub-daemon | `sillyhub-daemon/tests/daemon-change-write-push.test.ts` | <!--TODO--> | <!--TODO--> |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `.zcode/skills/deploy-to-server/SKILL.md` <!--TODO: 归属判定-->

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新backend模块卡（本次变更涉及） | pending |
| `modules/deploy.md` | 更新deploy模块卡（本次变更涉及） | pending |
| `modules/sillyhub-daemon.md` | 更新sillyhub-daemon模块卡（本次变更涉及） | pending |
| `_module-map.yaml` | <!--TODO: 有未匹配文件，判定模块索引是否需增改（modules rebuild）--> | pending |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
