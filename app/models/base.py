"""基础模型和所有模型的通用导入。

该模块定义了所有数据模型的基础类和通用字段。
"""

from datetime import datetime, UTC
from typing import List, Optional
from sqlmodel import Field, SQLModel, Relationship


class BaseModel(SQLModel):
    """基础模型类，包含通用字段。

    所有其他模型类都应该继承这个基础类，以获得通用的字段和功能。
    """

    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        description="记录创建时间，使用UTC时区"
    )
