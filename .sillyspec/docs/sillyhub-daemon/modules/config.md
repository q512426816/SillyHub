---
schema_version: 1
doc_type: module-card
module_id: config
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 配置持久化层（config）

## 定位
daemon 配置持久化层。管理 `~/.sillyhub/daemon/` 下 **per-server 配置文件**（`config-<server_url sha256 前 8 位>.json`）的异步加载/保存：同机多 daemon 连不同后端时各自独立配置文件 + 独立 runtime_id 身份，互不覆盖。函数式 API（loadConfig 返回纯对象、saveConfig 接收对象），daemon 持有后只读使用。

## 契约摘要
- 路径常量：`DEFAULT_CONFIG_DIR`（~/.sillyhub/daemon，os.homedir() 而非 env.HOME，Windows 兼容）；`DEFAULT_CONFIG_PATH`（旧单文件 config.json，**仅作首次升级迁移源**与历史测试兼容断言，生产代码不再直接消费）；`CLAUDE_CONFIG_DIR`（daemon 专属 claude 隔离配置目录，防宿主机 cc-switch 污染，ql-20260726-002）。
- per-server：`serverHash(server_url)`（sha256 前 8 位 hex，纯函数）、`configPathForServer(server_url, configDir?)`、`hasAnyPerServerConfig(configDir)`（扫 `config-<8hex>.json` 命名）。
- `DaemonConfig`：扁平字段全量配置——server_url / token / api_key（互斥）/ runtime_id / profile / workspace_dir / poll_interval(30) / heartbeat_interval(15) / max_concurrent_tasks(5) / log_level / default_timeout_seconds(1800) / max_retries(1) / retry_*（网络重试 4 项）/ loop_restart_backoff_ms / max_loop_restarts / outbox_max_per_run / outbox_max_total / disconnect_log_threshold_sec / terminal_observer_*（4 项）/ lease_heartbeat_interval(5) / self_reload_check_interval_sec(600) / sillyspec_update_interval_sec(3600，0=关闭——daemon 第四循环 `_sillyspecLoop` 的检查间隔，非法值消费端兜底为关闭，2026-08-31-machine-sillyspec-version) / allowed_roots / spec_root_map。
- `DEFAULT_CONFIG`：Object.freeze 全字段默认（allowed_roots 默认 [homedir()]）。
- `loadConfig(server_url, opts?)`：opts.path 显式覆盖路径（测试/历史兼容，最高优先级）、opts.configDir 注入目录。
- `saveConfig(config, path?)`：mkdir -p + 写 JSON（indent=2）。
- `normalizeAllowedRoots(raw)`：非数组/空 → [homedir()]；过滤非字符串；resolve 相对路径；去重保序；恒返回全新数组。

## 关键逻辑
```text
loadConfig(server_url, opts):
  path = opts.path ?? configPathForServer(server_url)
  data = { ...DEFAULT_CONFIG }
  # 一次性迁移（仅 per-server 模式）：目录下无任何 per-server 文件 且 旧 config.json 存在
  #   → 只搬 runtime_id（不搬 server_url/token，防身份污染），migrated=true
  if exists(path): Object.assign(data, JSON.parse(stripBOM(readFile)))   # 浅合并
  data.allowed_roots = normalizeAllowedRoots(data.allowed_roots)         # 全新数组防污染 DEFAULT
  generated = !data.runtime_id → randomUUID()
  if generated || migrated || !perServerExisted: saveConfig(data, path)  # 否则跳过落盘
  env SPEC_ROOT_MAP 存在（含空串）→ 覆盖 data.spec_root_map（不落盘）
  return data
```

## 注意事项
- **迁移是一次性语义**：只把 legacy runtime_id 给第一个被创建的 per-server 文件（靠 hasAnyPerServerConfig 扫描判定），否则连 N 个后端共享同一 legacy 身份违反隔离；迁移后不删旧 config.json（留备份）。
- 落盘条件三选一（刚生成 runtime_id / 刚迁移 / 目标文件原本不存在），避免每次启动无谓写盘；allowed_roots 规范化本身不触发落盘。
- JSON 损坏/空文件 → SyntaxError 原样冒泡（静默降级会丢用户配置）；路径不可写同样抛出（daemon 应停止而非带病运行）。
- spec_root_map 的 env 覆盖刻意不落盘（防宿主路径序列化进配置跨机器冲突）；格式 "from:to"，翻译 Docker 容器内 /data/... 路径为宿主机路径。
- token/api_key 用 `string | null`（JSON 原生 null），strict 模式访问后需收窄类型。
- BOM 防御：读文件先 stripBOM 再 JSON.parse。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
