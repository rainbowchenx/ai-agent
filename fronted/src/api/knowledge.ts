import { post, get, del } from '@/utils/request'

/**
 * 上传文档到知识库
 * @param file 要上传的文件
 * @param description 文档描述
 */
export function uploadDocument(file: File, description: string) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('description', description)
  
  return post<Knowledge.KnowledgeItem>({
    url: '/knowledge/upload',
    data: formData,
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  })
}

/**
 * 获取知识库列表
 */
export function getKnowledgeList() {
  return get<Knowledge.KnowledgeItem[]>({
    url: '/knowledge/list',
  })
}

/**
 * 删除知识库文档
 * @param id 文档ID
 */
export function deleteKnowledge(id: string) {
  return del({
    url: `/knowledge/${id}`,
  })
}

/**
 * 获取知识库文档详情
 * @param id 文档ID
 */
export function getKnowledgeDetail(id: string) {
  return get<Knowledge.KnowledgeItem>({
    url: `/knowledge/${id}`,
  })
} 