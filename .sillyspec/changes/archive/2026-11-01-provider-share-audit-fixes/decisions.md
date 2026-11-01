# 决策记录

## D-001@v1 畸形 UUID 选 422 不选 404

**理由**：畸形 UUID 是客户端格式错误而非资源不存在——404 会与「不泄漏存在性」的 owner 级语义混淆且掩盖客户端 bug；422 与 RequestValidationError 同族，前端 apiFetch 对 4xx 已有统一错误面零适配。备选 404 已拒绝（design 风险与死路段落留痕）。
