"""数据清洗工具类，用于防止XSS攻击和注入攻击。"""

import html
import re
from typing import Any, Dict, List, Optional, Union


def sanitize_string(value: str) -> str:
    """清洗字符串，防止XSS和注入攻击。

    Args:
        value: 要清洗的字符串

    Returns:
        str: 清洗后的字符串
    """
    # 如果value不是字符串，则转换为字符串
    if not isinstance(value, str):
        value = str(value)

    # html转成字符串，防止XSS
    value = html.escape(value)

    # 移除任何转义的script标签
    value = re.sub(r"&lt;script.*?&gt;.*?&lt;/script&gt;", "", value, flags=re.DOTALL)

    # 移除空字节
    value = value.replace("\0", "")

    return value


def sanitize_email(email: str) -> str:
    """清洗邮箱地址。

    Args:
        email: 要清洗的邮箱地址

    Returns:
        str: 清洗后的邮箱地址
    """
    # 基本清洗
    email = sanitize_string(email)

    # 确保邮箱格式（简单检查）
    if not re.match(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$", email):
        raise ValueError("Invalid email format")

    return email.lower()


def sanitize_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    """递归清洗字典中的所有字符串值。

    Args:
        data: 要清洗的字典

    Returns:
        Dict[str, Any]: 清洗后的字典
    """
    sanitized = {}
    for key, value in data.items():
        if isinstance(value, str):
            sanitized[key] = sanitize_string(value)
        elif isinstance(value, dict):
            sanitized[key] = sanitize_dict(value)
        elif isinstance(value, list):
            sanitized[key] = sanitize_list(value)
        else:
            sanitized[key] = value
    return sanitized


def sanitize_list(data: List[Any]) -> List[Any]:
    """递归清洗列表中的所有字符串值。

    Args:
        data: 要清洗的列表

    Returns:
        List[Any]: 清洗后的列表
    """
    sanitized = []
    for item in data:
        if isinstance(item, str):
            sanitized.append(sanitize_string(item))
        elif isinstance(item, dict):
            sanitized.append(sanitize_dict(item))
        elif isinstance(item, list):
            sanitized.append(sanitize_list(item))
        else:
            sanitized.append(item)
    return sanitized


def validate_password_strength(password: str) -> bool:
    """验证密码强度。必须包含大小写字母、数字、特殊字符，长度至少8位。

    Args:
        password: 要验证的密码

    Returns:
        bool: 密码是否足够强

    Raises:
        ValueError: 如果密码不够强，则抛出异常
    """
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

    return True
