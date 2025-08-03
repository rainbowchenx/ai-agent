"""该文件包含LangGraph Agent/工作流和与LLM的交互。"""

from typing import Any, AsyncGenerator, Dict, Literal, Optional

from asgiref.sync import sync_to_async
from langchain_core.messages import BaseMessage, ToolMessage, convert_to_openai_messages
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import StateSnapshot
from openai import OpenAIError
from psycopg_pool import AsyncConnectionPool

from app.core.config import Environment, settings
from app.core.langgraph.tools import tools
from app.core.logging import logger

from app.core.prompts import SYSTEM_PROMPT
from app.schemas import GraphState, Message
from app.utils import dump_messages, prepare_messages


class LangGraphAgent:
    """管理LangGraph Agent/工作流和与LLM的交互。

    该类处理LangGraph工作流的创建和管理，包括LLM交互、数据库连接和响应处理。
    """

    def __init__(self):
        """初始化LangGraph Agent所需组件。"""
        # 使用环境特定的LLM模型
        self.llm = ChatOpenAI(
            model=settings.LLM_MODEL,
            base_url=settings.LLM_BASE_URL,
            temperature=settings.DEFAULT_LLM_TEMPERATURE,
            api_key=settings.LLM_API_KEY,
            max_tokens=settings.MAX_TOKENS,
            **self._get_model_kwargs(),
        ).bind_tools(tools)
        self.tools_by_name = {tool.name: tool for tool in tools}
        self._connection_pool: Optional[AsyncConnectionPool] = None
        self._graph: Optional[CompiledStateGraph] = None

        logger.info("llm_initialized", model=settings.LLM_MODEL, environment=settings.ENVIRONMENT.value)

    def _get_model_kwargs(self) -> Dict[str, Any]:
        """Get environment-specific model kwargs.

        Returns:
            Dict[str, Any]: 基于环境的额外模型参数
        """
        model_kwargs = {}

        # 开发 - 我们可以使用较低的速度以节省成本
        if settings.ENVIRONMENT == Environment.DEVELOPMENT:
            model_kwargs["top_p"] = 0.8

        # 生产 - 使用更高质量的设置
        elif settings.ENVIRONMENT == Environment.PRODUCTION:
            model_kwargs["top_p"] = 0.95
            model_kwargs["presence_penalty"] = 0.1
            model_kwargs["frequency_penalty"] = 0.1

        return model_kwargs

    async def _get_connection_pool(self) -> AsyncConnectionPool:
        """使用环境特定设置获取PostgreSQL连接池。

        Returns:
            AsyncConnectionPool: PostgreSQL数据库的连接池。
        """
        if self._connection_pool is None:
            try:
                # 根据环境配置池大小
                max_size = settings.POSTGRES_POOL_SIZE

                self._connection_pool = AsyncConnectionPool(
                    settings.POSTGRES_URL,
                    open=False,
                    max_size=max_size,
                    kwargs={
                        "autocommit": True,
                        "connect_timeout": 5,
                        "prepare_threshold": None,
                    },
                )
                await self._connection_pool.open()
                logger.info("connection_pool_created", max_size=max_size, environment=settings.ENVIRONMENT.value)
            except Exception as e:
                logger.error("connection_pool_creation_failed", error=str(e), environment=settings.ENVIRONMENT.value)
                # 在生产中，我们可能希望优雅地降级
                if settings.ENVIRONMENT == Environment.PRODUCTION:
                    logger.warning("continuing_without_connection_pool", environment=settings.ENVIRONMENT.value)
                    return None
                raise e
        return self._connection_pool

    async def _chat(self, state: GraphState) -> dict:
        """处理聊天状态并生成响应。

        Args:
            state (GraphState): 当前对话状态。

        Returns:
            dict: 更新后的状态，包含新消息。
        """
        messages = prepare_messages(state.messages, self.llm, SYSTEM_PROMPT)

        llm_calls_num = 0

        # 根据环境配置重试次数
        max_retries = settings.MAX_LLM_CALL_RETRIES

        for attempt in range(max_retries):
            try:
                generated_state = {"messages": [await self.llm.ainvoke(dump_messages(messages))]}
                logger.info(
                    "llm_response_generated",
                    session_id=state.session_id,
                    llm_calls_num=llm_calls_num + 1,
                    model=settings.LLM_MODEL,
                    environment=settings.ENVIRONMENT.value,
                )
                return generated_state
            except OpenAIError as e:
                logger.error(
                    "llm_call_failed",
                    llm_calls_num=llm_calls_num,
                    attempt=attempt + 1,
                    max_retries=max_retries,
                    error=str(e),
                    environment=settings.ENVIRONMENT.value,
                )
                llm_calls_num += 1

                # 在生产中，我们可能希望回退到更可靠的模型
                if settings.ENVIRONMENT == Environment.PRODUCTION and attempt == max_retries - 2:
                    fallback_model = "gpt-4o"
                    logger.warning(
                        "using_fallback_model", model=fallback_model, environment=settings.ENVIRONMENT.value
                    )
                    self.llm.model_name = fallback_model

                continue

        raise Exception(f"Failed to get a response from the LLM after {max_retries} attempts")

    # 定义我们的工具节点
    async def _tool_call(self, state: GraphState) -> GraphState:
        """处理最后一条消息的工具调用。

        Args:
            state: 包含消息和工具调用的当前代理状态。

        Returns:
            Dict: 包含工具响应的更新后的消息。
        """
        outputs = []
        for tool_call in state.messages[-1].tool_calls:
            tool_result = await self.tools_by_name[tool_call["name"]].ainvoke(tool_call["args"])
            outputs.append(
                ToolMessage(
                    content=tool_result,
                    name=tool_call["name"],
                    tool_call_id=tool_call["id"],
                )
            )
        return {"messages": outputs}

    def _should_continue(self, state: GraphState) -> Literal["end", "continue"]:
        """根据最后一条消息确定代理是否应该继续或结束。

        Args:
            state: 包含消息的当前代理状态。

        Returns:
            Literal["end", "continue"]: 如果没有工具调用，则为"end"，否则为"continue"。
        """
        messages = state.messages
        last_message = messages[-1]
        # 如果没有函数调用，则结束
        if not last_message.tool_calls:
            return "end"
        # 否则如果有，则继续
        else:
            return "continue"

    async def create_graph(self) -> Optional[CompiledStateGraph]:
        """创建和配置LangGraph工作流。

        Returns:
            Optional[CompiledStateGraph]: 配置的LangGraph实例或None如果初始化失败
        """
        if self._graph is None:
            try:
                graph_builder = StateGraph(GraphState)
                graph_builder.add_node("chat", self._chat)
                graph_builder.add_node("tool_call", self._tool_call)
                graph_builder.add_conditional_edges(
                    "chat",
                    self._should_continue,
                    {"continue": "tool_call", "end": END},
                )
                graph_builder.add_edge("tool_call", "chat")
                graph_builder.set_entry_point("chat")
                graph_builder.set_finish_point("chat")

                # 获取连接池（在生产中，如果DB不可用，则可能为None）
                connection_pool = await self._get_connection_pool()
                if connection_pool:
                    checkpointer = AsyncPostgresSaver(connection_pool)
                    await checkpointer.setup()
                else:
                    # 在生产中，如果需要，则继续而不使用检查点
                    checkpointer = None
                    if settings.ENVIRONMENT != Environment.PRODUCTION:
                        raise Exception("Connection pool initialization failed")

                self._graph = graph_builder.compile(
                    checkpointer=checkpointer, name=f"{settings.PROJECT_NAME} Agent ({settings.ENVIRONMENT.value})"
                )

                logger.info(
                    "graph_created",
                    graph_name=f"{settings.PROJECT_NAME} Agent",
                    environment=settings.ENVIRONMENT.value,
                    has_checkpointer=checkpointer is not None,
                )
            except Exception as e:
                logger.error("graph_creation_failed", error=str(e), environment=settings.ENVIRONMENT.value)
                # 在生产中，我们不希望崩溃应用程序
                if settings.ENVIRONMENT == Environment.PRODUCTION:
                    logger.warning("continuing_without_graph")
                    return None
                raise e

        return self._graph

    async def get_response(
        self,
        messages: list[Message],
        session_id: str,
        user_id: Optional[str] = None,
    ) -> list[dict]:
        """从LLM获取响应。

        Args:
            messages (list[Message]): 发送到LLM的消息。
            session_id (str): 对话的会话ID。
            user_id (Optional[str]): 对话的用户ID。

        Returns:
            list[dict]: LLM的响应。
        """
        if self._graph is None:
            self._graph = await self.create_graph()
        config = {
            "configurable": {"thread_id": session_id},
            "callbacks": [],
            "metadata": {
                "user_id": user_id,
                "session_id": session_id,
                "environment": settings.ENVIRONMENT.value,
                "debug": False,
            },
        }
        try:
            response = await self._graph.ainvoke(
                {"messages": dump_messages(messages), "session_id": session_id}, config
            )
            return self.__process_messages(response["messages"])
        except Exception as e:
            logger.error(f"Error getting response: {str(e)}")
            raise e

    async def get_stream_response(
        self, messages: list[Message], session_id: str, user_id: Optional[str] = None
    ) -> AsyncGenerator[str, None]:
        """从LLM获取流式响应。

        Args:
            messages (list[Message]): 发送到LLM的消息。
            session_id (str): 对话的会话ID。
            user_id (Optional[str]): 对话的用户ID。

        Yields:
            str: LLM响应的令牌。
        """
        config = {
            "configurable": {"thread_id": session_id},
            "callbacks": [],

                # environment=settings.ENVIRONMENT.value, debug=False, user_id=user_id, session_id=session_id
        }
        if self._graph is None:
            self._graph = await self.create_graph()

        try:
            async for token, _ in self._graph.astream(
                {"messages": dump_messages(messages), "session_id": session_id}, config, stream_mode="messages"
            ):
                try:
                    yield token.content
                except Exception as token_error:
                    logger.error("Error processing token", error=str(token_error), session_id=session_id)
                    # 即使当前令牌失败，也继续下一个令牌
                    continue
        except Exception as stream_error:
            logger.error("Error in stream processing", error=str(stream_error), session_id=session_id)
            raise stream_error

    async def get_chat_history(self, session_id: str) -> list[Message]:
        """获取给定线程ID的聊天历史。

        Args:
            session_id (str): 对话的会话ID。

        Returns:
            list[Message]: 聊天历史。
        """
        if self._graph is None:
            self._graph = await self.create_graph()

        state: StateSnapshot = await sync_to_async(self._graph.get_state)(
            config={"configurable": {"thread_id": session_id}}
        )
        return self.__process_messages(state.values["messages"]) if state.values else []

    def __process_messages(self, messages: list[BaseMessage]) -> list[Message]:
        openai_style_messages = convert_to_openai_messages(messages)
        # 只保留助手和用户消息
        return [
            Message(**message)
            for message in openai_style_messages
            if message["role"] in ["assistant", "user"] and message["content"]
        ]

    async def clear_chat_history(self, session_id: str) -> None:
        """清除给定线程ID的所有聊天历史。

        Args:
            session_id: 要清除历史记录的会话ID。

        Raises:
            Exception: 如果清除聊天历史时出错。
        """
        try:
            # 确保在当前事件循环中初始化池
            conn_pool = await self._get_connection_pool()

            # 为这个特定操作使用一个新的连接
            async with conn_pool.connection() as conn:
                for table in settings.CHECKPOINT_TABLES:
                    try:
                        await conn.execute(f"DELETE FROM {table} WHERE thread_id = %s", (session_id,))
                        logger.info(f"Cleared {table} for session {session_id}")
                    except Exception as e:
                        logger.error(f"Error clearing {table}", error=str(e))
                        raise

        except Exception as e:
            logger.error("Failed to clear chat history", error=str(e))
            raise
