---
author: flow-machine-draft
created_at: 2026-10-11T07:00:52.199Z
---
# 需求规格（Requirements）— 2026-10-11-apikey-mcp-copy-delete

## 功能需求

### FR-01: runtimes 页复制启动命令时，命令内嵌当前用户最新活跃 API key 明文；若无活跃 key 则自动创建一个永不过期 key 并使用

- 点击「复制命令」时必须解析出可直接运行的完整命令：优先取当前用户最新活跃 API key 的明文拼入 `--api-key`；无活跃 key 时必须自动创建一个 `expires_at = null`（永不过期）的 key 并使用其明文，同时向用户提示已自动创建（含 key 名称）。
- 页面渲染的命令必须保持打码形态（仅显示 `key_prefix`），完整明文只进剪贴板，不常驻屏幕。
- 无 `API_KEY_ADMIN` 权限的用户（list/create 均 403）必须保持现状回退：命令用浏览器 `--token` 短期凭证并显示原有警示，不因新逻辑报错。
- 自动创建的 key 必须遵守现有创建端点语义（名称非空、走同一权限门），禁止绕过权限校验。

#### 场景：有活跃 key

- Given 当前用户已有至少一个活跃（未吊销未过期）API key
- When 用户点击「复制命令」
- Then 剪贴板中的命令为 `sillyhub-daemon start --server <origin> --api-key <该 key 明文>`，且不产生新 key

#### 场景：无任何活跃 key

- Given 当前用户无活跃 key（无记录或全部吊销/过期）
- When 用户点击「复制命令」
- Then 系统自动创建名称带「自动创建」标识、`expires_at=null` 的 key，剪贴板命令内嵌其明文，页面出现已自动创建的提示

#### 场景：非 admin 用户

- Given 当前用户无 `API_KEY_ADMIN` 权限
- When 页面加载 / 点击复制
- Then 行为与现状一致（access_token 回退 + 黄色警示），无新增报错

### FR-02: api-keys 列表对可恢复明文的活跃密钥提供复制按钮，一键复制明文

- 后端必须为 API key 增加可恢复明文能力：创建时以 libsodium secretbox 加密存储明文（格式与 mcp_webhooks.secret 同构 `{key_id}:{hex(ct)}`），bcrypt `key_hash` 鉴权路径必须保持不变。
- 后端必须提供按 id 获取明文的端点：仅对属于当前用户、未吊销的 key 返回明文；已吊销/过期/不存在一律 404。
- api-keys 列表每行必须对「活跃且可恢复」的 key 显示复制按钮，点击后明文进剪贴板并给出复制成功反馈；已吊销/过期行禁止显示复制按钮。

#### 场景：活跃可恢复 key 复制

- Given 用户有一个创建于本变更之后、未吊销未过期的 key
- When 点击该行「复制密钥」
- Then 剪贴板内容与创建时签发的明文完全一致

#### 场景：已吊销 key

- Given key 已吊销
- When 列表渲染 / 尝试调明文端点
- Then 前端不显示复制入口；直接调端点返回 404

### FR-03: mcp-tokens 列表对可恢复明文的活跃令牌提供复制按钮，一键复制明文

- 后端必须为 McpToken 增加可恢复明文能力：创建时加密存储明文（同 FR-02 格式），`token_hash`（sha256 唯一索引）鉴权路径必须保持不变。
- 后端必须提供按 id 获取明文的端点：仅对属于该 workspace、未吊销的 token 返回明文；已吊销/不存在/跨 workspace 一律 404；权限沿用 `WORKSPACE_WRITE`。
- mcp-tokens 列表每行必须对「活跃且可恢复」的 token 显示复制按钮；已吊销行禁止显示复制按钮。

#### 场景：活跃可恢复 token 复制

- Given workspace 下有一个未吊销、创建于本变更之后的 token
- When 点击该行「复制令牌」
- Then 剪贴板内容与签发时的明文完全一致

### FR-04: 已吊销的 API key 与 MCP token 支持从列表物理删除（后端仅对已吊销记录放行删除）

