"""该文件包含会话模型。

定义了聊天会话相关的数据模型，用于管理用户的聊天会话。
"""

from typing import (
    TYPE_CHECKING,
    List,
)

from sqlmodel import (
    Field,
    Relationship,
)

from app.models.base import BaseModel

if TYPE_CHECKING:
    from app.models.user import User


class Session(BaseModel, table=True):
    """会话模型，用于存储聊天会话信息。

    该模型定义了聊天会话的基本信息，包括会话ID、名称等，并与用户和消息建立关联关系。

    Attributes:
        id: The primary key
        user_id: Foreign key to the user
        name: Name of the session (defaults to empty string)
        created_at: When the session was created
        messages: Relationship to session messages
        user: Relationship to the session owner
    """

    id: str = Field(primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    name: str = Field(default="")
    user: "User" = Relationship(back_populates="sessions")
