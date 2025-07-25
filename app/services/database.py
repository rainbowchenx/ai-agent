"""关系型数据库服务类，包括初始化数据库、处理用户、会话和消息等CRUD操作封装。
基于SQLModel进行ORM操作并维护连接池。
"""

from typing import List, Optional
from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.pool import QueuePool
from sqlmodel import Session, SQLModel, create_engine, select

from app.core.config import Environment, settings
from app.core.logging import logger
from app.models.session import Session as ChatSession
from app.models.user import User


class DatabaseService:
    """数据库服务类，处理所有数据库操作。
    
    """

    def __init__(self):
        """初始化数据库服务，包括连接池。"""
        try:
            # 配置环境特定的数据库连接池设置
            pool_size = settings.POSTGRES_POOL_SIZE  
            max_overflow = settings.POSTGRES_MAX_OVERFLOW 

            # 创建引擎，使用适当的池配置
            self.engine = create_engine(
                settings.POSTGRES_URL,  # 数据库URL
                pool_pre_ping=True,  # 连接池预ping
                poolclass=QueuePool,  # 连接池类
                pool_size=pool_size,  # 连接池大小
                max_overflow=max_overflow,  # 最大溢出连接数
                pool_timeout=30,  # 连接超时（秒）
                pool_recycle=1800,  # 30分钟后回收连接
            )

            # 创建表（仅当它们不存在时）
            SQLModel.metadata.create_all(self.engine)

            logger.info(
                "database initialized",
                environment=settings.ENVIRONMENT.value,
                pool_size=pool_size,
                max_overflow=max_overflow,
            )
        except SQLAlchemyError as e:
            logger.error("database initialization error", error=str(e), environment=settings.ENVIRONMENT.value)
            # 非生产环境下才抛出错误
            if settings.ENVIRONMENT != Environment.PRODUCTION:
                raise

    async def create_user(self, email: str, password: str) -> User:
        """创建一个新用户。

        Args:
            email: 用户邮箱
            password: 经过哈希处理的密码

        Returns:
            User: 创建的用户
        """
        with Session(self.engine) as session:
            user = User(email=email, hashed_password=password)
            session.add(user)
            session.commit()
            session.refresh(user)
            logger.info("user created successfully", email=email)
            return user

    async def get_user(self, user_id: int) -> Optional[User]:
        """根据ID获取用户。

        Args:
            user_id: 要检索的用户ID

        Returns:
            Optional[User]: 如果找到，则返回用户，否则返回None
        """
        with Session(self.engine) as session:
            user = session.get(User, user_id)
            return user

    async def get_user_by_email(self, email: str) -> Optional[User]:
        """根据邮箱获取用户。

        Args:
            email: 要检索的用户邮箱

        Returns:
            Optional[User]: 如果找到，则返回用户，否则返回None
        """
        with Session(self.engine) as session:
            statement = select(User).where(User.email == email)
            user = session.exec(statement).first()
            return user

    async def delete_user_by_email(self, email: str) -> bool:
        """根据邮箱删除用户。

        Args:
            email: 要删除的用户邮箱

        Returns:
            bool: 如果删除成功，则返回True，否则返回False
        """
        with Session(self.engine) as session:
            user = session.exec(select(User).where(User.email == email)).first()
            if not user:
                return False

            session.delete(user)
            session.commit()
            logger.info("user_deleted", email=email)
            return True

    async def create_session(self, session_id: str, user_id: int, name: str = "") -> ChatSession:
        """创建一个新的聊天会话。

        Args:
            session_id: 新会话的ID
            user_id: 会话所有者的ID
            name: 会话的名称（默认为空字符串）

        Returns:
            ChatSession: 创建的会话
        """
        with Session(self.engine) as session:
            chat_session = ChatSession(id=session_id, user_id=user_id, name=name)
            session.add(chat_session)
            session.commit()
            session.refresh(chat_session)
            logger.info("session_created", session_id=session_id, user_id=user_id, name=name)
            return chat_session

    async def delete_session(self, session_id: str) -> bool:
        """根据ID删除会话。

        Args:
            session_id: 要删除的会话ID

        Returns:
            bool: 如果删除成功，则返回True，否则返回False
        """
        with Session(self.engine) as session:
            chat_session = session.get(ChatSession, session_id)
            if not chat_session:
                return False

            session.delete(chat_session)
            session.commit()
            logger.info("session_deleted", session_id=session_id)
            return True

    async def get_session(self, session_id: str) -> Optional[ChatSession]:
        """根据ID获取会话。

        Args:
            session_id: 要检索的会话ID

        Returns:
            Optional[ChatSession]: 如果找到，则返回会话，否则返回None
        """
        with Session(self.engine) as session:
            chat_session = session.get(ChatSession, session_id)
            return chat_session

    async def get_user_sessions(self, user_id: int) -> List[ChatSession]:
        """获取用户的所有会话。

        Args:
            user_id: 用户ID

        Returns:
            List[ChatSession]: 用户的会话列表
        """
        with Session(self.engine) as session:
            statement = select(ChatSession).where(ChatSession.user_id == user_id).order_by(ChatSession.created_at)
            sessions = session.exec(statement).all()
            return sessions

    async def update_session_name(self, session_id: str, name: str) -> ChatSession:
        """更新会话名称。

        Args:
            session_id: 要更新的会话ID
            name: 会话的新名称

        Returns:
            ChatSession: 更新的会话

        Raises:
            HTTPException: 如果会话不存在
        """
        with Session(self.engine) as session:
            chat_session = session.get(ChatSession, session_id)
            if not chat_session:
                raise HTTPException(status_code=404, detail="Session not found")

            chat_session.name = name
            session.add(chat_session)
            session.commit()
            session.refresh(chat_session)
            logger.info("session_name_updated", session_id=session_id, name=name)
            return chat_session

    def get_session_maker(self):
        """获取一个会话创建器，用于创建数据库会话。

        Returns:
            Session: 一个SQLModel会话创建器
        """
        return Session(self.engine)

    async def health_check(self) -> bool:
        """检查数据库连接健康状况。

        Returns:
            bool: 如果数据库健康，则返回True，否则返回False
        """
        try:
            with Session(self.engine) as session:
                # 执行一个简单的查询来检查连接
                session.exec(select(1)).first()
                return True
        except Exception as e:
            logger.error("database_health_check_failed", error=str(e))
            return False


# 创建一个单例实例
database_service = DatabaseService()
