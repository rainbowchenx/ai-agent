"""该文件包含应用程序的图数据模式定义。"""

import re
import uuid
from typing import Annotated

from langgraph.graph.message import add_messages
from pydantic import (
    BaseModel,
    Field,
    field_validator,
)


class GraphState(BaseModel):
    """LangGraph代理/工作流的状态定义。"""

    messages: Annotated[list, add_messages] = Field(
        default_factory=list, description="The messages in the conversation"
    )
    session_id: str = Field(..., description="The unique identifier for the conversation session")

    @field_validator("session_id")
    @classmethod
    def validate_session_id(cls, v: str) -> str:
        """验证会话ID是否为有效的UUID或遵循安全模式。

        Args:
            v: 要验证的会话ID

        Returns:
            str: 验证后的会话ID

        Raises:
            ValueError: 如果会话ID无效
        """
        # 尝试验证为UUID
        try:
            uuid.UUID(v)
            return v
        except ValueError:
            # 如果不是UUID，检查是否只包含安全字符
            if not re.match(r"^[a-zA-Z0-9_\-]+$", v):
                raise ValueError("Session ID must contain only alphanumeric characters, underscores, and hyphens")
            return v
