---
schema_version: 1
doc_type: module-card
module_id: config
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:13
---
# config

## 定位
守护进程配置持久化层。管理 `~/.sillyhub/daemon/config.json` 的异步加载/保存，提供默认配置合并、runtime_id 缺失时自动生成、allowed_roots 规范化与去重。1:1 迁移自 Python `config.py`，由 Python 的类式（property + 内部 _data）改为**函数式**（loadConfig 返回纯对象、saveConfig 接收对象），更易测试、daemon 只读持有。

## 契约摘要
- `DEFAULT_CONFIG_DIR`：`~/.sillyhub/daemon`（`os.homedir()`，非 `process.env.HOME`，Windows 兼容）。
- `DEFAULT_CONFIG_PATH`：`<dir>/config.json`。
- `DaemonConfig`（interface）：server_url、runtime_id、poll_interval、heartbeat_interval、max_concurrent、log_level、allowed_roots、spec_root_map、terminal 相关字段（snake_case 对齐 backend）。
- `DEFAULT_CONFIG`：Object.freeze 的全字段默认对象（runtime_id 初始空串，首次 load 时补 randomUUID）。
- `loadConfig(path?): Promise<DaemonConfig>`：读文件 → JSON.parse → 合并默认 → 补 runtime_id → 规范化 allowed_roots。
- `saveConfig(config, path?): Promise<void>`：写 JSON（pretty）。
- `normalizeAllowedRoots(raw)`：resolve + 去重 + 仅保留字符串。

## 关键逻辑
```
loadConfig(path=DEFAULT_CONFIG_PATH):
  data = { ...DEFAULT_CONFIG }
  if existsSync(path):
    saved = JSON.parse(readFile) as Partial<DaemonConfig>
    Object.assign(data, saved)            # 用户值覆盖默认
  if !data.runtime_id: data.runtime_id = randomUUID()
  data.allowed_roots = normalizeAllowedRoots(data.allowed_roots)
  // SPEC_ROOT_MAP 环境变量可覆盖 spec_root_map
  return data

saveConfig: mkdir -p dirname → writeFile JSON.stringify(config, null, 2)
```

## 注意事项
- 全程 `fs/promises` 异步，**不提供同步版本**（Python 同步 I/O 是历史包袱，YAGNI）。
- runtime_id 在 interface 中为非空 string，但用户旧 config.json 可能缺失，load 时补齐；改 interface 需同步检查 Python config.py。
- allowed_roots 供 file-rpc 做路径越界校验，规范化（resolve）在此层完成一次，下游直接比绝对路径。
- spec_root_map 可被环境变量 `SPEC_ROOT_MAP` 覆盖，便于容器/多项目场景。
- daemon 主类持有 config 后只读使用，需改配置直接改对象再 save。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
