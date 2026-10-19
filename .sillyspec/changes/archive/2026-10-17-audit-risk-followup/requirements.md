---
author: flow-machine-draft
created_at: 2026-10-16T23:01:17.452Z
---
# 需求规格（Requirements）— 2026-10-17-audit-risk-followup

## 功能需求

### FR-01: daemon 重启载入时 dsh/zcode 会话记录通过 VALID_PROVIDERS 校验不再静默丢弃，守护测试断言白名单与驱动注册表键一致

- 载入白名单必须从 INTERACTIVE_PROVIDERS 注册表键单源推导（禁止手写 provider 清单）；任何注册表内 provider 的会话记录重启载入时必须保留。

#### 场景：主路径
- Given sessions.json 含 INTERACTIVE_PROVIDERS 全部键（claude/codex/pi/cursor/dsh/zcode）的记录
- When daemon 重启执行 load
- Then 全部记录通过校验保留、无一静默丢弃；provider 不在注册表（如 foo）的记录仍被丢弃（损坏隔离语义不变）

### FR-02: run 仍活跃（current_run_status 非 null）时不再误标「已执行完成」角标，活跃转 null 仍正确标记，测试覆盖 running 持续不标与 running 转 null 标记两态

- run 完成通知标记必须在 current_run_status 由活跃转 null 时才写入；run 仍活跃（非 null）时禁止写入。

#### 场景：主路径
- Given 列表上一快照某会话 run=running
- When 刷新后该会话 run 仍 running（行数据有其它字段变化）
- Then 不写完成标记、不亮完成角标；When 刷新后 run 归 null 且会话非终态、非当前选中 → 写完成标记亮角标

### FR-03: 登出清理注册表收录 sillyhub:session-completed-unread: 前缀，测试断言该前缀键被清理

- 登出清理注册表必须收录 sillyhub:session-completed-unread: 前缀；clearUserScopedLocalStorage 必须删除该前缀下全部键，设备级键不受影响。

#### 场景：主路径
- Given localStorage 存在 sillyhub:session-completed-unread:sid-1
- When 登出触发 clearUserScopedLocalStorage
- Then 该键被删除；设备级键（主题/记住登录名等）保留

### FR-04: 防复活抑制面改为 pre_swap 之后现算：下载窗口内重建的同名文件不再被本地删除、陈旧 manifest 条目不再并回，测试覆盖窗口内重建场景

- 防复活抑制面必须在 pre_swap 回灌之后现算（禁止在 getSpecBundle 之前一次性计算）；下载窗口内重建（盘面复存）的同名文件必须自动退出抑制面——本地不被删除、manifest 不并回陈旧条目。仍缺失的已删文件照旧抑制不复活。

#### 场景：主路径
- Given manifest 有 docs/b.md、盘面无（已删未上行）
- When getSpecBundle 下载在途时同名文件被重建（pre_swap 上行留底）
- Then pull 落地后 docs/b.md 存在于盘面（bundle 旧内容，重建内容已在服务器留底、下跳心跳拉齐），manifest 行来自落地树现算（hash 非 T0 陈旧值）

### FR-05: zcode consume finally 对齐 codex：清 _finishTurnOnClose 槽位并 await close，幂等不双重关闭

- zcode consume 的 finally 必须删除 handle 上的 _finishTurnOnClose 槽位并兜底 await close；close 幂等（h.closing 守卫），重复调用禁止二次关闭/二次杀进程。

#### 场景：主路径
- Given 一轮 turn 收敛后输入队列自然关闭（非 terminateSession 发起 close）
- When consume 退出
- Then 槽位已删除、handle.close 恰被调用一次；terminate 链后续再关因幂等守卫为 no-op

### FR-06: applyResurrectSuppress 对越界（路径穿越）manifest 键跳过并告警，测试覆盖越界键不触发删除'

- applyResurrectSuppress 必须对解析后越出目标目录的 manifest 键（../ 或绝对形态）跳过删除并 warn 点名，禁止对越界路径执行 rm。

#### 场景：主路径
- Given 抑制集含 inside.md 与 ../victim.md，目标目录外 victim 文件存在
- When 应用抑制
- Then inside.md 被删、dir 外 victim 幸存、warn 输出含越界键名

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: test/sillyhub-daemon/tests/interactive/session-store-persistence.test.ts「单源守护：INTERACTIVE_PROVIDERS 全部键的记录载入保留（2026-10-17-audit-risk-followup——手写白名单漏 dsh/zcode 曾致重启静默丢记录，pi/cursor 同坑各一次）」
FR-02: test/frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「run 跨刷新仍活跃（running→running，列表数据有变化）→ 不误标完成角标（活跃期误报回归）」
FR-03: test/frontend/src/lib/__tests__/logout-storage.test.ts「7 类用户域前缀全清、设备级键保留、前缀精确匹配」
FR-04: test/sillyhub-daemon/tests/pull-antiresurrect.test.ts「用例5（窗口内重建保护）：下载窗口内重建的同名文件不进抑制面——不删本地、不并回陈旧条目（2026-10-17-audit-risk-followup）」
FR-05: test/sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「consume 自然退出（iq.close）→ finally 对齐 codex：清 _finishTurnOnClose 槽位 + 兜底 close（幂等单次）（2026-10-17-audit-risk-followup）」
FR-06: test/sillyhub-daemon/tests/pull-antiresurrect.test.ts「用例6（越界键防线）：applyResurrectSuppress 对越界键（../）跳过 rm 并告警——dir 外文件幸存」
