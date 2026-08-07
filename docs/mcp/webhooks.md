# Webhook：worker 终态推送

第三方可以注册 webhook，让 SillyHub 在 mission 下 worker 进入终态（completed / failed）
时**主动 POST** 推送到你的 HTTP 端点，免去轮询。投递带 HMAC-SHA256 签名供你校验来源，
失败按指数退避重试。

## 注册 webhook

webhook 的注册 / 列表 / 删除走**管理 API**（`/api`，平台用户 owner/admin 身份，非
McpToken）。webhook 绑定在一个 McpToken 上（`token_id`），随该 token 删除而级联删除。

### 注册

```http
POST /api/workspaces/{workspace_id}/mcp-webhooks
Authorization: Bearer <平台用户 JWT>
Content-Type: application/json

{
  "token_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "url": "https://your-server.example.com/sillyhub-webhook",
  "secret": "你自己的签名密钥",
  "events": ["worker.completed", "worker.failed"]
}
```

- `events` 取值：`worker.completed` / `worker.failed` / `"*"`（全订阅）。非空数组。
- `secret`：你自定义的签名密钥，**仅本次入站**，服务端加密入库、绝不在任何响应里回显
  （列表 / 详情都不含 secret）。请自己保存好——校验签名要用它。

201 响应（不含 secret）：

```json
{
  "id": "uuid",
  "token_id": "uuid",
  "url": "https://your-server.example.com/sillyhub-webhook",
  "events": ["worker.completed", "worker.failed"],
  "active": true,
  "created_at": "2026-08-06T14:00:00Z"
}
```

### 列表 / 删除

```http
GET    /api/workspaces/{workspace_id}/mcp-webhooks          # 列出（不含 secret）
DELETE /api/workspaces/{workspace_id}/mcp-webhooks/{id}     # 删除（204）
```

删除后该 webhook 不再被投递命中。

## 推送 payload

worker 进终态时，SillyHub 向匹配的 webhook `url` 发 `POST`，body 是 JSON：

```json
{
  "event": "worker.completed",
  "workspace_id": "uuid",
  "mission_id": "uuid",
  "worker_id": "uuid",
  "status": "completed",
  "error_code": null,
  "timestamp": "2026-08-06T14:05:00Z"
}
```

字段：

| 字段 | 说明 |
| --- | --- |
| event | 事件名（`worker.completed` / `worker.failed`） |
| workspace_id | 所属 workspace |
| mission_id | 所属 mission |
| worker_id | 进入终态的 worker run id |
| status | 终态（`completed` / `failed`） |
| error_code | 失败原因码，成功为 `null` |
| timestamp | 投递时间（ISO8601） |

body 序列化采用 `sort_keys=True` + 紧凑分隔符（`,` / `:`）。**校验签名时请对原始
请求体字节计算，不要重新序列化 JSON**（键序 / 空白不同会导致签名对不上）。

请求头：

| header | 说明 |
| --- | --- |
| `X-Signature` | body 的 HMAC-SHA256 hex（密钥 = 你注册时给的 `secret`） |
| `Content-Type` | `application/json` |

## 签名校验（HMAC-SHA256）

用注册时的 `secret` 对**原始请求体**算 HMAC-SHA256，取 hex，与 `X-Signature` header
做常量时间比较。对不上就拒收（可能是伪造或篡改）。

### Python（FastAPI / Flask 通用思路）

```python
import hashlib
import hmac

WEBHOOK_SECRET = b"你自己的签名密钥"  # 注册时填的 secret

def verify_signature(raw_body: bytes, x_signature: str) -> bool:
    expected = hmac.new(WEBHOOK_SECRET, raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, x_signature)

# FastAPI 示例：
# @app.post("/sillyhub-webhook")
# async def hook(request: Request):
#     raw = await request.body()                # 原始字节，不要先 json.loads 再 dump
#     sig = request.headers.get("x-signature", "")
#     if not verify_signature(raw, sig):
#         raise HTTPException(status_code=401, detail="bad signature")
#     payload = json.loads(raw)                 # 校验通过后再解析
#     ...
```

### Node（Express）

```javascript
const crypto = require("crypto");
const express = require("express");

const WEBHOOK_SECRET = "你自己的签名密钥"; // 注册时填的 secret
const app = express();

// 关键：用 express.raw 拿原始字节，不要用 express.json() 先解析
app.post(
  "/sillyhub-webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.get("x-signature") || "";
    const expected = crypto
      .createHmac("sha256", WEBHOOK_SECRET)
      .update(req.body) // req.body 此时是 Buffer（原始字节）
      .digest("hex");

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(sig, "utf8");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).send("bad signature");
    }

    const payload = JSON.parse(req.body.toString("utf8")); // 校验通过后再解析
    // ... 处理 payload.event / payload.worker_id / payload.status ...
    res.status(200).send("ok");
  }
);
```

要点：

- 用常量时间比较（Python `hmac.compare_digest` / Node `crypto.timingSafeEqual`），防
  计时侧信道。
- 必须先拿**原始字节**验签，再解析 JSON。Express 默认 `express.json()` 会把 body 解析
  掉，要用 `express.raw` 才能拿到原始字节。

## 重试策略（指数退避）

投递失败按指数退避重试，**最多 5 次**（1 次首发 + 4 次退避重试）：

| 尝试 | 距上次等待 |
| --- | --- |
| 1 | 立即 |
| 2 | 1s |
| 3 | 4s |
| 4 | 16s |
| 5 | 64s |

重试判定：

- **2xx** → 成功，不再重试。
- **5xx / 超时 / 连接错误 / 其它出站异常** → 退避后重试。
- **4xx**（非 2xx/5xx）→ 视为对端明确拒绝，**不重试**，直接放弃。
- 重试耗尽 → 服务端记 warn 日志，**不影响** mission 主流程（best-effort）。

建议你的接收端：**校验通过、处理成功后尽快返回 2xx**；校验失败或参数不合法返回 4xx
（让 SillyHub 停止无意义重试）；瞬时故障返回 5xx 让退避重试接管。出站请求超时为 10s，
接收端处理别超过这个时长（重活先收下、异步做，立刻 2xx）。

> 投递是异步的：worker 进终态的主流程**不等待**投递完成。所以 webhook 适合做"完成了
> 通知我"，不适合做强一致同步。要可靠拿结果，仍以 `get_worker_result` 拉取为准
> （见 [tools-reference.md](tools-reference.md)）。
