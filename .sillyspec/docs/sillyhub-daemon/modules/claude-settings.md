---
schema_version: 1
doc_type: module-card
module_id: claude-settings
author: qinyi
created_at: 2026-08-18 01:45:00
---

# claude 设置合并写入器（claude-settings）

## 定位
把 lease 下发的 `provider_config.settings_config` 中白名单顶层键合并写入 `$CLAUDE_CONFIG_DIR/settings.json`。背景（spike-01 硬发现）：daemon 此前全源码无 settings.json 写入——CLAUDE_CONFIG_DIR 刻意留空做 env-only 隔离（防宿主机 cc-switch 污染）；本模块是平台 daemon 新增的写盘能力，让 attribution 等无 env 等价物的顶层开关经 claude code 读隔离目录内的 settings.json 真正生效。隔离意图是「不读宿主机 ~/.claude」，不是禁止平台写自己的隔离目录。

## 契约摘要
- 唯一导出：`applyClaudeSettings(provider_config, dir = CLAUDE_CONFIG_DIR): Promise<void>`。
- 写盘白名单 `TOP_LEVEL_KEYS`（显式枚举 4 键）：`attribution` / `enabledPlugins` / `model` / `skipDangerousModePermissionPrompt`。
- 明确**不写**：`env` 子键（归 credential-injector.toEnv，D-007）、`api_key`（只走 provider_config.api_key + auth_field，D-009；白名单枚举天然排除未知键）。
- 值过滤：undefined/null 视为未设置不写入；false / 空串 / 空对象按 JSON 语义保留（如 attribution:{commit:"",pr:"} 表示隐藏署名，合法）。

## 关键逻辑
```text
applyClaudeSettings(provider_config, dir):
  obj = 从 settings_config 取白名单键（absent/null/仅 env → {}）
  obj 为空 → 直接 return（不写文件、不抛、不删已存文件，零回归）
  mkdir(dir, recursive) + writeFile settings.json（JSON 2 空格缩进）
  写盘抛错 → console.warn 后吞掉，绝不 rethrow（增强项不阻断 spawn 主路径）
```

## 注意事项
- 零回归铁律（D-007 brownfield）：provider_config / settings_config 缺失或仅含 env → 行为与引入本模块前逐字一致（claude 走默认 + 注入 env）。
- 写盘时机 = spawn 前（两处 buildSpawnEnv 调用点旁），非 daemon 启动；daemon 单实例假设下单写同一 CLAUDE_CONFIG_DIR，无并发锁。
- 失败策略 best-effort：EACCES/ENOSPC 等 warn 后吞（与 linkSkillsToWorkdir 的 try/catch+warn 同模式），靠日志 `claude_settings_write_failed` 运维感知。
- dir 参数可注入 tmpdir 供单测隔离。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
