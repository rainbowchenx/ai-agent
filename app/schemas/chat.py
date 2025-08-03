"""该文件包含应用程序的聊天数据模式定义。"""

import re
from typing import (
    List,
    Literal,
)

from pydantic import (
    BaseModel,
    Field,
    field_validator,
)


class Message(BaseModel):
    """聊天消息数据模型。

    Attributes:
        role: 消息发送者的角色（用户或助手）
        content: 消息内容
    """

    model_config = {"extra": "ignore"}

    role: Literal["user", "assistant", "system"] = Field(..., description="The role of the message sender")
    content: str = Field(..., description="The content of the message", min_length=1, max_length=3000)

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: str) -> str:
        """验证消息内容。

        Args:
            v: 要验证的内容

        Returns:
            str: 验证后的内容

        Raises:
            ValueError: 如果内容包含不允许的模式
        """
        # 检查潜在的有害内容
        if re.search(r"<script.*?>.*?</script>", v, re.IGNORECASE | re.DOTALL):
            raise ValueError("Content contains potentially harmful script tags")

        # 检查空字节
        if "\0" in v:
            raise ValueError("Content contains null bytes")

        return v


class ChatRequest(BaseModel):
    """聊天端点的请求模型。

    Attributes:
        messages: 对话中的消息列表
    """

    messages: List[Message] = Field(
        ...,
        description="List of messages in the conversation",
        min_length=1,
    )


class ChatResponse(BaseModel):
    """聊天端点的响应模型。

    Attributes:
        messages: 对话中的消息列表
    """

    messages: List[Message] = Field(..., description="List of messages in the conversation")


class StreamResponse(BaseModel):
    """流式聊天端点的响应模型。

    Attributes:
        content: 当前数据块的内容
        done: 流是否完成
    """

    content: str = Field(default="", description="The content of the current chunk")
    done: bool = Field(default=False, description="Whether the stream is complete")
