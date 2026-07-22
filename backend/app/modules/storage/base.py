"""对象存储后端抽象基类（ABC）。

平台级文件中心的存储抽象层。业务代码（file 服务）只依赖本接口，不关心
底层是 MinIO / OSS / 其它 S3 兼容实现。切换存储后端只改配置 + factory 注册，
业务代码零改动（NFR-2）。

契约见 design.md §D-002，provides: StorageBackend。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator
from dataclasses import dataclass


@dataclass(frozen=True)
class ObjectStat:
    """对象元信息（head_object 返回）。"""

    size: int
    content_type: str


class StorageBackend(ABC):
    """S3 兼容对象存储后端抽象。

    四个抽象方法：put_object / get_object_stream / delete_object / head_object。
    测试用 ``app.dependency_overrides`` 注入 mock 实现，不依赖真实 MinIO（NFR-4）。
    """

    @abstractmethod
    async def put_object(self, key: str, data: bytes, content_type: str) -> None:
        """上传对象。key 为存储键（非文件原名），content_type 为 MIME 类型。"""
        raise NotImplementedError

    @abstractmethod
    def get_object_stream(self, key: str) -> AsyncIterator[bytes]:
        """按块流式读取对象（用于 StreamingResponse 下载/预览，避免大文件整体入内存）。

        实现返回异步迭代器（通常为异步生成器）。声明为非 async def 以兼容
        生成器实现与返回迭代器的 mock 注入两种写法。
        """
        raise NotImplementedError

    @abstractmethod
    async def delete_object(self, key: str) -> None:
        """删除对象（file 软删后由清理流程调用；本服务暂不直接调用）。"""
        raise NotImplementedError

    @abstractmethod
    async def head_object(self, key: str) -> ObjectStat:
        """读取对象元信息（大小/类型），不存在则抛底层异常。"""
        raise NotImplementedError

    async def aclose(self) -> None:
        """关闭底层连接（应用 lifespan shutdown 调用）。默认无操作。"""
        return None
