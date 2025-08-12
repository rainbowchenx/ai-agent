"""主API路由配置。

该模块设置主API路由并包含所有子路由
"""

from fastapi import APIRouter

from app.api.v1.auth import router as auth_router   # 认证路由
from app.api.v1.chatbot import router as chatbot_router  # 聊天机器人路由
from app.api.v1.knowledge import router as knowledge_router  # 知识库路由
from app.core.logging import logger

api_router = APIRouter()

# 包含路由
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(chatbot_router, prefix="/chatbot", tags=["chatbot"])
api_router.include_router(knowledge_router, prefix="/knowledge", tags=["knowledge"])


@api_router.get("/health")
async def health_check():
    """健康检查路由。

    Returns:
        dict: 健康状态信息。
    """
    logger.info("health_check_called")
    return {"status": "healthy", "version": "1.0.0"}
