---
author: flow-machine-draft
created_at: 2026-10-12T01:52:37.621Z
---
# 决策记录（Decisions）— 2026-10-12-clipboard-fallback

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 风险：execCommand 已被 WHATWG 废弃，未来浏览器可能移除——届时降级路径失效回到报错横幅（与修复前同等），Async Clipboard 主路径不受影响；非安全上下文下无其它程序化通道（Service Worker 剪贴板方案依赖 HTTPS），移除前该方案是唯一解。 - 放弃方案 A：改部署形态强制 HTTPS/localhost——部署约束变更不归前端代码管，且局域网自签证书有额外运维成本；代码侧降级是即时空运的解。 - 放弃方案 B：navigator.clipboard 缺失时直接报「请在 HTTPS 下使用」引导文案——不解决功能不可用本身，execCommand 降级在目标浏览器（Chrome/Edge/Firefox 全支持）下即可用。
