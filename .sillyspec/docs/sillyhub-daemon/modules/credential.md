---
schema_version: 1
doc_type: module-card
module_id: credential
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:13
---
# credential

## 定位
本地凭据存储与占位符渲染（design §4.2.3：用户密钥不离开本机）。server 只下发含 `{{USER_*}}` 占位符的配置模板，daemon 在本地解析后注入 agent 子进程 env。凭据文件 `~/.sillyhub/daemon/credentials.json`，权限 0600（POSIX）。1:1 迁移自 Python `credential.py`。

## 契约摘要
- `DEFAULT_CREDENTIALS_PATH`：`~/.sillyhub/daemon/credentials.json`。
- `CredentialManager(credentialsPath?)`：构造即 `_load()`，内存持有 `_credentials` 字典。
- CRUD：`get(key)`、`set(key, value)`（立即持久化）、`remove(key)`（立即持久化）、`listKeys()`。
- `save()`：写文件并 `fs.chmod 0o600`。
- `renderConfig(config): Record<string, unknown>`：解析 `{{USER_*}}` 占位符，优先级 credentials.json > `process.env`，未解析保留原占位符。
- `buildEnv(config): Record<string, string>`：渲染后过滤仍含 `{{` 的项 → key 大写 → env 对象。

## 关键逻辑
```
renderConfig(config):
  for [k, v] of entries(config):
    if v matches {{USER_*}}:
      envVar = strip {{ }}                      // 取花括号内名
      resolved = creds[envVar] || process.env[envVar]   // || 短路，对齐 Python or
      未解析则保留原占位符

buildEnv(config):
  rendered = renderConfig(config)
  filter(不含 "{{") → key.toUpperCase() → env object
```

## 注意事项
- 凭据文件 0600 在 Windows 上 `fs.chmod` 行为不同，可能无法完全生效（R-05 跨平台风险）。
- 占位符格式固定 `{{USER_*}}`，修改格式需同步 server 端模板生成逻辑。
- `buildEnv` key 转大写，配置键名设计需避免冲突（如 `path` → `PATH` 会覆盖系统 PATH）。
- 文件格式与 Python 版完全相同，`||` 短路与 Python `or` 语义一致（空串走兜底）。
- 被 cli、spawn-env、task-runner、interactive 使用；task-runner 在 spawn 前间接经 buildSpawnEnv 调用。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
