---
author: qinyi
created_at: 2026-09-20 17:19:12
scale: small
---

# 设计文档（Design）— claude 引擎 autocompact 配置（provider 级）

## 背景

生产 claude 引擎长会话（如 6e213eb3，5 天 113 轮）在约 160K tokens 处频繁触发引擎自动压缩（COMPACT_STATUS compacting→success 时间线实证）。机制：Claude Code 按 resolved autocompact window（默认=模型 believed limit，200K 级）的默认比例（≈80%，预留压缩调用自身缓冲）触发——160K 不是异常而是引擎默认设计点。平台此前无任何干预手段（daemon 驱动零 autocompact 配置引用）。用户要求做成 provider 级可配项。

管道现状（全部现成）：`llm_providers.settings_config`（自由 dict JSON 列）→ backend `lease/context.py:143/:215` 原样透传 → daemon `claude-settings.ts` 白名单键写入 `$CLAUDE_CONFIG_DIR/settings.json` → claude code 启动读取生效。

## 设计目标

- **FR-1**：claude 引擎 autocompact 三键可配——`autoCompactWindow`（数字，压缩窗口；配大于默认→更高水位触发）、`autoCompactEnabled`（布尔开关）、`precomputeCompactionEnabled`（布尔，后台预计算压缩摘要）。
- **FR-2**：配置落 provider 级 `settings_config`，零迁移、零协议改动、agent_profiles 零改动（D-001）。
- **FR-3**：前端 provider 表单按 `agent_kind=claude` 条件展示「引擎自动压缩」区，含 window 超模型实际窗口会在触发压缩前撞硬限报错的风险提示。

## 非目标

- profile 级配置（D-001 否决：无 JSON 列需迁移，语义属 provider）。
- pi/codex 引擎压缩配置（各有原生机制，另立变更）。
- 阈值比例可配（SDK 无 threshold 可写项，D-003 实证）。

## 拆分判断

单变更 scale=small（3 文件级改动：daemon 白名单/前端表单/文档），走 quick（`--linked-changes` 本变更）。

## 总体方案

1. **daemon**（sillyhub-daemon/src/claude-settings.ts）：`TOP_LEVEL_KEYS` 加三键；`buildSettingsObject` 值守护——`autoCompactWindow` 非正整数跳过、两开关非布尔跳过（best-effort 零回归语义：非法值不写文件不抛）。docblock 更新（键清单+语义+风险注记）。
2. **前端**（frontend/src/components/llm-providers/llm-provider-form.tsx）：agent_kind=claude 时渲染「引擎自动压缩」折叠区——`autoCompactEnabled` 开关（三态：空=跟随引擎）、`autoCompactWindow` 数字输入（token 数，占位提示如「默认≈believed limit×80% 触发，配大更晚压」）、`precomputeCompactionEnabled` 开关；Extra footer 风险提示行。提交时写进 `settings_config` 三键（空值剔除=跟随引擎）。
3. **文档**（.sillyspec/docs/SillyHub/modules/daemon.md）：增量段记三键链路与触发机制。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/claude-settings.ts | TOP_LEVEL_KEYS 加三键 + 值守护 + docblock |
| 修改 | sillyhub-daemon/tests/claude-settings.test.ts | 三键白名单/值守护/零回归用例追加 |
| 修改 | frontend/src/components/llm-providers/llm-provider-form.tsx | claude 分支「引擎自动压缩」区（三键 + 风险提示） |
| 修改 | frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx | 表单区渲染/提交断言 |
| 修改 | .sillyspec/docs/SillyHub/modules/daemon.md | 增量段 |

（无新建文件；后端零改动——settings_config 自由 dict 既有校验。）

## 需求映射

FR-1→daemon 白名单+表单三键；FR-2→D-001 落点（零迁移）；FR-3→表单条件展示+风险提示。

## 风险与开放问题

- **R-01**（用户侧风险，表单提示承载）：window 配置超过模型实际窗口 → 请求先撞硬限报错而非触发压缩（引擎原生行为，平台不拦截只提示）。
- **R-02**（低）：settings.json 为会话级引擎读取，已运行中的会话不热更新——新配置下一会话/下一轮 spawn 生效（claude-settings 每 spawn 前重写，行为与 attribution 键一致）。

## 生命周期契约：无（配置静态透传，无新状态流转/事件）

## 自审（Self-Review）

- 锚点核对：settings_config 透传链（lease/context.py:143/:215）、claude-settings.ts 白名单机制（:42-47/:63-78）、SDK 三键（sdk.d.ts :7567/:5792/:5794 Settings 块）均本会话实读实证。
- 测试文件存在性待实现前 ls 核验（sillyhub-daemon/tests/claude-settings.test.ts 与前端表单测试路径），路径不符则改为实际存在的测试文件内追加用例。

## 决策引用

D-001（仅 provider 级）/ D-002（方案 A 白名单直达）/ D-003（三键与触发机制依据）——见 decisions.md。
