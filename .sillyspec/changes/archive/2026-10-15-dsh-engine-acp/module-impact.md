# 模块影响分析（骨架由 `sillyspec module-impact --change <变更名>` 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| daemon（sillyhub-daemon） | sillyhub-daemon/src/interactive/dsh-acp-driver.ts（新增 532 行：ACP v1 驱动） | 新增 | 否（task-03 单测 14 用例 + 冒烟守卫） |
| daemon | sillyhub-daemon/src/interactive/dsh-acp-events.ts（新增：通知归一化器） | 新增 | 否（13 用例钉 ACP spec 样例映射） |
| daemon | sillyhub-daemon/src/dsh-settings.ts（新增：DSH_HOME patch 写盘器 + env 注入器） | 新增 | 否（9 用例含密钥不落盘断言） |
| daemon | sillyhub-daemon/src/interactive/providers.ts（caps dsh 16 键 + 注册条目 + 联合扩展） | 数据结构变更 + 配置变更 | 否（registry/adapter 守护测试同步，50 用例） |
| daemon | sillyhub-daemon/src/agent-detector.ts + version.ts（第 13 探测项 + MIN_VERSIONS） | 配置变更 | 否（探测/版本门用例） |
| daemon | sillyhub-daemon/src/interactive/session-manager/driver-factory.ts（sessionPermission 注入条件 +dsh，6 行） | 调用关系变更 | 否（D-006 边界合并裁决） |
| daemon | sillyhub-daemon/scripts/gen-provider-caps.mjs（ENGINES 五引擎） | 配置变更 | 否（三端镜像已刷新） |
| agent（backend） | backend/app/modules/agent/provider_caps.py + tests（生成物 + EXPECTED 五引擎） | 配置变更（生成物） | 否（对齐测试 5 用例） |
| daemon（backend） | backend/app/modules/daemon/schema.py（InteractiveProviderLiteral +dsh） | 接口变更（枚举扩展，向后兼容） | 否（create_config 36 用例零回归） |
| daemon（backend） | backend/app/modules/daemon/group/service/helpers.py + messages.py + shadow.py（群附件门控 caps 口径统一发送侧+触发侧） | 逻辑变更 + 行为变化（pi/cursor 群附件放行，R-03 有意） | 是（行为变化项——verify 阶段对账 FR-07） |
| frontend_components | frontend/src/components/sessions/session-list-panel.tsx（头注释五引擎） | 逻辑变更（仅注释） | 否 |
| frontend（lib） | frontend/src/lib/daemon/runtimes.ts（SESSION_SUPPORTED_PROVIDERS/PROVIDER_META +dsh） | 配置变更 | 否（page.test 边界钉 49 用例） |
| frontend（lib） | frontend/src/lib/api-types.ts + provider-caps.ts + sillyhub-daemon/src/api-types.ts + backend/openapi.json（生成物 ×4） | 配置变更（生成物） | 否（规则 21 双义务同变更提交） |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- docs/sillyspec/ 下 6 个 *.md：非本变更文件（主仓并行会话未提交产物，baseline checkpoint f4fc50fda 已归因排除），本变更不处理。

### 变更文件归属明细（全 30 文件逐行归因，归档终审对账用）

| 文件 | 归属模块 | 归因 |
|---|---|---|
| sillyhub-daemon/src/interactive/dsh-acp-driver.ts | daemon | 新增实现（矩阵行 1） |
| sillyhub-daemon/src/interactive/dsh-acp-events.ts | daemon | 新增实现（矩阵行 2） |
| sillyhub-daemon/src/dsh-settings.ts | daemon | 新增实现（矩阵行 3） |
| sillyhub-daemon/src/interactive/providers.ts | daemon | 修改（矩阵行 4） |
| sillyhub-daemon/src/agent-detector.ts / version.ts | daemon | 修改（矩阵行 5） |
| sillyhub-daemon/src/interactive/session-manager/driver-factory.ts | daemon | 修改（矩阵行 6，D-006） |
| sillyhub-daemon/scripts/gen-provider-caps.mjs | daemon | 修改（矩阵行 7） |
| sillyhub-daemon/tests/agent-detector.test.ts / version.test.ts / dsh-settings.test.ts / interactive/dsh-acp-{events,driver,smoke}.test.ts / interactive/provider-registry.test.ts / tests/helpers 无改动 | daemon | 共位测试（新增/连带，随实现同卡） |
| backend/app/modules/agent/provider_caps.py | agent（backend） | 生成物镜像（矩阵行 8） |
| backend/app/modules/agent/tests/test_provider_caps_alignment.py | agent（backend） | 共位测试（EXPECTED 五引擎连带） |
| backend/app/modules/daemon/schema.py | daemon（backend） | 修改（矩阵行 9） |
| backend/app/modules/daemon/group/service/{helpers,messages,shadow}.py | daemon（backend） | 修改（矩阵行 10，R-03 行为变化需 review——verify 已对账 FR-07） |
| backend/app/modules/daemon/tests/test_group_attachment_gate.py | daemon（backend） | 新增共位测试（task-06） |
| backend/openapi.json | daemon（backend） | 生成物（规则 21） |
| frontend/src/lib/daemon/runtimes.ts | frontend_components（引擎选项单一源） | 修改（矩阵行 12，D-007；verify 对账称并行会话 zcode-engine-appserver 亦声明此文件——本变更仅 +PROVIDER_META/SUPPORTED_PROVIDERS 段，归因保留） |
| frontend/src/components/sessions/session-list-panel.tsx | frontend_components | 修改（矩阵行 11，头注释） |
| frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx | frontend_components | 共位测试（边界钉 2 例） |
| frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx | frontend_components | 钉子测试连带（provider-caps.ts 形状闸要求，task-04 提交内补 dsh 十六键钉） |
| frontend/src/lib/api-types.ts / provider-caps.ts | frontend（lib） | 生成物 ×2（规则 21 + caps 镜像） |
| sillyhub-daemon/src/api-types.ts | daemon | 生成物（规则 21 双义务） |

无游离文件（未匹配面仅并行会话 docs 噪音，见上）。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无新增模块目录（全部文件命中既有 daemon/agent/frontend 模块前缀），无需 rebuild | skipped |
| `modules/daemon.md` | skipped：模块卡 71.6KB 超预算，本变更契约摘要点已在 verify-result「设计一致性」与决策矩阵留档；卡片级回填（dsh 引擎条目 + split-changelog 瘦身）归 archive 阶段统一处理，不在 verify 阶段动超预算卡（防格式回归） | skipped |
