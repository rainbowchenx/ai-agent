"""向量数据库服务类，使用Chroma实现向量存储和检索。

该模块提供了基于Chroma的向量数据库服务，包括文档向量化、存储、检索等功能。
"""

from typing import List, Dict, Any, Optional
from pathlib import Path

import chromadb
from chromadb.config import Settings
from chromadb.utils import embedding_functions

from app.core.config import settings
from app.core.logging import logger
from app.models.knowledge import KnowledgeChunk


class VectorStoreService:
    """Chroma向量数据库服务类。
    
    提供向量数据库的初始化、文档向量化、存储、检索等功能。
    """

    def __init__(self):
        """初始化Chroma向量数据库服务。"""
        try:
            # 确保持久化目录存在
            persist_dir = Path(settings.CHROMA_PERSIST_DIRECTORY)
            persist_dir.mkdir(parents=True, exist_ok=True)
            
            # 初始化Chroma客户端
            self.client = chromadb.PersistentClient(
                path=str(persist_dir),
                settings=Settings(
                    anonymized_telemetry=False,
                    allow_reset=True
                )
            )
            
            # 初始化嵌入函数
            self.embedding_function = embedding_functions.OpenAIEmbeddingFunction(
                api_key=settings.LLM_API_KEY,
                api_base=settings.LLM_BASE_URL,
                model_name=settings.CHROMA_EMBEDDING_MODEL
            )
            
            # 获取或创建集合
            self.collection = self.client.get_or_create_collection(
                name=settings.CHROMA_COLLECTION_NAME,
                embedding_function=self.embedding_function,
                metadata={
                    "hnsw:space": settings.CHROMA_SIMILARITY_METRIC,
                    "hnsw:construction_ef": 100,
                    "hnsw:search_ef": 50
                }
            )
            
            logger.info(
                "vector_store_initialized",
                persist_directory=str(persist_dir),
                collection_name=settings.CHROMA_COLLECTION_NAME,
                embedding_model=settings.CHROMA_EMBEDDING_MODEL
            )
            
        except Exception as e:
            logger.error("vector_store_initialization_error", error=str(e))
            raise

    async def add_document_chunks(self, document_id: str, chunks: List[KnowledgeChunk]) -> bool:
        """添加文档分块到向量数据库。
        
        Args:
            document_id: 文档ID
            chunks: 文档分块列表
            
        Returns:
            bool: 添加成功返回True，否则返回False
        """
        try:
            if not chunks:
                logger.warning("no_chunks_to_add", document_id=document_id)
                return False
            
            # 准备数据
            ids = []
            texts = []
            metadatas = []
            
            for chunk in chunks:
                chunk_id = f"{document_id}_{chunk.chunk_index}"
                ids.append(chunk_id)
                texts.append(chunk.content)
                metadatas.append({
                    "document_id": document_id,
                    "chunk_index": chunk.chunk_index,
                    "chunk_id": chunk.id,
                    "file_type": chunk.metadata.get("file_type", ""),
                    "created_at": chunk.created_at.isoformat()
                })
            
            # 添加到向量数据库
            self.collection.add(ids=ids, documents=texts, metadatas=metadatas)
            
            logger.info(
                "document_chunks_added",
                document_id=document_id,
                chunk_count=len(chunks)
            )
            return True
            
        except Exception as e:
            logger.error(
                "add_document_chunks_error",
                document_id=document_id,
                error=str(e)
            )
            return False

    async def search_similar_chunks(
        self, 
        query: str, 
        n_results: int = 5,
        document_ids: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """搜索相似的分块。
        
        Args:
            query: 查询文本
            n_results: 返回结果数量
            document_ids: 限制搜索的文档ID列表
            
        Returns:
            List[Dict[str, Any]]: 相似分块列表，包含内容、元数据和相似度分数
        """
        try:
            # 构建查询条件
            where = {}
            if document_ids:
                where["document_id"] = {"$in": document_ids}
            
            # 执行查询
            results = self.collection.query(
                query_texts=[query],
                n_results=n_results,
                where=where if where else None
            )
            
            # 格式化结果
            similar_chunks = []
            if results["documents"] and results["documents"][0]:
                for i, doc in enumerate(results["documents"][0]):
                    similar_chunks.append({
                        "content": doc,
                        "metadata": results["metadatas"][0][i],
                        "distance": results["distances"][0][i] if results["distances"] else None,
                        "id": results["ids"][0][i]
                    })
            
            logger.info(
                "similar_chunks_found",
                query_length=len(query),
                result_count=len(similar_chunks)
            )
            return similar_chunks
            
        except Exception as e:
            logger.error("search_similar_chunks_error", error=str(e))
            return []

    async def delete_document_chunks(self, document_id: str) -> bool:
        """删除文档的所有分块。
        
        Args:
            document_id: 要删除的文档ID
            
        Returns:
            bool: 删除成功返回True，否则返回False
        """
        try:
            # 删除指定文档的所有分块
            self.collection.delete(
                where={"document_id": document_id}
            )
            
            logger.info("document_chunks_deleted", document_id=document_id)
            return True
            
        except Exception as e:
            logger.error(
                "delete_document_chunks_error",
                document_id=document_id,
                error=str(e)
            )
            return False

    async def get_collection_stats(self) -> Dict[str, Any]:
        """获取集合统计信息。
        
        Returns:
            Dict[str, Any]: 集合统计信息
        """
        try:
            count = self.collection.count()
            
            stats = {
                "total_chunks": count,
                "collection_name": settings.CHROMA_COLLECTION_NAME,
                "embedding_model": settings.CHROMA_EMBEDDING_MODEL,
                "similarity_metric": settings.CHROMA_SIMILARITY_METRIC
            }
            
            logger.info("collection_stats_retrieved", stats=stats)
            return stats
            
        except Exception as e:
            logger.error("get_collection_stats_error", error=str(e))
            return {}

    async def health_check(self) -> bool:
        """检查向量数据库连接健康状况。
        
        Returns:
            bool: 如果健康，则返回True，否则返回False
        """
        try:
            # 尝试获取集合统计信息
            count = self.collection.count()
            return True
        except Exception as e:
            logger.error("vector_store_health_check_failed", error=str(e))
            return False

    async def reset_collection(self) -> bool:
        """重置集合（删除所有数据）。
        
        Returns:
            bool: 重置成功返回True，否则返回False
        """
        try:
            self.client.delete_collection(settings.CHROMA_COLLECTION_NAME)
            
            # 重新创建集合
            self.collection = self.client.create_collection(
                name=settings.CHROMA_COLLECTION_NAME,
                embedding_function=self.embedding_function,
                metadata={
                    "hnsw:space": settings.CHROMA_SIMILARITY_METRIC,
                    "hnsw:construction_ef": 100,
                    "hnsw:search_ef": 50
                }
            )
            
            logger.info("collection_reset", collection_name=settings.CHROMA_COLLECTION_NAME)
            return True
            
        except Exception as e:
            logger.error("reset_collection_error", error=str(e))
            return False


# 创建一个单例实例
vector_store_service = VectorStoreService() 