- 后端必须在现有 DELETE 端点上支持 `hard=true` 查询参数：仅当记录已吊销（`revoked_at` 非空）时执行物理删除（行从表中移除），否则返回 409 并提示需先吊销；不带参数时必须保持原吊销语义完全不变。
- McpToken 物理删除时其关联 mcp_webhooks 行随外键 CASCADE 一并移除，行为必须与文档一致。
- 前端两个列表必须对已吊销行显示「删除」按钮：点击需 confirm 确认，成功后列表刷新；活跃行禁止显示删除按钮。

#### 场景：删除已吊销 key

- Given key 已吊销
- When 调 `DELETE /api/auth/api-keys/{id}?hard=true`
- Then 返回 204，列表中该行消失，数据库该行被移除

#### 场景：对活跃 key 请求硬删除

- Given key 未吊销
- When 调 `DELETE /api/auth/api-keys/{id}?hard=true`
- Then 返回 409，行保持不变，错误文案引导先吊销

### FR-05: 存量 hash-only 记录明文不可恢复时，复制入口降级提示而非报错

- 本变更之前创建的存量记录（无加密明文列值）必须继续正常列示；其明文端点必须返回 409 并携带「旧密钥未保存明文，请新建后使用」语义的中文提示，禁止返回 500。
- 列表 DTO 必须包含 `plaintext_recoverable` 布尔字段（加密列非空且未吊销）；前端对不可恢复的活跃行必须将复制按钮降级为禁用态并带 tooltip 说明，禁止点击后抛错。
- 主加密密钥（`SILLYSPEC_MASTER_KEY`）缺失时创建必须仍成功（加密列置空、明文仍一次性返回），禁止因新增加密逻辑导致原有创建链路 503。

#### 场景：存量旧 key 复制

- Given 存量 key 创建于本变更前，`encrypted_key` 为空，且仍活跃
- When 列表渲染
- Then 复制按钮呈禁用态，tooltip 提示旧密钥无法恢复明文

#### 场景：master key 缺失时创建

- Given 部署未配置 `SILLYSPEC_MASTER_KEY`
- When 用户签发新 key
- Then 创建成功且明文一次性返回（`plaintext_recoverable=false`），不抛 503

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/modules/auth/test_api_key_service.py「create 同时落 bcrypt hash 与加密明文」
FR-01: frontend/src/lib/__tests__/api-keys.test.ts「resolveDaemonApiKey：有活跃 key 返回明文 / 无活跃 key 自动创建永不过期 key」
FR-01: frontend/src/app/(dashboard)/runtimes/__tests__/copy-daemon-command.test.tsx「复制命令写入剪贴板的命令内嵌真实密钥、渲染面保持打码」
FR-02: backend/tests/modules/auth/test_api_key_router.py「GET /api/auth/api-keys/{id}/plaintext 活跃 key 返回明文、已吊销 404」
FR-02: frontend/src/app/(dashboard)/settings/api-keys/__tests__/page.test.tsx「活跃可恢复行显示复制密钥并写入剪贴板」
FR-03: backend/app/modules/mcp_gateway/tests/test_router.py「GET plaintext 端点活跃 token 返回明文、已吊销/越权 404」
FR-03: frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/__tests__/page.test.tsx「活跃可恢复行显示复制令牌并写入剪贴板」
FR-04: backend/tests/modules/auth/test_api_key_router.py「DELETE ?hard=true 已吊销 204 且行消失、活跃 409、无参保持吊销语义」
FR-04: backend/app/modules/mcp_gateway/tests/test_router.py「DELETE ?hard=true 已吊销 204、活跃 409、webhook 级联删除」
FR-04: frontend/src/app/(dashboard)/settings/api-keys/__tests__/page.test.tsx「已吊销行显示删除按钮，confirm 后调用硬删除」
FR-05: backend/tests/modules/auth/test_api_key_router.py「存量 hash-only 记录 plaintext 端点 409、列表 plaintext_recoverable=false」
FR-05: frontend/src/app/(dashboard)/settings/api-keys/__tests__/page.test.tsx「不可恢复行复制按钮禁用带 tooltip」
