---
author: flow-machine-draft
created_at: 2026-10-19T07:28:14.197Z
---
# 任务注册表（Tasks）— 2026-10-19-translate-live-verify

- [x] task-01: 默认 repo 更换——config.py translate_model_repo 与 README 三处引用同步换 jiangzhuo9357/opus-mt-en-zh-ct2（404 实证替换）；config 与 README 一致性核对后勾
- [x] task-02: worker EOS 协议修复——spm 路径 encode 尾追 </s>（eos_id 派生）、decode 剥特殊 piece；真模型冒烟译文流畅无重复循环后勾
- [x] task-03: live 测试落地并真机跑绿——test_live_engine.py（worker 子进程 + 端点全链路，EOS 乱码指纹回归 + 保护段保留断言）；TRANSLATE_LIVE_TEST=1 全绿 + 既有 mock 面全绿 + 默认 skip 验证后勾
