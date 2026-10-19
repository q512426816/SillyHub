---
author: flow-machine-draft
created_at: 2026-10-19T01:38:39.773Z
---
# 提案书（Proposal）— 2026-10-19-host-settings-live-reload

## 动机

任务原话转写：本机默认会话自动跟随宿主机档位切换

动机与背景：本机默认（未绑平台供应商）的 claude 会话，其引擎进程对宿主机 ~/.claude/settings.json 的行为是「网关(base_url/token)每轮热重读、模型名一经确定不再重解析」（2026-10-19 受控实验实证）。因此用户用 cc-switch 换档后：GLM 档（不写 ANTHROPIC_MODEL）期间启动的会话能实时跟随；MiniMax 档（显式写 ANTHROPIC_MODEL=MiniMax-M2.7[1M]）期间启动/复活过的会话、以及被 /model 钉过模型的会话，模型名被烙死——切回 GLM 后「停留在 minimax」，且下一轮会以 model=MiniMax-M2.7 打智谱端点，极可能 400 modelCode 不存在（ql-20260822-001 同款实证）。目前只能手动 /model 切回或重启 daemon。
方案：daemon 侧监听宿主机 settings.json 的 env 块指纹；确认变化后，对所有「本机默认 + claude 引擎 + 宿主目录 transcript + 非终态」的会话复用既有配置切换状态机（markPendingConfigSwitch：空闲立即 reloadWithConfig、运行中挂 pendingConfigSwitch 到轮边界）重载引擎——新引擎按当前宿主档位重新解析网关与模型。平台供应商会话（隔离 env）与隔离目录 transcript 会话不受影响（它们本就不读宿主配置）。

成功标准：
- daemon 新增宿主机 settings.json env 块变化监听（轮询+指纹+去抖确认，跨平台 Win/Linux/macOS）：确认变化后对本机默认会话自动重载引擎（空闲立即、运行中不打断当前轮、轮边界生效），重载走既有 _reloadSession 内核（失败回滚 R-01、per-session 串行化、/model 钉随旧进程消亡）
- 触发精度：仅 env 块变化触发（permissions/hooks 等非 env 字段变化、文件缺失、JSON 损坏均不触发不抛异常）；启动时建基线不触发；平台供应商会话与隔离目录（CLAUDE_CONFIG_DIR）会话零触碰；提供 SILLYHUB_HOST_SETTINGS_WATCH=0 关闭阀
- 守护测试：watcher（基线不触发/env 变化触发/非 env 变化不触发/损坏容错/stop 停) + 会话筛选矩阵（本机默认重载/平台供应商不重载/隔离目录不重载/运行中延迟到轮边界后重载）+ manager 集成（真实 start() 后改 tmp settings 文件触发重载、resume key 不变、无 prompt 喂入）
- 相关 daemon 测试绿 + tsc 零错；部署后真机验证留痕（改档位 → daemon 日志 host_settings_change_reload + 下一轮按新档位出词）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. daemon 新增宿主机 settings.json env 块变化监听（轮询+指纹+去抖确认，跨平台 Win/Linux/macOS）：确认变化后对本机默认会话自动重载引擎（空闲立即、运行中不打断当前轮、轮边界生效），重载走既有 _reloadSession 内核（失败回滚 R-01、per-session 串行化、/model 钉随旧进程消亡）
2. 触发精度：仅 env 块变化触发（permissions/hooks 等非 env 字段变化、文件缺失、JSON 损坏均不触发不抛异常）；启动时建基线不触发；平台供应商会话与隔离目录（CLAUDE_CONFIG_DIR）会话零触碰；提供 SILLYHUB_HOST_SETTINGS_WATCH=0 关闭阀
3. 守护测试：watcher（基线不触发/env 变化触发/非 env 变化不触发/损坏容错/stop 停) + 会话筛选矩阵（本机默认重载/平台供应商不重载/隔离目录不重载/运行中延迟到轮边界后重载）+ manager 集成（真实 start() 后改 tmp settings 文件触发重载、resume key 不变、无 prompt 喂入）- 相关 daemon 测试绿 + tsc 零错；部署后真机验证留痕（改档位 → daemon 日志 host_settings_change_reload + 下一轮按新档位出词）

## 成功标准（可验证）

1. daemon 新增宿主机 settings.json env 块变化监听（轮询+指纹+去抖确认，跨平台 Win/Linux/macOS）：确认变化后对本机默认会话自动重载引擎（空闲立即、运行中不打断当前轮、轮边界生效），重载走既有 _reloadSession 内核（失败回滚 R-01、per-session 串行化、/model 钉随旧进程消亡）
2. 触发精度：仅 env 块变化触发（permissions/hooks 等非 env 字段变化、文件缺失、JSON 损坏均不触发不抛异常）；启动时建基线不触发；平台供应商会话与隔离目录（CLAUDE_CONFIG_DIR）会话零触碰；提供 SILLYHUB_HOST_SETTINGS_WATCH=0 关闭阀
3. 守护测试：watcher（基线不触发/env 变化触发/非 env 变化不触发/损坏容错/stop 停) + 会话筛选矩阵（本机默认重载/平台供应商不重载/隔离目录不重载/运行中延迟到轮边界后重载）+ manager 集成（真实 start() 后改 tmp settings 文件触发重载、resume key 不变、无 prompt 喂入）- 相关 daemon 测试绿 + tsc 零错；部署后真机验证留痕（改档位 → daemon 日志 host_settings_change_reload + 下一轮按新档位出词）
