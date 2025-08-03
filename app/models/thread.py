"""该文件包含线程模型。

定义了会话相关的数据模型，用于管理LangGraph的会话。
"""

from datetime import UTC, datetime

from sqlmodel import Field, SQLModel


class Thread(SQLModel, table=True):
    """会话模型，用于存储会话信息。

    该模型定义了LangGraph会话的基本信息，用于管理会话的状态和上下文。

    Attributes:
        id: 会话唯一标识符（主键，通常为UUID字符串）
        created_at: 会话创建时间（使用UTC时区）
    """

    id: str = Field(primary_key=True, description="会话唯一标识符")
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        description="会话创建时间，使用UTC时区"
    )
