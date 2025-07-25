"""该文件包含应用程序的身份验证工具。"""

import re
from datetime import UTC, datetime, timedelta
from typing import Optional
from jose import JWTError, jwt

from app.core.config import settings
from app.core.logging import logger
from app.schemas.auth import Token
from app.utils.sanitization import sanitize_string


def create_access_token(thread_id: str, expires_delta: Optional[timedelta] = None) -> Token:
    """创建一个新的token

    Args:
        thread_id: 用户id | 会话id
        expires_delta: 过期时间差（可选）

    Returns:
        Token: 生成的token
    """
    if expires_delta:
        expire = datetime.now(UTC) + expires_delta
    else:
        expire = datetime.now(UTC) + timedelta(days=settings.JWT_ACCESS_TOKEN_EXPIRE_DAYS)

    to_encode = {
        "sub": thread_id,
        "exp": expire,
        "iat": datetime.now(UTC),
        "jti": sanitize_string(f"{thread_id}-{datetime.now(UTC).timestamp()}"),  
    }

    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)

    logger.info("token_created", thread_id=thread_id, expires_at=expire.isoformat())

    return Token(access_token=encoded_jwt, expires_at=expire)


def verify_token(token: str) -> Optional[str]:
    """验证JWT令牌并返回会话ID。

    Args:
        token: 要验证的JWT令牌

    Returns:
        Optional[str]: 如果令牌有效，则返回会话ID，否则返回None

    Raises:
        ValueError: 如果令牌格式无效
    """
    if not token or not isinstance(token, str):
        logger.warning("token_invalid_format")
        raise ValueError("Token must be a non-empty string")

    # 在解码之前进行基本格式验证
    # JWT令牌由3个base64url编码的段组成，用点分隔
    if not re.match(r"^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$", token):
        logger.warning("token_suspicious_format")
        raise ValueError("Token format is invalid - expected JWT format")

    try:
        payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
        thread_id: str = payload.get("sub")
        if thread_id is None:
            logger.warning("token_missing_thread_id")
            return None

        logger.info("token_verified", thread_id=thread_id)
        return thread_id

    except JWTError as e:
        logger.error("token_verification_failed", error=str(e))
        return None
