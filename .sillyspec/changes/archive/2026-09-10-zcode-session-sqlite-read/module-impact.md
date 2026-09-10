# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

骨架未匹配系 CLI 对 `NEW:` 前缀的匹配缺陷——根 _module-map.yaml 实有 `sillyhub-daemon/**`（:68-72）与 `backend/**`（:37）paths，七文件全部命中既有模块，无需 rebuild。归属判定（影响类型以 worktree 实际 diff 为准）：

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| sillyhub-daemon（细卡 SillyHub/modules/daemon.md） | sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts | 新增（zcode SQLite 读取器：提取函数/fixture/归一化/窗口） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/agent-log/read-zcode-sqlite.test.ts | 新增（20 用例） | 否 |
| sillyhub-daemon | sillyhub-daemon/tests/agent-log/zcode-sqlite-dispatch.test.ts | 新增（分派四态+守卫 6 用例） | 否 |
| sillyhub-daemon | sillyhub-daemon/src/host-fs-handler.ts | 逻辑变更（readAgentLogMessages 内部 zcode 先库后文件分派，签名/响应形状/RPC 映射不变） | 否 |
| sillyhub-daemon | sillyhub-daemon/package.json（+pnpm-lock.yaml） | 配置变更（devDep @types/node 20.14.0→22.13.0，engines 不动） | 否 |
| backend（细卡 backend/modules/platform_sync.md） | backend/app/modules/platform_sync/router.py | 逻辑变更（content 端点 zcode 分支：messages RPC 合成伪 jsonl+回落 read_file，响应模型/_send_agent_log_rpc 不变） | 否 |
| backend | backend/app/modules/platform_sync/tests/test_agent_log_content.py | 新增（11 用例）+既有 17 零改动 | 否 |

## 未匹配文件

（无——见上矩阵判定说明）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无需 rebuild——七文件均落既有 sillyhub-daemon/backend 模块 paths（骨架未匹配为 NEW: 前缀匹配缺陷，非索引过期） | skipped |
| `docs/SillyHub/modules/daemon.md` | agent-log 节补 read-zcode-sqlite 读取器与先库后文件分派（含测试基建/回落语义） | done |
| `docs/backend/modules/platform_sync.md` | content 端点行补 zcode 分支（伪 jsonl 合成不截断+回落） | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
