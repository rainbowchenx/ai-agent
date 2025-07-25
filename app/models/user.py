"""该文件包含用户模型。"""

from typing import TYPE_CHECKING, List
import bcrypt
from sqlmodel import Field, Relationship

from app.models.base import BaseModel

if TYPE_CHECKING:
    from app.models.session import Session


class User(BaseModel, table=True):
    """用户模型，用于存储用户账户。

    Attributes:
        id: 主键
        email: 用户邮箱（唯一）
        hashed_password: 经过bcrypt哈希处理的密码
        created_at: 用户创建时间
        sessions: 用户会话关系
    """

    id: int = Field(default=None, primary_key=True)
    email: str = Field(unique=True, index=True)
    hashed_password: str
    sessions: List["Session"] = Relationship(back_populates="user")

    def verify_password(self, password: str) -> bool:
        """验证提供的密码是否与哈希值匹配。"""
        return bcrypt.checkpw(password.encode("utf-8"), self.hashed_password.encode("utf-8"))

    @staticmethod
    def hash_password(password: str) -> str:
        """使用bcrypt哈希密码。"""
        salt = bcrypt.gensalt()
        return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


# 避免循环导入
from app.models.session import Session  # noqa: E402
