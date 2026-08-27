# dev 本机 MinIO 上传三连坑（2026-08-23, ql-20260823-013）

## 现象

dev 本机（macOS）后端上传文件到平台文件中心恒失败/挂起 60s+，报
`RequestTimeout: A timeout occurred while trying to lock a resource`。
排查期间连带发现两坑，三个坑叠加导致「本机任何文件上传从未成功过」
（`session_attachments` 表 0 行为证——MinIO 已死 6 个月，无人察觉）。

## 坑 1：dev 环境 MinIO 根本没起（主因）

- `backend/app/core/config.py` 默认 `s3_endpoint=http://localhost:9000`，但本机
  Docker 里只有一个 6 个月前 Exited(255) 的遗留 `minio` 容器；dev compose
  （multi-agent-platform-dev）只起 postgres+redis，从不起 MinIO。
- 后果：一切走到存储层的上传（`/api/agent/file-artifacts`、`/api/file/upload`、
  会话附件）在本地必然失败；此前没暴露是因为更前面的 403（ql-20260823-013
  修的授权 bug）把请求挡在了存储层之前。
- 处理：已起 `sillyhub-dev-minio` 容器（127.0.0.1:9000，minioadmin/minioadmin，
  named volume `sillyhub-dev-minio-data`），与 backend 默认凭据匹配。

## 坑 2：`localhost` 端点的签名 PUT 被本机某层吞掉 60s（未定论，已绕过）

aiobotocore + `endpoint_url=http://localhost:9000` 的 **PutObject** 空等 ~61s 后
收到伪 MinIO 错误（带 `x-ratelimit-limit: 2047`/HSTS 等本机容器不会加的头）；
同客户端换 `http://127.0.0.1:9000` 全部操作秒过。已排除：MinIO 本体、DNS 解析
（`::1` 拒连后回退正常）、venv 注入钩子（sitecustomize/.pth 干净）、裸 aiohttp
PUT（不挂）、path-style 寻址（强制也不挂）、botocore 环境代理（env 无代理变量）。
faulthandler 显示探测进程 61s 内**零网络事件、零 TCP fd**——请求根本没出进程。
头号嫌疑：系统代理（scutil 显示 127.0.0.1:7897，Clash 系，HTTP/HTTPS/SOCKS 全开）
的某种钩子/TUN 拦截了 hostname=localhost 的 PUT。未最终定罪（py-spy 需 sudo）。
- 绕过：`backend/.env` 已加 `S3_ENDPOINT=http://127.0.0.1:9000`。
- 铁律：**本机 dev 的 S3/HTTP 端点一律写 `127.0.0.1`，不写 `localhost`**；
  遇到「只有 PUT 挂、GET 正常、61s 超时、响应头多出安全头」直接想到本机代理拦截。

## 坑 3：uvicorn --reload 会在语法错误窗口后僵死（连带发现）

编辑期间短暂引入过语法错误，uvicorn --reload 的 watcher 之后失灵：`touch` .py
不再触发重启（worker 仍是旧进程），且旧 worker 会逐渐无响应（health 000）。
- 处理：整树 kill（必要时 -9）后重启 `uv run uvicorn app.main:app --reload --port 8000`。
- 教训：本地热重载失灵（改了代码行为没变/health 卡）别猜代码，直接查 worker
  进程启动时间，整进程重启。

## 验证

修复后（ql-20260823-013 授权改动 + 127.0.0.1 端点 + MinIO 起容器）在真实会话
c5b97325-80d5-42f4-881d-9cab6d188425（无工作区 runtime 会话）端到端实测：
POST 上传 201（0.1s）→ GET 列表回显 200 → GET 下载 200。
