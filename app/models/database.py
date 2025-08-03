"""应用程序的数据库模型。

该模块导出所有数据库模型，方便在其他地方统一导入。
"""

from app.models.thread import Thread
from app.models.message import Message

# 导出所有模型类，供其他模块使用
__all__ = ["Thread", "Message"]
