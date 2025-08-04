<script setup lang='ts'>
import type { DataTableColumns } from 'naive-ui'
import { computed, h, ref, watch, onMounted } from 'vue'
import { NButton, NDataTable, NInput, NSpace, NModal, NText, useMessage, useDialog } from 'naive-ui'
import { SvgIcon } from '@/components/common'
import { useKnowledgeStore } from '@/store/modules/knowledge'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { t } from '@/locales'
import { uploadDocument, getKnowledgeList, deleteKnowledge } from '@/api/knowledge'

interface Props {
  visible: boolean
}

interface Emit {
  (e: 'update:visible', visible: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()
const message = useMessage()
const dialog = useDialog()

const show = computed({
  get: () => props.visible,
  set: (visible: boolean) => emit('update:visible', visible),
})

const showUploadModal = ref(false)
const uploadLoading = ref(false)
const listLoading = ref(false)

const searchValue = ref<string>('')  // 搜索内容
const uploadDescription = ref<string>('')
const selectedFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

// 移动端自适应相关
const { isMobile } = useBasicLayout()

const knowledgeStore = useKnowledgeStore()

// 知识库列表
const knowledgeList = ref<Knowledge.KnowledgeItem[]>([])

// 文件输入点击处理
const handleFileInputClick = () => {
  fileInput.value?.click()
}

// 文件选择处理
const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  if (target.files && target.files.length > 0) {
    selectedFile.value = target.files[0]
  }
}

// 文件拖拽处理
const handleFileDrop = (event: DragEvent) => {
  event.preventDefault()
  if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
    selectedFile.value = event.dataTransfer.files[0]
  }
}

// 文件选择处理（旧版本，保留兼容性）
const handleFileSelect = (options: any) => {
  const { file } = options
  selectedFile.value = file
  return false // 阻止默认上传行为
}

// 模拟数据用于测试
const mockData: Knowledge.KnowledgeItem[] = [
  {
    id: '1',
    name: '产品手册.pdf',
    description: '公司产品详细说明文档',
    fileType: 'PDF',
    fileSize: 2048576,
    uploadTime: '2024-01-15T10:30:00Z',
    status: 'completed',
    chunks: 45,
    vectorCount: 1200
  },
  {
    id: '2',
    name: '技术文档.docx',
    description: '技术架构和实现细节',
    fileType: 'DOCX',
    fileSize: 1048576,
    uploadTime: '2024-01-14T15:20:00Z',
    status: 'processing',
    chunks: 0,
    vectorCount: 0
  },
  {
    id: '3',
    name: '用户指南.md',
    description: '用户使用指南和常见问题',
    fileType: 'MD',
    fileSize: 512000,
    uploadTime: '2024-01-13T09:15:00Z',
    status: 'completed',
    chunks: 23,
    vectorCount: 680
  }
]

// 过滤后的知识库列表
const filteredKnowledgeList = computed(() => {
  if (!searchValue.value) return knowledgeList.value
  return knowledgeList.value.filter(item =>
    item.name.toLowerCase().includes(searchValue.value.toLowerCase()) ||
    item.description.toLowerCase().includes(searchValue.value.toLowerCase())
  )
})

// 显示上传模态框
const handleUploadShow = () => {
  showUploadModal.value = true
}

// 加载知识库列表
const loadKnowledgeList = async () => {
  try {
    listLoading.value = true
    const res = await getKnowledgeList()
    if (res && res.status === '200') {
      knowledgeList.value = res.data
      knowledgeStore.setKnowledgeList(res.data)
    } else {
      // 如果API调用失败，使用模拟数据
      knowledgeList.value = mockData
      knowledgeStore.setKnowledgeList(mockData)
    }
  } catch (error) {
    console.error('加载知识库列表失败:', error)
    message.error(t('knowledge.loadFailed'))
    // 使用模拟数据作为后备
    knowledgeList.value = mockData
    knowledgeStore.setKnowledgeList(mockData)
  } finally {
    listLoading.value = false
  }
}

