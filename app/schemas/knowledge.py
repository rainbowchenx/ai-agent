"""知识库相关的Pydantic schema。

该模块定义了知识库相关的数据验证schema，用于API请求和响应。
"""

from datetime import datetime
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field


class KnowledgeDocumentResponse(BaseModel):
    """知识库文档响应核心数据结构"""
    
    id: str = Field(..., description="document id")
    name: str = Field(..., description="document name")
    description: str = Field(..., description="document description")
    file_type: str = Field(..., description="document file type")
    file_size: int = Field(..., description="document file size")
    status: str = Field(..., description="document status")
    chunks: int = Field(..., description="document chunks")
    vector_count: int = Field(..., description="document vector count")
    created_at: datetime = Field(..., description="document created at")
    
    class Config:
        from_attributes = True


class KnowledgeSearchRequest(BaseModel):
    """知识库搜索请求schema。"""
    
    query: str = Field(..., description="search query")
    n_results: int = Field(default=5, description="search results number count")


class KnowledgeSearchResult(BaseModel):
    """知识库搜索结果schema。"""
    
    content: str = Field(..., description="分块内容")
    metadata: Dict[str, Any] = Field(..., description="分块元数据")
    distance: Optional[float] = Field(None, description="相似度距离")
    id: str = Field(..., description="分块ID")


class APIResponse(BaseModel):
    """通用API响应schema。"""
    
    status: str = Field(..., description="响应状态")
    data: Optional[Any] = Field(None, description="响应数据")
    message: str = Field(..., description="响应消息") 