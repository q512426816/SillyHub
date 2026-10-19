---
author: flow-machine-draft
created_at: 2026-10-19T07:28:14.197Z
---
# 需求规格（Requirements）— 2026-10-19-translate-live-verify

## 功能需求

### FR-01: 真机 live 测试全绿：worker 子进程译文含中文且无重复循环乱码；端点全链路 engine_ready=true、译文 translated=true、围栏代码块与 URL 保护段原样保留

- 真机验证（TRANSLATE_LIVE_TEST=1 门控，真模型加载）必须全绿：worker 子进程对英文思考文本产出含 CJK 的中文译文，且禁止出现 EOS 缺失特征的同片段重复循环乱码（同一 2 字符片段连续重复 ≥8 次）；POST /api/translate/thinking 全链路（零 mock 真引擎）必须 engine_ready=true、英文条目 translated=true，围栏代码块与 URL 在译文中必须原样保留。

#### 场景：真模型推理

Given 默认模型仓库已下载到本机 HF 缓存，When 以 TRANSLATE_LIVE_TEST=1 运行 live 测试，Then worker 与端点两级用例全部通过。

#### 场景：EOS 协议回归锚

Given sentencepiece 分词路径（transformers 缺席），When 编码源文本，Then 必须手动追加 `</s>`（ct2 opus-mt 转换 config add_source_eos=false），解码必须剥离特殊 piece——违反即产生重复循环乱码被回归断言拦截。

### FR-02: 既有 translate 模块测试（mock 面）全绿零回归

- 本修复（repo 默认值更换、worker EOS 处理、新增 live 测试文件）必须保持既有 translate 模块 mock 面测试全绿；live 测试文件在未设 TRANSLATE_LIVE_TEST=1 时必须跳过（默认 skip，CI/无模型环境零成本）。

#### 场景：默认跳过

Given 未设置 TRANSLATE_LIVE_TEST，When 运行 translate 模块测试，Then live 用例 skip、其余全绿。

### FR-03: config.py 默认 repo 与 backend/app/modules/translate/README.md 一致指向可用仓库

- config.py 的 translate_model_repo 默认值与 README 环境变量表、预烤命令、Docker 片段中的 repo id 必须一致，且必须指向真机验证过可用的仓库（jiangzhuo9357/opus-mt-en-zh-ct2——原默认 michaelfeil/ct2fast-opus-mt-en-zh 实测 404）。

#### 场景：默认开箱可用

Given 联网（或 HF 镜像）环境零配置启动，When 首次翻译请求触发模型下载，Then 默认 repo 可解析下载并正常推理。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/translate/tests/test_live_engine.py「test_live_worker_subprocess_translates_cleanly」
FR-01: backend/app/modules/translate/tests/test_live_engine.py「test_live_endpoint_full_chain」
FR-02: backend/app/modules/translate/tests「既有 mock 用例回归全绿 + live 门控默认 skip」
FR-03: 不适用：配置默认值一致性（config.py 与 README 同源字符串人工核对 + 真机默认值下载验证覆盖；无独立测试面）
