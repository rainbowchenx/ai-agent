"""聊天机器人API，用于处理聊天交互。

该模块提供聊天交互的端点，包括常规聊天、流式聊天、消息历史管理和聊天历史清除。
"""

import json
from math import log
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request, Form
from fastapi.responses import StreamingResponse
from app.models.user import User
from app.api.v1.auth import get_current_session, get_current_user
from app.core.config import settings
from app.core.langgraph.graph import LangGraphAgent
from app.core.limiter import limiter
from app.core.logging import logger
from app.models.session import Session
from app.schemas.chat import ChatRequest, ChatResponse, Message, StreamResponse
from app.services.database import DatabaseService


router = APIRouter()
agent = LangGraphAgent()
db_service = DatabaseService()


@router.post("/chat", response_model=ChatResponse)
# @limiter.limit(settings.RATE_LIMIT_ENDPOINTS["chat"][0])
async def chat(
    request: Request,
    chat_request: ChatRequest,
    session_id: str ,
    user: User = Depends(get_current_user),
):
    """处理聊天请求使用LangGraph。

    Args:
        request: FastAPI请求对象用于速率限制。
        chat_request: 包含消息的聊天请求。
        session_id: 会话ID。
        user: 当前用户。

    Returns:
        ChatResponse: 处理后的聊天响应。

    Raises:
        HTTPException: 如果处理请求时出错。
    """
    try:
        logger.info(
            "chat_request_received",
            session_id=session_id,
            message_count=len(chat_request.messages),
        )

        result = await agent.get_response(chat_request.messages, session_id, user_id=user.id)

        logger.info("chat_request_processed", session_id=session_id, result=result)

        return ChatResponse(messages=result)
    except Exception as e:
        logger.error("chat_request_failed", session_id=session_id, error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat/stream")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["chat_stream"][0])
async def chat_stream(
    request: Request,
    chat_request: ChatRequest,
    # session: Session = Depends(get_current_session),
    session_id: str ,
    user: User = Depends(get_current_user),
):
    """使用LangGraph处理聊天请求并返回流式响应。

    Args:
        request: FastAPI请求对象用于速率限制。
        chat_request: 包含消息的聊天请求。
        session: 从认证令牌获取的当前会话。

    Returns:
        StreamingResponse: 聊天完成的流式响应。

    Raises:
        HTTPException: 如果处理请求时出错。
    """
    try:
        logger.info(
            "stream_chat_request_received",
            session_id=session_id,
            message_count=len(chat_request.messages),
        )

        async def event_generator():
            """生成流式事件。

            Yields:
                str: 服务器发送事件的JSON格式。

            Raises:
                Exception: 如果流式过程中出错。
            """
            try:
                full_response = ""
                async for chunk in agent.get_stream_response(
                    chat_request.messages, session_id, user_id=user.id
                 ):
                        full_response += chunk
                        response = StreamResponse(content=chunk, done=False)
                        yield f"data: {json.dumps(response.model_dump())}\n\n"

                # 发送最终消息指示完成
                final_response = StreamResponse(content="", done=True)
                yield f"data: {json.dumps(final_response.model_dump())}\n\n"

            except Exception as e:
                logger.error(
                    "stream_chat_request_failed",
                    session_id=session_id,
                    error=str(e),
                    exc_info=True,
                )
                error_response = StreamResponse(content=str(e), done=True)
                yield f"data: {json.dumps(error_response.model_dump())}\n\n"

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    except Exception as e:
        logger.error(
            "stream_chat_request_failed",
            session_id=session_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/messages/{session_id}", response_model=ChatResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["messages"][0])
async def get_session_messages(
    request: Request,
    session_id: str,
    user: User = Depends(get_current_user),
):
    """获取指定会话的所有消息。

    Args:
        request: FastAPI请求对象用于速率限制。
        session_id: 会话ID
        user: 从认证令牌获取的当前用户。

    Returns:
        ChatResponse: 会话中的所有消息。

    Raises:
        HTTPException: 如果获取消息时出错。
    """
    try:
        # 验证会话是否属于当前用户
        session = await db_service.get_session(session_id)
        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")
        
        if session.user_id != user.id:
            raise HTTPException(status_code=403, detail="Access denied to this session")
        
        # messages = await agent.get_chat_history(session_id)
        # 测试用模拟数据怒
        messages = [
            {
                "role": "user",
                "content": "Hello, how are you?"
            },
            {
                "role": "assistant",
                "content": "I'm good, thank you!"
            }
        ]
        return ChatResponse(messages=messages)
    except Exception as e:
        logger.error("get_messages_failed", session_id=session_id, error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/messages")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["messages"][0])
async def clear_chat_history(
    request: Request,
    session: Session = Depends(get_current_session),
):
    """清除会话的所有消息。

    Args:
        request: FastAPI请求对象用于速率限制。
        session: 从认证令牌获取的当前会话。

    Returns:
        dict: 一个消息，指示聊天历史已清除。
    """
    try:
        await agent.clear_chat_history(session.id)
        return {"message": "Chat history cleared successfully"}
    except Exception as e:
        logger.error("clear_chat_history_failed", session_id=session.id, error=str(e), exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