// 上传文档
const handleUpload = async () => {
  if (!selectedFile.value) {
    message.error(t('knowledge.selectFile'))
    return
  }

  if (!uploadDescription.value.trim()) {
    message.error(t('knowledge.inputDescription'))
    return
  }

  try {
    uploadLoading.value = true
    const res = await uploadDocument(selectedFile.value, uploadDescription.value)
    if (res && res.status === '200') {
      message.success(t('knowledge.uploadSuccess'))
      showUploadModal.value = false
      uploadDescription.value = ''
      selectedFile.value = null
      await loadKnowledgeList()
    }
  } catch (error) {
    console.error('文档上传失败:', error)
    message.error(t('knowledge.uploadFailed'))
  } finally {
    uploadLoading.value = false
  }
}

// 删除文档
const handleDelete = (id: string, name: string) => {
  dialog.warning({
    title: t('common.confirm'),
    content: t('knowledge.deleteConfirm', { name }),
    positiveText: t('knowledge.delete'),
    negativeText: t('knowledge.cancel'),
    onPositiveClick: async () => {
      try {
        const res = await deleteKnowledge(id)
        if (res && res.status === '200') {
          message.success(t('knowledge.deleteSuccess'))
          await loadKnowledgeList()
        }
      } catch (error) {
        console.error('文档删除失败:', error)
        message.error(t('knowledge.deleteFailed'))
      }
    },
  })
}

// 格式化文件大小
const formatFileSize = (bytes: number) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

// 获取状态标签
const getStatusTag = (status: string) => {
  const statusMap = {
    processing: { type: 'warning', text: t('knowledge.processing') },
    completed: { type: 'success', text: t('knowledge.completed') },
    failed: { type: 'error', text: t('knowledge.failed') },
  }
  return statusMap[status as keyof typeof statusMap] || { type: 'default', text: t('knowledge.unknown') }
}

// 数据表格列定义
const columns: DataTableColumns<Knowledge.KnowledgeItem> = [
  {
    title: t('knowledge.documentName'),
    key: 'name',
    width: 200,
    render: (row) => {
      return h('div', { class: 'flex items-center space-x-2' }, [
        h(SvgIcon, { icon: 'ri:file-text-line', class: 'text-lg' }),
        h('span', { class: 'font-medium' }, row.name)
      ])
    }
  },
  {
    title: t('knowledge.documentDescription'),
    key: 'description',
    width: 250,
    ellipsis: {
      tooltip: true
    }
  },
  {
    title: t('knowledge.fileType'),
    key: 'fileType',
    width: 100
  },
  {
    title: t('knowledge.fileSize'),
    key: 'fileSize',
    width: 100,
    render: (row) => formatFileSize(row.fileSize)
  },
  {
    title: t('knowledge.status'),
    key: 'status',
    width: 100,
    render: (row) => {
      const status = getStatusTag(row.status)
      return h('span', {
        class: `px-2 py-1 rounded text-xs ${status.type === 'success' ? 'bg-green-100 text-green-800' :
          status.type === 'warning' ? 'bg-yellow-100 text-yellow-800' :
            'bg-red-100 text-red-800'
          }`
      }, status.text)
    }
  },
  {
    title: t('knowledge.vectorCount'),
    key: 'vectorCount',
    width: 100
  },
  {
    title: t('knowledge.uploadTime'),
    key: 'uploadTime',
    width: 150,
    render: (row) => new Date(row.uploadTime).toLocaleString()
  },
  {
    title: t('knowledge.actions'),
    key: 'actions',
    width: 100,
    render: (row) => {
      return h(NSpace, { size: 'small' }, [
        h(NButton, {
          size: 'small',
          type: 'error',
          onClick: () => handleDelete(row.id, row.name)
        }, t('knowledge.delete'))
      ])
    }
  }
]

