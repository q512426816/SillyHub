"""session_attachment 存储——内容寻址对象写入（MinIO 经 StorageBackend 抽象）。

Change 2026-08-20-session-multimodal-attachments task-02（design §4 / FR-1 / FR-3）。

- 键规则：``attachments/{user_id}/{sha256}.{ext}``——user_id 目录隔离 + 内容摘要
  寻址；扩展名取展示名后缀白名单化（未知/非法回退 ``bin``），展示名不直接进键
  路径（防路径穿越）。
- 同哈希复用（D-5）：``store_bytes`` 先 ``head_object`` 探测，命中即跳过 put
  （不可变内容寻址，同内容必同键）；head 抛不存在异常视为未命中再 put。
- 本层不建不读 DB 行（归 task-03 service）；不删对象不做引用计数（D-5）。
- 只经 ``modules/storage`` 抽象访问，禁止直接 import MinIO 客户端。
"""

from __future__ import annotations

import hashlib
import re
import uuid

from app.modules.storage.base import StorageBackend

# 扩展名白名单：字母数字 1-8 位；不匹配（含路径分隔/点号/中文等）回退 bin。
_EXT_RE = re.compile(r"^[A-Za-z0-9]{1,8}$")


def _ext_of(name: str) -> str:
    """展示名 → 白名单化扩展名（小写；无后缀/非法回退 bin）。"""
    _, _, raw_ext = name.rpartition(".")
    ext = raw_ext.strip().lower()
    return ext if _EXT_RE.fullmatch(ext) else "bin"


class SessionAttachmentStorage:
    """会话附件对象存储（纯函数式 helper，构造注入 StorageBackend）。"""

    def __init__(self, backend: StorageBackend) -> None:
        self._backend = backend

    def object_key_for(self, user_id: uuid.UUID, sha256: str, name: str) -> str:
        """内容寻址键：attachments/{user_id}/{sha256}.{ext}。"""
        return f"attachments/{user_id}/{sha256}.{_ext_of(name)}"

    async def store_bytes(
        self,
        *,
        user_id: uuid.UUID,
        data: bytes,
        media_type: str,
        name: str,
    ) -> tuple[str, str]:
        """写入对象字节，返回 (object_key, sha256)。

        同 user 同内容（sha256）命中既有对象时跳过 put（幂等；重复 put 亦无害，
        跳过只为省一次传输）。调用方据返回值建 DB 行。
        """
        sha256 = hashlib.sha256(data).hexdigest()
        object_key = self.object_key_for(user_id, sha256, name)
        exists = False
        try:
            await self._backend.head_object(object_key)
            exists = True
        except Exception:
            # head 不存在抛底层异常 → 未命中（NFR-4 mock 同语义）
            exists = False
        if not exists:
            await self._backend.put_object(object_key, data, media_type)
        return object_key, sha256

    async def read_bytes(self, object_key: str) -> bytes:
        """整体读对象字节（附件 base64 内联用；单附件 ≤20MB 上限内可控）。"""
        chunks: list[bytes] = []
        async for chunk in self._backend.get_object_stream(object_key):
            chunks.append(chunk)
        return b"".join(chunks)
