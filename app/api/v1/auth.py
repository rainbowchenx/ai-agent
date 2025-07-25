"""
这个模块是用于用户注册、登录、会话管理、令牌验证的。
"""

import uuid
from typing import List
from fastapi import APIRouter, Depends, Form, HTTPException, Request
# 基于bearer token的认证
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings  # 设置
from app.core.limiter import limiter  # 接口速率限制
from app.core.logging import logger  # 日志
from app.models.session import Session  # 会话
from app.models.user import User
from app.schemas.auth import SessionResponse, TokenResponse, UserCreate, UserResponse
from app.services.database import DatabaseService  # 数据库服务
from app.utils.auth import create_access_token, verify_token  # token生成与验证
from app.utils.sanitization import sanitize_email, sanitize_string, validate_password_strength  # 用户数据清洗

router = APIRouter()  # 路由
security = HTTPBearer()  
db_service = DatabaseService()  # 数据库服务，存储用户、会话、消息等数据


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> User:
    """从令牌中获取当前用户ID
    Args:
        credentials: 包含JWT token的字段
    Returns:
        User: 从令牌中提取的用户
    Raises:
        HTTPException: token无效或缺失.
    """
    try:
        # 数据清洗
        token = sanitize_string(credentials.credentials)

        user_id = verify_token(token)
        if user_id is None:
            logger.error("invalid_token", token_part=token[:10] + "...")
            raise HTTPException(
                status_code=401,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # 验证用户是否存在
        user_id_int = int(user_id)
        user = await db_service.get_user(user_id_int)
        if user is None:
            logger.error("user_not_found", user_id=user_id_int)
            raise HTTPException(
                status_code=404,
                detail="User not found",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return user
    except ValueError as ve:
        logger.error("token_validation_failed", error=str(ve), exc_info=True)
        raise HTTPException(
            status_code=422,
            detail="Invalid token format",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_session(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> Session:
    """从令牌中获取当前会话ID

    Args:
        credentials: 包含JWT令牌的HTTP授权凭据

    Returns:
        Session: 从令牌中提取的会话

    Raises:
        HTTPException: 如果令牌无效或缺失
    """
    try:
        # 数据清洗
        token = sanitize_string(credentials.credentials)

        session_id = verify_token(token)
        if session_id is None:
            logger.error("session_id_not_found", token_part=token[:10] + "...")
            raise HTTPException(
                status_code=401,
                detail="Invalid authentication credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # 数据清洗
        session_id = sanitize_string(session_id)

        # 验证会话是否存在
        session = await db_service.get_session(session_id)
        if session is None:
            logger.error("session_not_found", session_id=session_id)
            raise HTTPException(
                status_code=404,
                detail="Session not found",
                headers={"WWW-Authenticate": "Bearer"},
            )

        return session
    except ValueError as ve:
        logger.error("token_validation_failed", error=str(ve), exc_info=True)
        raise HTTPException(
            status_code=422,
            detail="Invalid token format",
            headers={"WWW-Authenticate": "Bearer"},
        )


@router.post("/register", response_model=UserResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["register"][0])
async def register_user(request: Request, user_data: UserCreate):
    """注册新用户

    Args:
        request: 速率限制的FastAPI请求对象
        user_data: 用户注册数据

    Returns:
        UserResponse: 创建的用户信息
    """
    try:
        # 邮箱数据清洗
        sanitized_email = sanitize_email(user_data.email)

        # 提取并验证密码
        password = user_data.password.get_secret_value()
        validate_password_strength(password)

        # 检查用户是否存在
        if await db_service.get_user_by_email(sanitized_email):
            raise HTTPException(status_code=400, detail="Email already registered")

        # 创建用户
        user = await db_service.create_user(email=sanitized_email, password=User.hash_password(password))

        # 创建访问令牌
        token = create_access_token(str(user.id))

        return UserResponse(id=user.id, email=user.email, token=token)
    except ValueError as ve:
        logger.error("user_registration_validation_failed", error=str(ve), exc_info=True)
        raise HTTPException(status_code=422, detail=str(ve))


@router.post("/login", response_model=TokenResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["login"][0])
async def login(
    request: Request, username: str = Form(...), password: str = Form(...), grant_type: str = Form(default="password")
):
    """登录用户

    Args:
        request: 速率限制的FastAPI请求对象
        username: 用户邮箱
        password: 用户密码
        grant_type: 必须为 "password"

    Returns:
        TokenResponse: 访问令牌信息

    Raises:
        HTTPException: 如果凭据无效
    """
    try:
        # 数据清洗
        username = sanitize_string(username)
        password = sanitize_string(password)
        grant_type = sanitize_string(grant_type)

        # 验证授权类型
        if grant_type != "password":
            raise HTTPException(
                status_code=400,
                detail="Unsupported grant type. Must be 'password'",
            )

        # 获取用户
        user = await db_service.get_user_by_email(username)
        if not user or not user.verify_password(password):
            raise HTTPException(
                status_code=401,
                detail="Incorrect email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )

        token = create_access_token(str(user.id))
        return TokenResponse(access_token=token.access_token, token_type="bearer", expires_at=token.expires_at)
    except ValueError as ve:
        logger.error("login_validation_failed", error=str(ve), exc_info=True)
        raise HTTPException(status_code=422, detail=str(ve))


@router.post("/session", response_model=SessionResponse)
async def create_session(user: User = Depends(get_current_user)):
    """创建一个新的聊天会话
    Args:
        user: 当前用户
    Returns:
        SessionResponse: 会话ID, 名称
    """
    try:
        # 生成一个唯一的会话ID
        session_id = str(uuid.uuid4())

        # 在数据库中创建会话
        session = await db_service.create_session(session_id, user.id)

        # # 为会话创建访问令牌 (用户级token， 不创建会话级token)
        # token = create_access_token(session_id)

        logger.info(
            "session_created",
            session_id=session_id,
            user_id=user.id,
            name=session.name,
            # expires_at=token.expires_at.isoformat(),  # 用户级token足够
        )

        # return SessionResponse(session_id=session_id, name=session.name, token=token)  # 仅用户级token足够
        return SessionResponse(session_id=session_id, name=session.name)
    except ValueError as ve:
        logger.error("session_creation_validation_failed", error=str(ve), user_id=user.id, exc_info=True)
        raise HTTPException(status_code=422, detail=str(ve))


@router.patch("/session/{session_id}/name", response_model=SessionResponse)
async def update_session_name(
    session_id: str, name: str = Form(...), current_session: Session = Depends(get_current_session)
):
    """更新会话名称

    Args:
        session_id: 要更新的会话ID
        name: 会话的新名称
        current_session: 当前会话

    Returns:
        SessionResponse: 更新的会话信息
    """
    try:
        # 数据清洗
        sanitized_session_id = sanitize_string(session_id)
        sanitized_name = sanitize_string(name)
        sanitized_current_session = sanitize_string(current_session.id)

        # 验证会话ID是否与当前会话匹配
        if sanitized_session_id != sanitized_current_session:
            raise HTTPException(status_code=403, detail="Cannot modify other sessions")

        # 更新会话名称
        session = await db_service.update_session_name(sanitized_session_id, sanitized_name)

        # # 创建一个新的令牌（暂时注释，因仅用户级token足够，简化会话token逻辑）
        # token = create_access_token(sanitized_session_id)

        # return SessionResponse(session_id=sanitized_session_id, name=session.name, token=token)  # 注释原因：仅用户级token足够
        return SessionResponse(session_id=sanitized_session_id, name=session.name)
    except ValueError as ve:
        logger.error("session_update_validation_failed", error=str(ve), session_id=session_id, exc_info=True)
        raise HTTPException(status_code=422, detail=str(ve))


@router.delete("/session/{session_id}")
async def delete_session(session_id: str, current_session: Session = Depends(get_current_session)):
    """删除当前用户的会话

    Args:
        session_id: 要删除的会话ID
        current_session: 当前会话

    Returns:
        None: 无返回值
    """
    try:
        # 数据清洗
        sanitized_session_id = sanitize_string(session_id)
        sanitized_current_session = sanitize_string(current_session.id)

        # 验证会话ID是否与当前会话匹配
        if sanitized_session_id != sanitized_current_session:
            raise HTTPException(status_code=403, detail="Cannot delete other sessions")

            # 删除会话
        await db_service.delete_session(sanitized_session_id)

        logger.info("session_deleted", session_id=session_id, user_id=current_session.user_id)
    except ValueError as ve:
        logger.error("session_deletion_validation_failed", error=str(ve), session_id=session_id, exc_info=True)
        raise HTTPException(status_code=422, detail=str(ve))


@router.get("/sessions", response_model=List[SessionResponse])
async def get_user_sessions(user: User = Depends(get_current_user)):
    """获取当前用户的所有会话ID

    Args:
        user: 当前用户

    Returns:
        List[SessionResponse]: 会话ID列表
    """
    try:
        sessions = await db_service.get_user_sessions(user.id)
        return [
            SessionResponse(
                session_id=sanitize_string(session.id),
                name=sanitize_string(session.name),
                # token=create_access_token(session.id),  # 注释原因：仅用户级token足够，简化会话token逻辑
            )
            for session in sessions
        ]
    except ValueError as ve:
        logger.error("get_sessions_validation_failed", user_id=user.id, error=str(ve), exc_info=True)
        raise HTTPException(status_code=422, detail=str(ve))