// 监听显示状态变化
watch(show, (val) => {
  if (val) {
    loadKnowledgeList()
  }
})

onMounted(() => {
  loadKnowledgeList()
})
</script>

<template>
  <!-- 知识库主模态框 -->
  <NModal v-model:show="show" :mask-closable="false" preset="card"
    :style="{ width: isMobile ? '90vw' : '80vw', maxWidth: '1200px' }" :title="t('knowledge.title')" size="huge"
    :bordered="false" :segmented="{
      content: true,
      footer: 'soft'
    }">
    <!-- 搜索和操作区域 -->
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center space-x-4">
        <NInput v-model:value="searchValue" :placeholder="t('knowledge.searchPlaceholder')" class="w-64" clearable>
          <template #prefix>
            <SvgIcon icon="ri:search-line" />
          </template>
        </NInput>
      </div>
      <NButton type="primary" @click="handleUploadShow">
        <template #icon>
          <SvgIcon icon="ri:upload-line" />
        </template>
        {{ t('knowledge.uploadDocument') }}
      </NButton>
    </div>

    <!-- 知识库列表 -->
    <NDataTable :columns="columns" :data="filteredKnowledgeList" :loading="listLoading" :pagination="{
      pageSize: 10,
      showSizePicker: true,
      pageSizes: [10, 20, 50]
    }" :bordered="false" striped />

    <!-- 上传文档模态框 -->
    <NModal v-model:show="showUploadModal" preset="card" :title="t('knowledge.uploadDocument')"
      :style="{ width: isMobile ? '90vw' : '500px' }" :mask-closable="false">
      <div class="space-y-4">
        <!-- 文件上传区域 -->
        <div
          class="upload-area border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 hover:bg-gray-50 transition-all"
          @click="handleFileInputClick" @drop="handleFileDrop" @dragover.prevent @dragenter.prevent>
          <input ref="fileInput" type="file" class="hidden" accept=".pdf,.doc,.docx,.txt,.md"
            @change="handleFileChange" />
          <SvgIcon icon="ri:upload-cloud-line" class="text-4xl text-gray-400 mb-2" />
          <NText class="text-gray-500">
            {{ t('knowledge.uploadTip') }}
          </NText>
          <NText class="text-xs text-gray-400 block mt-2">
            {{ t('knowledge.supportedFormats') }}
          </NText>
        </div>

        <!-- 已选择的文件 -->
        <div v-if="selectedFile" class="p-3 bg-gray-50 rounded">
          <div class="flex items-center space-x-2">
            <SvgIcon icon="ri:file-text-line" class="text-green-500" />
            <span class="font-medium">{{ selectedFile.name }}</span>
            <span class="text-sm text-gray-500">({{ formatFileSize(selectedFile.size) }})</span>
          </div>
        </div>

        <!-- 文档描述 -->
        <div>
          <NText class="text-sm font-medium mb-2 block">{{ t('knowledge.documentDescription') }}</NText>
          <NInput v-model:value="uploadDescription" type="textarea" :placeholder="t('knowledge.inputDescription')"
            :rows="3" />
        </div>
      </div>

      <!-- 操作按钮 -->
      <template #footer>
        <div class="flex justify-end space-x-2">
          <NButton @click="showUploadModal = false">
            {{ t('knowledge.cancel') }}
          </NButton>
          <NButton type="primary" :loading="uploadLoading" :disabled="!selectedFile || !uploadDescription.trim()"
            @click="handleUpload">
            {{ t('knowledge.upload') }}
          </NButton>
        </div>
      </template>
    </NModal>
  </NModal>
</template>

<style scoped>
.upload-area {
  border: 2px dashed #d1d5db;
  border-radius: 8px;
  transition: all 0.3s;
  cursor: pointer;
}

.upload-area:hover {
  border-color: #3b82f6;
  background-color: #f8fafc;
}

.upload-area.dragover {
  border-color: #3b82f6;
  background-color: #eff6ff;
}
</style>