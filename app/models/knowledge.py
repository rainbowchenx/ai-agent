"""知识库相关数据结构模型。

该模块定义了知识库相关的数据模型，包括文档信息、向量存储等。
"""

from typing import List, Optional
from sqlmodel import Field, Relationship

from app.models.base import BaseModel


class KnowledgeDocument(BaseModel, table=True):
    """知识库文档模型。
    
    存储文档的基本信息，包括文件名、描述、状态等。
    """
    
    __tablename__ = "knowledge_documents"
    
    id: str = Field(primary_key=True, description="文档唯一标识")
    name: str = Field(description="文档名称")
    description: str = Field(description="文档描述")
    file_type: str = Field(description="文件类型")
    file_size: int = Field(description="文件大小（字节）")
    file_path: str = Field(description="文件存储路径")
    status: str = Field(default="processing", description="处理状态：processing/completed/failed")
    chunks: int = Field(default=0, description="文档分块数")
    vector_count: int = Field(default=0, description="向量数量")
    user_id: int = Field(foreign_key="user.id", description="上传用户ID")
    error_message: Optional[str] = Field(default=None, description="错误信息")
    
    # 关系
    user: Optional["User"] = Relationship(back_populates="knowledge_documents")
    chunks: List["KnowledgeChunk"] = Relationship(back_populates="document")


class KnowledgeChunk(BaseModel, table=True):
    """知识库文档分块模型。
    
    存储文档分块的信息，用于向量检索。
    """
    
    __tablename__ = "knowledge_chunks"
    
    id: str = Field(primary_key=True, description="分块唯一标识")
    document_id: str = Field(foreign_key="knowledge_documents.id", description="所属文档ID")
    content: str = Field(description="分块内容")
    chunk_index: int = Field(description="分块索引")
    metadata: dict = Field(default_factory=dict, description="分块元数据")
    
    # 关系
    document: Optional[KnowledgeDocument] = Relationship(back_populates="chunks")


# 避免循环导入问题
from app.models.user import User  # noqa: E402 