---
author: qinyi
created_at: 2026-06-03T00:00:00
---

# prototype

## 定位

原型目录，设计用于存放早期原型代码或实验性页面。当前该目录不存在（`prototype/` 在项目根目录中缺失），说明项目未使用独立的原型目录。原型验证实际在 `.sillyspec/changes/*/prototype-*.html` 中以 HTML 单文件形式进行。

**负责：**
- （预留）早期原型和实验性代码的独立存放

**不负责：**
- 生产代码（在 `backend/` 和 `frontend/` 中）
- 正式组件或页面（在 `frontend/src/` 中）

## 契约摘要

（目录当前为空或不存在，无契约可摘要。原型验证实际通过 SillySpec 变更流程中的 HTML 原型文件完成。）

## 关键逻辑

```
# 当前状态
prototype/ 目录不存在于项目根目录

# 实际原型验证位置
.sillyspec/changes/<change-id>/prototype-<change-id>.html
# 例: prototype-2026-06-02-spec-bootstrap-agent-stream-interaction.html
```

## 注意事项

- 如果未来创建此目录，需更新本卡片
- 当前原型以 HTML 单文件形式存放在 SillySpec 变更目录中
- 本文件作为占位，标记该模块路径已被扫描覆盖

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
