---
author: qinyi
created_at: 2026-10-15 20:24:10
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户（workspace 成员） | 持 `knowledge:read` 使用知识搜索（体验本变更的唯一受益面：重启后快） |
| 运维/部署者 | 执行镜像替换与迁移（D-008 升级步骤） |

## 功能需求

### FR-01: 向量持久化与重启零重建
覆盖决策：D-001@v1, D-002@v1, D-004@v1
Given 知识搜索已建库（chunks/state 表有该 workspace 数据）
When 服务重启后用户首次搜索
Then 结果 MUST 秒级返回（不再全量重嵌入）；向量与 chunk 元数据 MUST 持久化在 PG pgvector 表（embedding vector(512)，SQLite 方言 JSON 变体仅供测试）

### FR-02: 查询结果与现实现逐字段一致
覆盖决策：D-004@v1, D-005@v1, D-006@v1
Given 相同语料与查询
When 分别用内存实现（升级前）与 DB 实现（升级后）搜索
Then 返回的 results 条目（spec_path/kind/title/anchor/snippet/score）MUST 语义一致（融合 0.6/0.4、anchor∨title∨path 保底 0.9、零信号过滤、snippet 口径全部不变）；PG KNN 与 SQLite Python 余弦两方言 MUST 返回一致形态

### FR-03: 自动增量同步
覆盖决策：D-003@v1, D-007@v1, D-011@v1
Given 库已建且语料文件发生增/删/改
When 下一次搜索请求到达
Then 指纹失配 MUST 触发差量同步（新增插入/变更重嵌/消失删除；mtime 漂移但内容未变 MUST 被 content_hash 层吸收不重嵌）；同步 MUST 在查询路径内联完成（无后台任务/无 daemon 改动）；model_version 变更 MUST 触发一次全量重算；指纹一致时 MUST 零嵌入调用（embed_calls 计数不变）

### FR-04: 对外契约零变化
覆盖决策：D-005@v1
Given 本变更部署后
When 回归上变更全部测试
Then knowledge 模块 199 + 前端 46 MUST 全绿（仅 fake 注入点适配）；openapi.json/api-types MUST 零 diff；search_sync 返回形态与端点行为 MUST 不变

### FR-05: 部署与降级安全
覆盖决策：D-008@v1
Given 生产环境升级（换镜像 → 迁移 → 重启）
When 迁移在未换镜像的 PG 上执行
Then 迁移 MUST fail-closed（报含修复指引的错误，不留半态表）；升级后搜索 MUST 可用（首查建库一次 304s 级可接受，loading 文案已有）；PG/DB 运行时异常时搜索 MUST 降级为词面内存直查（不 5xx）；downgrade MUST 删两表且不卸共享扩展

## 非功能需求
- 兼容性：MUST 兼容 Windows/Linux/macOS 开发与 PG16 生产；测试环境（SQLite 内存）MUST 可跑（方言分叉 D-004）。
- 性能：库就绪后单查询目标 SHOULD <1s（KNN 毫秒级 + 指纹 stat ~0.25s）；差量同步 SHOULD 只重嵌变更文件。
- 可运维：库数据可查（SQL 直查 chunks/state）；迁移幂等。
- 依赖：仅新增 pgvector>=0.3（Python 侧），MUST NOT 引入其他新运行时依赖。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | pgvector 选型（用户裁决） |
| D-002@v1 | FR-01 | 两表结构 + with_variant |
| D-003@v1 | FR-03 | 差量同步 |
| D-004@v1 | FR-01, FR-02 | 查询方言分叉 |
| D-005@v1 | FR-02, FR-04 | 契约冻结 |
| D-006@v1 | FR-02 | 词面 SQL 候选 |
| D-007@v1 | FR-03 | 模型版本重算 |
| D-008@v1 | FR-05 | 部署与降级 |
| D-009@v1 | FR-01（反证） | 文件缓存落选防复潮 |
| D-010@v1 | 非目标 | 预热落选防复潮 |
| D-011@v1 | FR-03 | 方案 A 内联懒同步 |
| D-012@v1 | 非目标 | 后台协程落选防复潮（R-02 复潮触发器） |
| D-013@v1 | 非目标 | 混合落选防复潮 |

## 剩余风险
- R-02（KNN 无 ANN 索引，十万级退化）与 R-03（跨维度换模型需显式迁移）为登记开口，触发条件明确（复潮判据），不阻塞本需求集。

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
