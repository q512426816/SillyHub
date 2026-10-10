---
author: qinyi
created_at: 2026-10-10 23:02:30
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 工作区成员 | 刷新查看本机现状快照（当前用户绑定机器） |
| 工作区管理员（owner/admin） | 在快照对照基础上勾选导入（建共享登记） |
| daemon | 只读快照执行（spawn 两条 CLI 读命令，零写盘） |
| 平台 backend | RPC 编排、三态对照、导入落库 |

## 功能需求

### FR-01: 本机现状快照拉取与对照
Given 成员机器 daemon 在线且绑定该工作区
When 成员在关联仓卡片点「刷新本机现状」（GET local-snapshot）
Then backend 经 RPC `linked_repos_snapshot` 现拉 daemon 侧快照（projects 登记面 +
local.yaml repos 注册表，fetched_at 在场），与平台登记按 name/key 对照后返回逐条三态
（both/local_only/platform_only）；daemon 快照只读零写盘（D-005）。

### FR-02: 降级路径
Given daemon 离线、老 daemon（无 handler）、本机 sillyspec 缺读命令或**成员未绑定机器**
When 成员点刷新
Then 分别得到 daemon_offline / daemon_unsupported / 源级 skipped / binding_missing 的
结构化降级响应；卡片显示对应占位文案（未绑定显示「请先绑定守护进程」引导），不报错、
不阻塞列表主体（对齐 FR-07 降级家族）。

### FR-03: 一键导入
Given 快照含 local_only 条目（对照期已把 projects/repos 同名条目合并为单条：
rel_path 取 projects 源、abs_path 取 repos 源——Grill Gap A 修复）
When owner/admin 勾选后点「导入所选」（POST import）
Then 逐条独立成败：create_repo(name, rel_path?) 建行 +（含 abs_path 时）绝对路径写
**当前操作者** my_path——一条对照条目一次导入同时落 rel_path 与 my_path；与平台已有
同名 → skipped（幂等，不重不丢）；响应逐条 imported/skipped/failed + detail；
导入成功触发既有 best-effort 推送。

### FR-04: 前端本机现状区
Given 用户打开关联仓卡片
When 查看本机现状区
Then 初始为引导文案（零请求，D-003）；刷新后按三态徽标展示（both ✓ / local_only 可勾选
导入 / platform_only 提示），双主题 brand-* 语义阶；成员可见刷新但导入按钮仅
owner/admin 可用；离线占位与错误降级文案明确。

## 非功能需求
- 兼容性：Windows/Linux/macOS（execFile 数组形参）；对既有协议 additive（平名注册）；
  未点刷新时卡片行为与本变更前一致。
- 安全：快照只提取 repos: 段 key→path 与 projects: 块相对路径（local.yaml 其余内容不进快照，R-02 最小面）；
  导入端点 WORKSPACE_MEMBER_MANAGE。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | 全部 | 需求本体=上行回显 |
| D-002@v1 | FR-01/03/04 | 展示+导入形态 |
| D-003@v1 | FR-01/02/04 | 手动刷新现拉/初始零请求 |
| D-004@v1 | FR-03 | 导入复用链路/重名跳过/权限分层 |
| D-005@v1 | FR-01 | 快照只读不落库 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
