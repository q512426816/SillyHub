---
author: qinyi
created_at: 2026-10-16 15:31:53
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 浏览器登录使用平台的人（多标签页/多设备场景当事方） |
| 攻击者 | 假设的 refresh token 窃取者（复用检测的安全对象） |
| 管理员 | 使用 admin/settings 会话管理端点的人（语义保持不变） |

## 功能需求

### FR-01: 会话族建模
Given 用户完成一次登录（login）
When 后续发生 refresh 轮换或 grace 续期
Then 该登录衍生的所有 session 行共享同一 family_id；login 开新族（uuid4）；存量 NULL 行读取侧以 `family_id or id` 兜底自成一族

### FR-02: 复用检测族级吊销
Given 某 refresh token 已被轮换（revoked+rotated）且超过宽限窗后再次提交
When 后端消费该 token
Then 仅 `(user_id, family)` 范围内的存活 session 被置 revoked_at（含窃取者用该 token 衍生的后代 session）；同用户其他族的 session 全部存活；仍抛 AuthRefreshReused 401

### FR-03: 宽限窗默认 300 秒
承接: FR-unmapped-260（退役理由：默认宽限窗 60→300 秒随族级吊销变更调整）
Given 配置未显式覆盖 `AUTH_REFRESH_GRACE_SECONDS`
When 读取默认值
Then 默认为 300（原 60）；grace=0 仍退化为无宽限旧行为；env 覆盖可随时回退；grace 窗内旧 token 复用仍换发新对不误杀（语义保留自被承接条目）

### FR-04: 前端瞬态故障不清会话
Given 前端发起 POST /api/auth/refresh 收到 5xx / 408 / 429 或超时
When doRefresh 处理该响应
Then 抛出携带实际状态码的 ApiError；useSession 不 clear、不跳 /login；调用方按请求失败展示可重试错误

### FR-05: 前端明确失效仍清会话
Given 前端发起 POST /api/auth/refresh 收到 401/403/其余 4xx
When doRefresh 处理该响应
Then 返回 null；上层（api.ts 401 收口）清会话并跳 /login（既有行为不变）

## 非功能需求
- 兼容性：存量 sessions 行（family_id NULL）不回填不强制登出，运行时自成一族；PPM 生产库在线加 nullable 列（alembic 增量）；两 Phase 可独立交付（后端先上不破坏旧前端）。
- 安全性：窃取凭证衍生的后代 session 同族同灭（安全属性不降级）；grace 窗内重放权衡维持既有模型（R-03 接受）。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | family_id 列建模与继承规则 |
| D-002@v1 | FR-02 | 复用检测改族级吊销 + 文案同步 |
| D-003@v1 | FR-03 | 宽限窗 60→300 |
| D-004@v1 | FR-04, FR-05 | 前端状态码分流契约 |
| D-005@v1 | FR-01, FR-02, FR-03 | 方案 A 组合（用户选定） |
| D-006@v1 | — | rejected 留档（只加宽限窗） |
| D-007@v1 | — | rejected 留档（只拒绝不吊销） |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
