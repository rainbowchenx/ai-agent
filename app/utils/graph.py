"""langgraph 工具类,用于处理消息的转储和准备。"""

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import trim_messages as _trim_messages  # 限制消息长度

from app.core.config import settings
from app.schemas import Message


def dump_messages(messages: list[Message]) -> list[dict]:
    """将消息转储为字典列表。

    Args:
        messages (list[Message]): 要转储的消息。

    Returns:
        list[dict]: 转储后的消息。
    """
    return [message.model_dump() for message in messages]


def prepare_messages(messages: list[Message], llm: BaseChatModel, system_prompt: str) -> list[Message]:
    """消息处理，拼接prompt，限制消息的长度，用于LLM。

    Args:
        messages (list[Message]): 要准备的消息。
        llm (BaseChatModel): 要使用的LLM。
        system_prompt (str): 要使用的prompt。

    Returns:
        list[Message]: 准备后的消息。
    """
    # 对于cl100k_base tokenizer，直接使用原始消息避免token计数问题
    # 如果需要限制消息长度，可以使用简单的字符计数或消息数量限制
    if len(messages) > 10:  # 简单的消息数量限制
        messages = messages[-10:]  # 只保留最后10条消息
    
    return [Message(role="system", content=system_prompt)] + messages
