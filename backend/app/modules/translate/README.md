# 思考内容离线翻译（translate 模块）

会话/日志里 agent 思考内容（`[THINKING]` 流）的 en→zh 离线翻译服务。零外部云翻译
API——推理在本地 CTranslate2 子进程完成（opus-mt-en-zh int8 量化，复刻
`knowledge/embedding_worker` 三闸自灭模式：闲置 600s / 父进程消失 / 1h 寿命帽）。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `TRANSLATE_THINKING_ENABLED` | `true` | 总闸；`false` 时端点直接原文透传 |
| `TRANSLATE_MODEL_REPO` | `jiangzhuo9357/opus-mt-en-zh-ct2` | ct2 格式模型 repo id（换更大模型只改这里） |
| `TRANSLATE_MODEL_DIR` | 空 | 本地模型目录（含 `config.json` 的 ct2 目录）；非空时零下载 |
| `TRANSLATE_WORKER_IDLE_EXIT_SEC` | `600` | 翻译子进程闲置自灭秒数 |
| `TRANSLATE_REQUEST_TIMEOUT_SEC` | `20` | 单次子进程请求等待上限；超时 fail-soft 返回原文（2026-10-22 前为固定 300s，模型未预置时界面会挂 5 分钟） |
| `TRANSLATE_CACHE_MAX_ENTRIES` | `2048` | 进程内译文 LRU 条目上限 |

模型首用从 HuggingFace 自动下载（~100-150MB，尊重 `HF_ENDPOINT` 镜像与 `HF_HOME`
缓存变量）。**下载/加载失败一律 fail-soft**：端点返回 `engine_ready=false` + 原文
透传，应用启动零阻塞；前端显示原文 + 「离线翻译未就绪」轻提示并 60s 退避。

子进程 stderr 由后台线程逐行转发到主进程日志（logger `app.modules.translate.engine`，
WARNING 级），模型下载/加载失败原因可在后端日志中直接查到（此前丢进 DEVNULL，故障
不可见——2026-10-22 生产事故教训）。

**生产必须预置模型目录**：服务器访问 `huggingface.co` 不通（2026-10-22 实测 TCP
unreachable），靠首用在线下载会让每次请求卡到超时。`deploy/docker-compose.yml` 已把
宿主机 `./models/opus-mt-en-zh` 挂到容器 `/opt/models/opus-mt-en-zh`；服务器 `.env`
设置 `TRANSLATE_MODEL_DIR=/opt/models/opus-mt-en-zh` 即零下载。下载可在服务器上用
可达镜像 `HF_ENDPOINT=https://hf-mirror.com` 完成（实测可达）。

## 离线部署（预置模型，零下载）

```bash
# 有网机器上一次性下载模型目录（HF 镜像可加 HF_ENDPOINT=https://hf-mirror.com）
python -c "from huggingface_hub import snapshot_download; print(snapshot_download('jiangzhuo9357/opus-mt-en-zh-ct2'))"

# 把输出的缓存目录整体拷到部署机（如 /opt/models/opus-mt-en-zh），然后：
TRANSLATE_MODEL_DIR=/opt/models/opus-mt-en-zh
```

Docker 预烤（可选）：在 backend Dockerfile 依赖安装后加

```dockerfile
RUN python -c "from huggingface_hub import snapshot_download" \
    && python -c "from huggingface_hub import snapshot_download as s; s('jiangzhuo9357/opus-mt-en-zh-ct2', local_dir='/opt/models/opus-mt-en-zh')" \
    || true
ENV TRANSLATE_MODEL_DIR=/opt/models/opus-mt-en-zh
```

（`|| true` 保持构建可离线重试；烤失败时运行期自动回退 repo 下载路径。）

tokenizer 加载分层回退：transformers `AutoTokenizer` → sentencepiece
（`source.spm`/`target.spm`）→ 都缺席时报错退出（fail-soft 降级原文）。

## 质量预期

opus-mt 是轻量模型（int8 量化），目标是「能看懂大意」而非信达雅；代码块 / 行内
代码 / URL 保护不送翻（`chunking.py`），前端每处展开视图可一键切回原文。质量不
满意时换更大 ct2 模型（改 `TRANSLATE_MODEL_REPO` 指向即可，接口契约不变）。

## 端点契约

`POST /api/translate/thinking`（`task:run_agent` 权限）：
`{items: [{id, text ≤20000 字符} × ≤16], target: "zh"}` →
`{ok, engine_ready, reason, items: [{id, text, translated}]}`。限额超界 422；
`translated=false` = 原文透传（不值得翻 / 引擎不可用）。
