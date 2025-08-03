"""该文件包含应用程序的主入口点。

定义了FastAPI应用程序的创建、配置、中间件设置和路由注册。
"""

import os
from contextlib import asynccontextmanager
from datetime import datetime
from typing import (
    Any,
    Dict,
)

from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    Request,
    status,
)
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.api.v1.api import api_router
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger

from app.services.database import database_service

# 加载环境变量
load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """处理应用程序启动和关闭事件。
    
    在应用启动时记录日志，在应用关闭时进行清理工作。
    """
    logger.info(
        "application_startup",
        project_name=settings.PROJECT_NAME,
        version=settings.VERSION,
        api_prefix=settings.API_V1_STR,
    )
    yield
    logger.info("application_shutdown")


# 创建FastAPI应用实例
app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description=settings.DESCRIPTION,
    openapi_url="/api/v1/openapi.json",
    lifespan=lifespan,
)


# 设置速率限制器异常处理器
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# 添加请求验证异常处理器
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """处理请求数据验证错误。

    Args:
        request: 导致验证错误的请求
        exc: 验证错误对象

    Returns:
        JSONResponse: 格式化的错误响应
    """
    # 记录验证错误日志
    logger.error(
        "validation_error",
        client_host=request.client.host if request.client else "unknown",
        path=request.url.path,
        errors=str(exc.errors()),
    )

    # 格式化错误信息，使其更用户友好
    formatted_errors = []
    for error in exc.errors():
        loc = " -> ".join([str(loc_part) for loc_part in error["loc"] if loc_part != "body"])
        formatted_errors.append({"field": loc, "message": error["msg"]})

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": "Validation error", "errors": formatted_errors},
    )


# 设置CORS中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 包含API路由
app.include_router(api_router, prefix='/api/v1')


@app.get("/")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["root"][0])
async def root(request: Request):
    """根端点，返回基本的API信息。
    
    提供应用程序的基本信息，包括名称、版本、状态等。
    """
    logger.info("root_endpoint_called")
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "status": "healthy",
        "environment": settings.ENVIRONMENT.value,
        "swagger_url": "/docs",
        "redoc_url": "/redoc",
    }


@app.get("/health")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["health"][0])
async def health_check(request: Request) -> Dict[str, Any]:
    """健康检查端点，提供环境特定的信息。

    检查应用程序各组件的健康状态，包括数据库连接等。

    Returns:
        Dict[str, Any]: 健康状态信息
    """
    logger.info("health_check_called")

    # 检查数据库连接状态
    db_healthy = await database_service.health_check()

    response = {
        "status": "healthy" if db_healthy else "degraded",
        "version": settings.VERSION,
        "environment": settings.ENVIRONMENT.value,
        "components": {"api": "healthy", "database": "healthy" if db_healthy else "unhealthy"},
        "timestamp": datetime.now().isoformat(),
    }

    # 如果数据库不健康，设置相应的状态码
    status_code = status.HTTP_200_OK if db_healthy else status.HTTP_503_SERVICE_UNAVAILABLE

    return JSONResponse(content=response, status_code=status_code)
