# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| daemon | `sillyhub-daemon/src/daemon.ts` | 接口变更（SillySpecCommandExecutor 新增可选执行器成员 runSyncChange）+ 调用关系变更（新增 sillyspec_sync_change RPC handler 注册与 15s 防抖/in-flight 去重实例 Map） | 否（既有十三 host_fs.* 方法与 SILLYSPEC_* 消息分支零改动；既有 sillyspec 系 94 测试全绿） |
| sillyspec-manager | `sillyhub-daemon/src/sillyspec-manager.ts` | 新增（runSyncChange 执行器 + SillySpecSyncChangeAction/Result 类型；复用既有 _resolveWorkspaceRoot/_resolveSillySpecBin/_execSillySpecCli 基建，不碰结果槽通道） | 否（runResolve/runGhostCleanup/runTombstoneCleanup 零改动） |
| change（backend，未匹配按归属判定补录） | `backend/app/modules/change/router.py` | 调用关系变更（list_change_files 前插 _sync_change_via_daemon 四路静默降级前置；私有新函数；响应模型/路由签名不变，service.list_files 零改动） | 否（test_files_router 15 绿回归） |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/change/router.py` 归属判定：backend/change 模块（与 modules/backend.md 或 change 模块卡对应；module-map 未收录 change 模块 paths，属索引覆盖缺口，不影响本变更——归属明确无歧义）
- `backend/app/modules/change/tests/test_files_refresh_sync.py` 归属判定：backend/change 模块测试（新增，随上条同归属）
- `sillyhub-daemon/tests/sillyspec-sync-change-rpc.test.ts` 归属判定：daemon 模块测试（新增，随 daemon 模块同归属）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/sillyhub-daemon.md` | 更新 sillyhub-daemon 模块卡变更索引（本变更归属卡；archive 步已真实补录索引行） | done |
| `modules/sillyspec-manager.md` | 无独立模块卡——sillyspec-manager.ts 归属 sillyhub-daemon 卡域，变更已随该卡索引行补录 | skipped（归并上行动作，不单独建卡） |
| `_module-map.yaml` | 有未匹配文件，判定模块索引是否需增改（modules rebuild） | skipped（backend/change 与两测试文件归属明确，module-map 补录留给后续索引维护变更；本变更不扩索引面） |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
