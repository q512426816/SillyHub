---
author: qinyi
created_at: 2026-09-07 11:10:00
---

# sillyspec-manager 变更索引

- ql-20260910-002-dd6d | 多目标采集失败单槽位掩蔽修复——_collectOneTarget ①成功路径原内联 `this._statusError = null`，多目标循环里后位目标的成功会清掉前位目标刚记的③失败（_statusError 是机器级单槽位）：≥2 工作区且失败者不在迭代末位时心跳 sillyspec_status_error 恒 null、map 携带陈旧摘要，「区分查询失败与未安装」的 2026-09-08 目标在多工作区场景失真；改方法返回 boolean（false=记了③失败账；②能力缺失自清返回 true），collectStatusOnce 轮内聚合 anyFailed——整轮无③失败才清（legacy 单目标语义不变）；测试 64 用例（新增多目标前位失败/后位失败/恢复清空/legacy 回归 4 例）全绿 + daemon tsc 0
- ql-20260907-007-67df | runProgressJsonDefault 默认执行器 env 显式传「SILLYSPEC_SYNC_TIMEOUT_MS=20000 缺省垫底 + process.env 覆盖」并导出供直测——daemon 自身跑的 sillyspec 命令（runResolve/ghostCleanup 含平台同步收敛）同享熔断预算放宽，常量单一源在 spawn-env.ts（spawn-env 38 + sillyspec-manager 42 vitest 绿，tsc 0）。
- ql-20260907-001-5bff | 版本门官方源仲裁修镜像滞后误判「已是最新」（实测 crrcdt-hubin 滞后 3 天，清 npm 缓存无效——旧数据在镜像服务器上）：探测命令一律加 --prefer-online（跳本地 HTTP 缓存新鲜度检查）；新增 probeLatestOfficial（--registry=官方源+prefer-online 直查，失败 null 静默回退、不缓存）与 _resolveLatestForGate（本地源+官方源取较新者，官方较新时心跳缓存覆盖为官方值+记 sillyspec_latest_arbitrated）；requestManualUpgrade 强制现探（force 绕 10min 缓存）+ 仲裁，checkAndUpgrade 同接仲裁（auto 每小时自愈）；requestUpgrade/_runUpgrade 加 useOfficialRegistry（官方较新时 install 同带 --registry，失败不回退镜像——装回旧版报 success 比诚实 failed 更糟），deferred 期间 flag 保留复查时消费；installSillySpec（preflight）加可选 registry 参数缺省零变化；sillyspec-manager.test 51/51 绿（新增仲裁矩阵 8 用例）+ preflight 40 绿 + tsc 0
- ql-20260904-019-b4f4 | requestManualUpgrade 已最新从静默 no-op 改写 up_to_date 终态（from/to=local，10min 惰性过期，running/deferred in-flight 期不覆盖）——推翻 ql-20260902-003 静默决策（点升级无反馈无法与指令丢失区分）；SillySpecUpdateStatus 联合加 up_to_date，模块头状态机图同步；sillyspec-manager.test 43/43 绿 + daemon tsc 0
