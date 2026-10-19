"""翻译子进程 worker（change 2026-10-19-thinking-zh-translate）。

CTranslate2 opus-mt-en-zh int8 模型加载与推理在独立子进程内完成（主进程零
ctranslate2 常驻内存），主进程经 ``engine.TranslateSubprocessProxy`` 与本进程
按行协议通信（embedding_worker 同款）：

- 请求（单行 JSON）：``{"id": int, "op": "translate", "texts": [str, ...]}``
- 响应（单行 JSON）：``{"id": int, "ok": true, "translations": [str, ...]}`
  或失败 ``{"id": int, "ok": false, "error": str}``

三闸自灭：闲置 ``idle_exit_sec`` / 父进程 stdin EOF / 硬寿命帽
``WORKER_MAX_LIFETIME_SEC``。启动重置 oom_score_adj（Windows/macOS 跳过）。

模型解析（``_resolve_model_dir``）：

1. 入参是含 ``config.json`` 的本地目录（TRANSLATE_MODEL_DIR 离线预置形态）
   → 直接使用零下载；
2. 否则视为 HF repo id → ``huggingface_hub.snapshot_download``（尊重
   HF_ENDPOINT 镜像与 HF_HOME 缓存变量）。

tokenize 分层回退（``_load_tokenizers``）：transformers AutoTokenizer →
sentencepiece（source.spm/target.spm）→ 都缺席时报错退出（主进程 fail-soft）。

命令行：``python -m app.modules.translate.translate_worker <model_spec> [idle_exit_sec]``
"""

from __future__ import annotations

import json
import queue
import sys
import threading
import time
from pathlib import Path

WORKER_MAX_LIFETIME_SEC = 3600.0

_EOF = object()  # 读线程 stdin 结束哨兵


def _reader_thread(stdin: object, out: queue.Queue) -> None:
    """逐行读 stdin 入队；EOF/异常入哨兵（daemon 线程，进程退出不阻塞）。"""
    try:
        for line in stdin:
            out.put(line)
    except Exception:  # 管道断裂等一律按 EOF 处理
        pass
    finally:
        out.put(_EOF)


def _reset_oom_score() -> None:
    """把自身 oom_score_adj 重置为 0（容器 OOM 时优先牺牲本子进程）。

    Windows/macOS 无 /proc——写入失败仅跳过（fail-soft，三平台兼容）。
    """
    try:
        with open("/proc/self/oom_score_adj", "w") as f:
            f.write("0")
    except OSError:
        pass


def _resolve_model_dir(model_spec: str) -> str:
    """模型目录解析：本地目录直用 / repo id 自动下载。"""
    spec_path = Path(model_spec)
    if spec_path.is_dir() and (spec_path / "config.json").is_file():
        return str(spec_path)
    from huggingface_hub import snapshot_download  # lazy：缺席时 fail-soft 报错

    return snapshot_download(repo_id=model_spec)


class _Tokenizers:
    """source tokenize / target detokenize 双侧封装（分层回退见模块 docstring）。"""

    def __init__(self, model_dir: str) -> None:
        self._hf_tok = None
        self._src_sp = None
        self._tgt_sp = None
        try:
            from transformers import AutoTokenizer

            self._hf_tok = AutoTokenizer.from_pretrained(model_dir)
            return
        except Exception:
            pass  # transformers 缺席/目录无其识别的 tokenizer 文件 → sentencepiece
        import sentencepiece as spm

        def _find(prefixes: tuple[str, ...]) -> Path:
            for name in prefixes:
                cand = Path(model_dir) / name
                if cand.is_file():
                    return cand
            raise RuntimeError(
                f"no tokenizer files found in {model_dir} (tried transformers + {prefixes})"
            )

        self._src_sp = spm.SentencePieceProcessor(model_file=str(_find(("source.spm",))))
        self._tgt_sp = spm.SentencePieceProcessor(model_file=str(_find(("target.spm",))))

    def encode(self, text: str) -> list[str]:
        if self._hf_tok is not None:
            ids = self._hf_tok(text, add_special_tokens=True)["input_ids"]
            return self._hf_tok.convert_ids_to_tokens(ids)
        return self._src_sp.encode(text, out_type=str)

    def decode(self, pieces: list[str]) -> str:
        if self._hf_tok is not None:
            ids = self._hf_tok.convert_tokens_to_ids(pieces)
            return self._hf_tok.decode(ids, skip_special_tokens=True)
        return self._tgt_sp.decode(pieces)


def _translate_once(translator: object, toks: _Tokenizers, texts: list[str]) -> list[str]:

    batch = [toks.encode(t) for t in texts]
    results = translator.translate_batch(
        batch, beam_size=4, max_decoding_length=512, max_batch_size=32
    )
    return [toks.decode(r.hypotheses[0]) for r in results]


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print(json.dumps({"id": None, "ok": False, "error": "model_spec required"}))
        return 2
    model_spec = args[0]
    try:
        idle_exit_sec = float(args[1]) if len(args) > 1 else 600.0
    except ValueError:
        idle_exit_sec = 600.0

    _reset_oom_score()

    try:
        model_dir = _resolve_model_dir(model_spec)
        import ctranslate2

        translator = ctranslate2.Translator(model_dir, device="cpu", compute_type="int8")
        toks = _Tokenizers(model_dir)
    except Exception as exc:  # 模型解析/加载失败：报错退出，主进程按不可用降级
        print(
            json.dumps(
                {
                    "id": None,
                    "ok": False,
                    "error": f"model load failed: {type(exc).__name__}: {exc}",
                }
            )
        )
        sys.stdout.flush()
        return 3

    lines: queue.Queue = queue.Queue()
    threading.Thread(target=_reader_thread, args=(sys.stdin, lines), daemon=True).start()
    started = time.monotonic()
    last_active = started
    while True:
        now = time.monotonic()
        if now - last_active >= idle_exit_sec:  # 闸 1：闲置
            break
        if now - started >= WORKER_MAX_LIFETIME_SEC:  # 闸 3：硬寿命帽
            break
        timeout = max(0.05, min(1.0, idle_exit_sec - (now - last_active)))
        try:
            item = lines.get(timeout=timeout)
        except queue.Empty:
            continue
        if item is _EOF:  # 闸 2：父进程消失
            break
        last_active = time.monotonic()
        req_id = None
        try:
            req = json.loads(item)
            req_id = req.get("id") if isinstance(req, dict) else None
            if not isinstance(req, dict) or req.get("op") != "translate":
                raise ValueError(f"unknown op: {req.get('op') if isinstance(req, dict) else req!r}")
            texts = req["texts"]
            if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
                raise ValueError("texts must be list[str]")
            if not texts:
                resp = {"id": req_id, "ok": True, "translations": []}
            else:
                resp = {
                    "id": req_id,
                    "ok": True,
                    "translations": _translate_once(translator, toks, texts),
                }
        except Exception as exc:  # 单请求失败不断进程（下一条照常）
            resp = {"id": req_id, "ok": False, "error": f"{type(exc).__name__}: {exc}"}
        sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
