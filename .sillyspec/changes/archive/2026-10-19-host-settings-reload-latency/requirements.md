---
author: agent
created_at: 2026-10-19T02:34:00.000Z
---
# 需求规格（Requirements）— 2026-10-19-host-settings-reload-latency

## 功能需求

### FR-01: 宿主机档位热跟随延迟收窄

daemon 的宿主 settings.json 监听默认轮询节拍**必须**由 3000ms 收窄到 1000ms，且**必须**以
单一源导出常量 `HOST_SETTINGS_POLL_INTERVAL_MS` 承载（守护测试断言防魔数漂移）；`pollIntervalMs`
注入覆盖口径**必须**不变；两拍一致去抖、env 块指纹、损坏/缺失容错、关闭阀、会话筛选语义
**禁止**任何回退。端到端（切档 → 引擎重载完成）**必须**真机实测 ≤4 秒并留痕。

#### 场景：主路径——切档后更快稳定

Given watcher 已建基线、存在本机默认宿主目录会话；
When 宿主 settings.json env 块换新档位；
Then 去抖确认窗口 ≤2 秒（两拍 × 1s），引擎重载随后完成，端到端 ≤4 秒。

#### 场景：边界——语义零回退

Given 既有 watcher 8 例 + HOST-1~6 测试面；
When 跑 tests/interactive；
Then 全绿（非 env 变化不触发/损坏容错/关闭阀/筛选矩阵行为逐字不变）。

### FR-02: deploy 技能文档验证命令与端点行为一致

`.zcode/skills/sillyhub-docker-deploy/SKILL.md` 的 daemon bundle 分发验证命令**必须**由
HEAD（实测 405，端点仅允许 GET）改为 GET 口径（`-o /dev/null -w '%{http_code} %{content_type}'`），
并**必须**保留「应返回 200 + application/javascript」的判定语义。

#### 场景：按文档执行即通过

Given 部署后的 backend；
When 照改后文档命令执行；
Then 输出 `200 application/javascript`（不再 405 误导排障方向）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`）

FR-01: sillyhub-daemon/tests/interactive/host-settings-watcher.test.ts「HOST_SETTINGS_POLL_INTERVAL_MS — 默认节拍单一源：默认轮询节拍为 1000ms（提速 3s→1s；注入覆盖口径不变）」+ 既有 8 例 watcher 用例与 HOST-1~6 全量回归（tests/interactive 全绿）+ 部署后真机延迟实测留痕（发布记录）
FR-02: 不适用：纯文档命令修正（.zcode/skills 的 SKILL.md 非可执行测试面）——行为验证随部署执行改后命令（输出 200 application/javascript），留痕于发布记录
