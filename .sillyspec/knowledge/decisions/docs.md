# 决策知识 — docs

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : 缺口①触发形态 — 心跳恢复事件触发
状态：implemented
变更：2026-08-30-daemon-self-heal
锚点：未记录
最近确认：ecdae9ba
理由：`_sendHeartbeatOnce` 成功分支、degraded 累计 >720s 守卫、复用 boot

## D-003@v1 : 下载校验口径 — 零子进程
状态：implemented
变更：2026-08-30-daemon-self-heal
锚点：未记录
最近确认：ecdae9ba
理由：buffer ≥64KB 且 `BUILD_ID` 正则可提取（与 `DISK_BUILD_ID_RE` 同款，

## D-005@v1 : respawn 最后防线 — 不退出保活
状态：implemented
变更：2026-08-30-daemon-self-heal
锚点：未记录
最近确认：ecdae9ba
理由：spawn 前同款校验，不过 → error 日志 + 提前 return 不退出；返回类型

## D-009@v1 : respawn 前校验提前到 stop 之前（主拦截点）
状态：implemented
变更：2026-08-30-daemon-self-heal
锚点：未记录
最近确认：ecdae9ba
理由：新增 `validateBundleOnDisk` 导出；`_tryUpdate` 在 stop() **之前**调用：

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-05-promo-film-page
锚点：未记录
最近确认：9462f6557e5ce850ea729f8ca0d71fa044617fd7
理由：最大风险：Canvas 中文排版与不同操作系统字体栈差异导致观感不一致——用系统中文栈（PingFang SC/微软雅黑/Noto Sans SC）+ 关键标题走 canvas measureText 动态布局兜底，避免外链字体（保 FR-01 零依赖）。 次要风险：低端机粒子量过大掉帧——粒子数与屏幕像素解耦（按 1920×1080 逻辑坐标设计，数量固定上限），主循环只做一次 clear+draw，无离屏抖动。 放弃的方案：①嵌入真实视频文件（webm）——违背「纯代码拍片」参考思路且体积失控，弃；②用 Three.js/WebGL 做三维粒子——CDN 依赖违背 FR-01，手写 WebGL 工程量与收益不成比，2D Canvas 已够表达本片视觉，弃；③接平台前端做 Next.js 页面——宣传物料应独立分发（发别人看/挂静态托管），绑进应用反而要求起服务，弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-05-promo-film-v2
锚点：未记录
最近确认：7da35f4cb7be766ec46365637cb77fc11bbe2df5
理由：最大风险：①截图内含真实业务信息（内网 Git 地址、成员姓名）——已按用户提供的环境授权采集，影片内嵌说明「界面来自真实运行中的 SillyHub」；如需脱敏版后续可换资产重跑。②28 张图约 3.5MB，首帧前需预解码——用「首屏渐进 + 按幕预取」策略（当前幕及下一幕图片优先解码），海报页停留期预热全部资产，点击播放时资源已就绪。③5 分钟单页 rAF 长跑内存——所有节点按幕创建/销毁，无无限增长的 livePads/定时器（音乐节点按小节自带终止）。 放弃的方案：①录屏视频嵌入（webm）——体积失控且违背纯代码拍片思路；②iframe 嵌线上环境实况——需要账号态且播放不可控（seek 无法重现），改为确定性截图 + 标注动画；③继续 v1 引擎修补——shadowBlur 散布各幕，修不干净，重写引擎成本低于维护。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-13-multiturn-changeid-misjudge
锚点：未记录
最近确认：0bdf89c9040ff7158bb56931f0d243a251fd97ef
理由：最大风险：把"interactive + run.change_id 非空"原本唯一指代的 stage 派发会话误改成 active——已排除：stage 派发会话在 create.py:291 写 session 级 change_id，新锚下仍命中单轮收口（FR-02 场景锁定）；线上验证存在 session.change_id 非空的存量 stage 会话。放弃方案：①按 session_kind/origin=='chat' 判定——线上实证 stage 会话 kind/origin 同为 'chat'（见排查记录），不可区分，弃；②扩展 D-006 豁免表到 completed——治标不治本（completed 本不该进豁免判断），且会误保活真单轮任务，弃；③daemon 侧不给聊天轮打 change_id 锚——归因功能是 2026-10-12 刚上的产品能力，回退损失审计面，弃。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-files-refresh-explicit-sync
锚点：未记录
最近确认：42704a75aad01b355dbe090f0562ddc95090d094
理由：最大风险：点击刷新在 3s 预算内同步未完成 → 本次返回旧数据（用户可能感知「点了没变化」）。缓解：daemon 防抖窗口内再点秒回且数据已新（两次点击内必见新数据）；后续若体验仍差可前端加「同步中」提示。试过但放弃：①异步触发+前端延时补拉（方案更优但改动面含前端联动逻辑，超 thin 边界——留作后续升级）；②只降超时不动触发面（悬浮面板轮询仍周期性打 CLI，不解决「一直慢」根因）。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-14-release-notes-server-sync
锚点：未记录
最近确认：c0d30b157200e183168da8c8872fdab1772b8097
理由：- **最大风险**：镜像目录在 /tmp（服务器重启可能被清）→ 页面短暂空窗。接受：每次部署全量重传自愈；若清空窗口期需要看历史，scp 本地 docs/releases 即恢复。 - **放弃方案 A（API 上报+落库）**：需写端点+鉴权链+数据库表，实现面大；D-004 大变更时用户已裁决「写文件+只读」路线，本变更仅补数据源物理可达性，不推翻既有裁决。 - **放弃方案 B（服务器放完整 git 仓库）**：服务器 /opt/sillyhub 仓库存在但不在挂载面（/tmp），且引入服务器侧 git 拉取/凭证维护成本；镜像目录只需 scp 一个目录，最小面。
