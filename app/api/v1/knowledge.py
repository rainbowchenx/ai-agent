"""知识库API路由。

该模块提供了知识库相关的API端点，包括文档上传、管理、检索等功能。
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from app.core.logging import logger
from app.services.knowledge import knowledge_service
from app.utils.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    description: str = Form(...),
    current_user: User = Depends(get_current_user)
):
    """上传文档到知识库。
    
    Args:
        file: 要上传的文件
        description: 文档描述
        current_user: 当前用户
        
    Returns:
        dict: 上传结果
    """
    try:
        # 验证文件类型
        allowed_types = [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword",
            "text/plain",
            "text/markdown"
        ]
        
        if file.content_type not in allowed_types:
            raise HTTPException(
                status_code=400, 
                detail="不支持的文件类型，仅支持PDF、DOCX、DOC、TXT、MD格式"
            )
        
        # 验证文件大小（50MB限制）
        if file.size > 50 * 1024 * 1024:
            raise HTTPException(
                status_code=400,
                detail="文件大小不能超过50MB"
            )
        
        # 上传并处理文档
        document = await knowledge_service.upload_document(
            file, description, current_user.id
        )
        
        # 转换为前端需要的格式
        result = {
            "id": document.id,
            "name": document.name,
            "description": document.description,
            "fileType": document.file_type,
            "fileSize": document.file_size,
            "uploadTime": document.created_at.isoformat(),
            "status": document.status,
            "chunks": document.chunks,
            "vectorCount": document.vector_count
        }
        
        logger.info(
            "document_upload_api_success",
            document_id=document.id,
            user_id=current_user.id
        )
        
        return {"status": "200", "data": result, "message": "文档上传成功"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "document_upload_api_error",
            user_id=current_user.id,
            error=str(e)
        )
        raise HTTPException(status_code=500, detail="文档上传失败")


@router.get("/list")
async def get_knowledge_list(
    current_user: User = Depends(get_current_user)
):
    """获取知识库文档列表。
    
    Args:
        current_user: 当前用户
        
    Returns:
        dict: 文档列表
    """
    try:
        documents = await knowledge_service.get_document_list(current_user.id)
        
        # 转换为前端需要的格式
        result = []
        for doc in documents:
            result.append({
                "id": doc.id,
                "name": doc.name,
                "description": doc.description,
                "fileType": doc.file_type,
                "fileSize": doc.file_size,
                "uploadTime": doc.created_at.isoformat(),
                "status": doc.status,
                "chunks": doc.chunks,
                "vectorCount": doc.vector_count
            })
        
        logger.info(
            "knowledge_list_retrieved",
            user_id=current_user.id,
            document_count=len(result)
        )
        
        return {"status": "200", "data": result, "message": "获取成功"}
        
    except Exception as e:
        logger.error(
            "knowledge_list_api_error",
            user_id=current_user.id,
            error=str(e)
        )
        raise HTTPException(status_code=500, detail="获取文档列表失败")


@router.get("/{document_id}")
async def get_knowledge_detail(
    document_id: str,
    current_user: User = Depends(get_current_user)
):
    """获取文档详情。
    
    Args:
        document_id: 文档ID
        current_user: 当前用户
        
    Returns:
        dict: 文档详情
    """
    try:
        document = await knowledge_service.get_document(document_id, current_user.id)
        
        if not document:
            raise HTTPException(status_code=404, detail="文档不存在")
        
        # 转换为前端需要的格式
        result = {
            "id": document.id,
            "name": document.name,
            "description": document.description,
            "fileType": document.file_type,
            "fileSize": document.file_size,
            "uploadTime": document.created_at.isoformat(),
            "status": document.status,
            "chunks": document.chunks,
            "vectorCount": document.vector_count,
            "errorMessage": document.error_message
        }
        
        logger.info(
            "knowledge_detail_retrieved",
            document_id=document_id,
            user_id=current_user.id
        )
        
        return {"status": "200", "data": result, "message": "获取成功"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "knowledge_detail_api_error",
            document_id=document_id,
            user_id=current_user.id,
            error=str(e)
        )
        raise HTTPException(status_code=500, detail="获取文档详情失败")


@router.delete("/{document_id}")
async def delete_knowledge(
    document_id: str,
    current_user: User = Depends(get_current_user)
):
    """删除文档。
    
    Args:
        document_id: 文档ID
        current_user: 当前用户
        
    Returns:
        dict: 删除结果
    """
    try:
        success = await knowledge_service.delete_document(document_id, current_user.id)
        
        if not success:
            raise HTTPException(status_code=404, detail="文档不存在或删除失败")
        
        logger.info(
            "knowledge_deleted",
            document_id=document_id,
            user_id=current_user.id
        )
        
        return {"status": "200", "data": None, "message": "文档删除成功"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "knowledge_delete_api_error",
            document_id=document_id,
            user_id=current_user.id,
            error=str(e)
        )
        raise HTTPException(status_code=500, detail="删除文档失败")


@router.post("/search")
async def search_knowledge(
    query: str = Form(...),
    n_results: int = Form(default=5),
    current_user: User = Depends(get_current_user)
):
    """搜索知识库。
    
    Args:
        query: 搜索查询
        n_results: 返回结果数量
        current_user: 当前用户
        
    Returns:
        dict: 搜索结果
    """
    try:
        if not query.strip():
            raise HTTPException(status_code=400, detail="搜索查询不能为空")
        
        results = await knowledge_service.search_knowledge(
            query, current_user.id, n_results
        )
        
        logger.info(
            "knowledge_search_completed",
            query=query,
            user_id=current_user.id,
            result_count=len(results)
        )
        
        return {"status": "200", "data": results, "message": "搜索完成"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "knowledge_search_api_error",
            query=query,
            user_id=current_user.id,
            error=str(e)
        )
        raise HTTPException(status_code=500, detail="搜索失败")


@router.get("/stats/overview")
async def get_knowledge_stats(
    current_user: User = Depends(get_current_user)
):
    """获取知识库统计信息。
    
    Args:
        current_user: 当前用户
        
    Returns:
        dict: 统计信息
    """
    try:
        documents = await knowledge_service.get_document_list(current_user.id)
        
        # 计算统计信息
        total_documents = len(documents)
        completed_documents = len([d for d in documents if d.status == "completed"])
        processing_documents = len([d for d in documents if d.status == "processing"])
        failed_documents = len([d for d in documents if d.status == "failed"])
        total_chunks = sum(d.chunks for d in documents)
        total_vectors = sum(d.vector_count for d in documents)
        
        stats = {
            "totalDocuments": total_documents,
            "completedDocuments": completed_documents,
            "processingDocuments": processing_documents,
            "failedDocuments": failed_documents,
            "totalChunks": total_chunks,
            "totalVectors": total_vectors
        }
        
        logger.info(
            "knowledge_stats_retrieved",
            user_id=current_user.id,
            stats=stats
        )
        
        return {"status": "200", "data": stats, "message": "获取成功"}
        
    except Exception as e:
        logger.error(
            "knowledge_stats_api_error",
            user_id=current_user.id,
            error=str(e)
        )
        raise HTTPException(status_code=500, detail="获取统计信息失败") 