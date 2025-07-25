"""该文件包含注册、登录、会话创建的请求和响应的数据模型。"""

import re
from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, SecretStr, field_validator


class Token(BaseModel):
    """ 用于登录、会话创建的token.

    Attributes:
        access_token: 访问令牌
        token_type: 令牌类型（始终为 "bearer"）
        expires_at: 令牌过期时间
    """

    access_token: str = Field(..., description="The JWT access token")
    token_type: str = Field(default="bearer", description="The type of token")
    expires_at: datetime = Field(..., description="The token expiration timestamp")


class TokenResponse(BaseModel):
    """登录的响应模型。

    Attributes:
        access_token: 访问令牌
        token_type: 令牌类型（始终为 "bearer"）
        expires_at: 令牌过期时间
    """

    access_token: str = Field(..., description="The JWT access token")
    token_type: str = Field(default="bearer", description="The type of token")
    expires_at: datetime = Field(..., description="When the token expires")


class UserCreate(BaseModel):
    """用户注册的请求模型。

    Attributes:
        email: 用户邮箱
        password: 用户密码
    """

    email: EmailStr = Field(..., description="User's email address")
    password: SecretStr = Field(..., description="User's password", min_length=8, max_length=64)

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: SecretStr) -> SecretStr:
        """验证密码强度。

        Args:
            v: 要验证的密码

        Returns:
            SecretStr: 验证后的密码

        Raises:
            ValueError: 如果密码不够强
        """
        password = v.get_secret_value()

        # Check for common password requirements
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters long")

        if not re.search(r"[A-Z]", password):
            raise ValueError("Password must contain at least one uppercase letter")

        if not re.search(r"[a-z]", password):
            raise ValueError("Password must contain at least one lowercase letter")

        if not re.search(r"[0-9]", password):
            raise ValueError("Password must contain at least one number")

        if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
            raise ValueError("Password must contain at least one special character")

        return v


class UserResponse(BaseModel):
    """用户操作的响应模型。

    Attributes:
        id: 用户ID
        email: 用户邮箱
        token: 认证令牌
    """

    id: int = Field(..., description="User's ID")
    email: str = Field(..., description="User's email address")
    token: Token = Field(..., description="Authentication token")


class SessionResponse(BaseModel):
    """会话创建的响应模型。

    Attributes:
        session_id: 会话的唯一标识符
        name: 会话名称（默认为空字符串）
        # token: 会话的认证令牌（已注释，因仅用户级token足够，简化会话token逻辑）
    """

    session_id: str = Field(..., description="The unique identifier for the chat session")
    name: str = Field(default="", description="Name of the session", max_length=100)
    # token: Token = Field(..., description="The authentication token for the session")  # 注释原因：仅用户级token足够，简化会话token逻辑

    @field_validator("name")
    @classmethod
    def sanitize_name(cls, v: str) -> str:
        """清理会话名称。

        Args:
            v: 要清理的会话名称

        Returns:
            str: 清理后的会话名称
        """
        # 移除任何潜在的有害字符
        sanitized = re.sub(r'[<>{}[\]()\'"`]', "", v)
        return sanitized
