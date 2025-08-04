declare namespace Knowledge {
  interface KnowledgeItem {
    id: string   // 文档ID
    name: string   // 文档名称
    description: string   // 文档描述
    fileType: string   // 文档类型
    fileSize: number   // 文档大小
    uploadTime: string
    status: 'processing' | 'completed' | 'failed'   // 文档状态
    chunks: number   // 文档分块数
    vectorCount: number   // 文档向量数
  }

  interface KnowledgeState {
    knowledgeList: KnowledgeItem[]   // 知识库列表
    currentKnowledge: KnowledgeItem | null   // 当前知识库
  }
} 