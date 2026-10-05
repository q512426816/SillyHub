---
author: flow-machine-draft
created_at: 2026-10-05T11:54:49.105Z
---
# 决策记录（Decisions）— 2026-10-05-promo-film-page

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：Canvas 中文排版与不同操作系统字体栈差异导致观感不一致——用系统中文栈（PingFang SC/微软雅黑/Noto Sans SC）+ 关键标题走 canvas measureText 动态布局兜底，避免外链字体（保 FR-01 零依赖）。 次要风险：低端机粒子量过大掉帧——粒子数与屏幕像素解耦（按 1920×1080 逻辑坐标设计，数量固定上限），主循环只做一次 clear+draw，无离屏抖动。 放弃的方案：①嵌入真实视频文件（webm）——违背「纯代码拍片」参考思路且体积失控，弃；②用 Three.js/WebGL 做三维粒子——CDN 依赖违背 FR-01，手写 WebGL 工程量与收益不成比，2D Canvas 已够表达本片视觉，弃；③接平台前端做 Next.js 页面——宣传物料应独立分发（发别人看/挂静态托管），绑进应用反而要求起服务，弃。
