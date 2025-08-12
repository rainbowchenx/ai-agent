"""该文件包含用户模型。

定义了用户账户相关的数据模型，包括用户信息、密码验证等功能。
"""

from typing import TYPE_CHECKING, List
import bcrypt
from sqlmodel import Field, Relationship

from app.models.base import BaseModel

if TYPE_CHECKING:
    from app.models.session import Session
    from app.models.knowledge import KnowledgeDocument


class User(BaseModel, table=True):
    """用户模型，用于存储用户账户信息。

    该模型定义了用户的基本信息，包括邮箱、密码等，并提供密码验证功能。

    Attributes:
        id: 用户唯一标识符（主键）
        email: 用户邮箱地址（唯一，用于登录）
        hashed_password: 经过bcrypt哈希处理的密码（安全存储）
        created_at: 用户账户创建时间（继承自BaseModel）
        sessions: 用户关联的会话列表（一对多关系）
    """

    id: int = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str 
    sessions: List["Session"] = Relationship(back_populates="user")
    knowledge_documents: List["KnowledgeDocument"] = Relationship(back_populates="user")

    def verify_password(self, password: str) -> bool:
        """验证提供的密码是否与存储的哈希值匹配。

        Args:
            password: 待验证的明文密码

        Returns:
            bool: 密码匹配返回True，否则返回False
        """
        return bcrypt.checkpw(password.encode("utf-8"), self.hashed_password.encode("utf-8"))

    @staticmethod
    def hash_password(password: str) -> str:
        """使用bcrypt算法对密码进行哈希处理。

        Args:
            password: 待哈希的明文密码

        Returns:
            str: 哈希后的密码字符串
        """
        salt = bcrypt.gensalt()
        return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


# 避免循环导入问题
from app.models.session import Session  # noqa: E402
