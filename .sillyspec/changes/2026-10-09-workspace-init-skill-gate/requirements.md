---
author: qinyi
created_at: 2026-10-09 02:04:06
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 工作区成员（本机） | 在自己机器上绑定 daemon 并使用工作区的用户；初始化状态按此维度判定 |
| daemon | 本机守护进程，执行 init lease（拉 spec、跑 sillyspec init、写 skill） |
| sillyspec CLI | daemon spawn 的外部命令，`--tool` 决定 skill 写入哪些工具目录 |

## 功能需求

### FR-01: 初始化按机器探测到的 agent 写入多端 skill
覆盖决策：D-001@v1, D-005@v1
Given 机器上 agent-detector 探测到 N 个 agent 且与 sillyspec CLI `VALID_TOOLS` 的同名交集非空
When init lease 执行 `sillyspec init`（必须不带 `--no-skills`，`--tool` 为交集逗号列表）
Then 每个 tool 的 skill 目录（claude→`.claude/skills`、codex→`.codex/skills`、openclaw→`.openclaw/skills`、opencode→`.opencode/skills`、zcode→`.zcode/skills`）均被写入 `sillyspec-*` 技能；交集外的 provider（copilot/hermes/pi/kimi/kiro/antigravity 等）MUST NOT 产生任何目录；交集为空或探测失败时兜底仅写 claude（`['claude']`）。

### FR-02: 白名单同步与版本门控提升
覆盖决策：D-004@v1
Given daemon 端 `SILLYSPEC_VALID_TOOLS` 为 7 值（含 zcode）且 `MIN_SILLYSPEC_VERSION_FOR_INIT = '3.32.2'`
When init lease 执行前 spawn `sillyspec --version` 做门控
Then 版本 ≥3.32.2 放行；<3.32.2 时 init 必须失败并返回 `sillyspec_init_cli_too_old`（禁止写 `init_synced_at`）。

### FR-03: 详情页未初始化轻引导（成员/机器维度）
覆盖决策：D-002@v1, D-005@v1
Given 当前成员在本机对工作区的绑定 `init_synced_at` 为 NULL
When 打开工作区详情页配置卡片
Then 现有「未初始化」琥珀徽标下方必须出现引导 Alert（文案含"初始化后才能正常使用"与"每台机器需要单独初始化"）；`init_synced_at` 非空时 MUST NOT 出现 Alert（现状零回归）；后端派发/扫描接口行为 MUST NOT 改变。

### FR-04: 创建成功后自动串行初始化
覆盖决策：D-003@v1, D-005@v1
Given 创建弹窗提交带 `daemon_id` 且 `createWorkspace` 成功
When 前端串行调用 `initDispatch(workspaceId)` 并每 2s 轮询 `fetchMyBinding` 直到 `init_synced_at` 非空（5 分钟超时）
Then 弹窗必须依次展示"创建✓→初始化中→完成"进度；完成态提供「打开工作区」出口；初始化失败/超时时弹窗必须明示"工作区已创建成功，但初始化失败，可稍后在详情页重新初始化（守护进程可能离线或版本过旧）"且工作区行禁止删除（不回滚）；未传 `daemon_id` 时应当跳过初始化走现状完成路径；组件卸载必须清理轮询定时器。

### FR-05: init lease 失败禁止回写初始化状态
覆盖决策：D-006@v1
Given 一个 mode='init' 的 lease 以 `status='failed'` 上报 complete
When 后端 `complete_lease` 处理 init 回写段
Then 成员绑定的 `init_synced_at` / `init_synced_spec_version` 必须保持 NULL（禁止回写）并记 warn 日志 `init_lease_failed_no_synced`；`status='completed'` 时回写行为必须与现状一致（对照组零回归）。

## 非功能需求
- 兼容性：存量已初始化工作区不重跑不回填；老版本 sillyspec CLI 机器 init 失败并提示升级（升级后无需重启 daemon）；skill-manager 任务执行链路零改动；代码兼容 Windows/Linux/macOS（spawn 与路径沿用现有实现）。
- 幂等：`POST /init` 重复调用由现有 lease pending 复用路径保证（backend/app/modules/agent/service.py:2104）。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | skill 内容源=sillyspec init 自带复制段（去 --no-skills，修订 2026-08-15 D-004@v1）；skill-manager 不动 |
| D-002@v1 | FR-03 | 门禁仅前端引导，后端不硬拦 |
| D-003@v1 | FR-04 | 创建后前端串行调用初始化（未绑 daemon 跳过） |
| D-004@v1 | FR-02 | 白名单补 zcode + 门控提升 3.32.2 |
| D-006@v1 | FR-05 | init lease 失败禁止回写 init_synced_at（Grill UB-1 修复，FR-04 前置） |
| D-005@v1 | FR-01~FR-04 | 方案A 最小链路（否决 B 工程化复用 / C skill-manager 多端） |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
