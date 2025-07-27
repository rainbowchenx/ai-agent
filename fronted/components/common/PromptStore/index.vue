<script setup lang='ts'>
/**
 * 提示词商店组件
 * 提供提示词模板的管理功能，包括本地管理、在线导入、导出等功能
 */
import type { DataTableColumns } from 'naive-ui'
import { computed, h, ref, watch } from 'vue'
import { NButton, NCard, NDataTable, NDivider, NInput, NList, NListItem, NModal, NPopconfirm, NSpace, NTabPane, NTabs, NThing, useMessage } from 'naive-ui'
import PromptRecommend from '@/assets/recommend.json' 
import { SvgIcon } from '@/components/common'
import { usePromptStore } from '@/store'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { t } from '@/locales'

/**
 * 数据表格行数据接口
 */
interface DataProps {
  renderKey: string      // 显示的标题
  renderValue: string    // 显示的描述
  key: string           // 原始标题
  value: string         // 原始描述
}


interface Props {
  visible: boolean       // 是否显示提示词商店
}


interface Emit {
  (e: 'update:visible', visible: boolean): void    // 更新显示状态
}

const props = defineProps<Props>()

const emit = defineEmits<Emit>()

const message = useMessage()

/**
 * 显示状态计算属性
 * 支持双向绑定
 */
const show = computed({
  get: () => props.visible,
  set: (visible: boolean) => emit('update:visible', visible),
})

/**
 * 模态框显示状态
 */
const showModal = ref(false)

/**
 * 导入加载状态
 */
const importLoading = ref(false)

/**
 * 导出加载状态
 */
const exportLoading = ref(false)

/**
 * 搜索关键词
 */
const searchValue = ref<string>('')

// 移动端自适应相关
const { isMobile } = useBasicLayout()

const promptStore = usePromptStore()

/**
 * 在线导入推荐列表
 * 从assets/recommend.json获取推荐模板
 */
const promptRecommendList = PromptRecommend

/**
 * 提示词列表
 */
const promptList = ref<any>(promptStore.promptList)

/**
 * 临时提示词标题
 * 用于添加和修改操作
 */
const tempPromptKey = ref('')

/**
 * 临时提示词内容
 * 用于添加和修改操作
 */
const tempPromptValue = ref('')

/**
 * 模态框模式
 * 区分添加、修改、本地导入等不同操作
 */
const modalMode = ref('')

/**
 * 临时修改项
 * 记录待修改的提示词信息
 */
const tempModifiedItem = ref<any>({})

/**
 * 切换模态框显示状态
 * @param mode 模态框模式：add-添加，modify-修改，local_import-本地导入
 * @param selected 选中的提示词项
 */
const changeShowModal = (mode: 'add' | 'modify' | 'local_import', selected = { key: '', value: '' }) => {
  if (mode === 'add') {
    // 添加模式：清空临时数据
    tempPromptKey.value = ''
    tempPromptValue.value = ''
  }
  else if (mode === 'modify') {
    // 修改模式：填充待修改数据
    tempModifiedItem.value = { ...selected }
    tempPromptKey.value = selected.key
    tempPromptValue.value = selected.value
  }
  else if (mode === 'local_import') {
    // 本地导入模式：设置特殊标识
    tempPromptKey.value = 'local_import'
    tempPromptValue.value = ''
  }
  showModal.value = !showModal.value
  modalMode.value = mode
}

// 在线导入相关
/**
 * 下载URL
 */
const downloadURL = ref('')

/**
 * 下载按钮禁用状态
 * URL为空时禁用
 */
const downloadDisabled = computed(() => downloadURL.value.trim().length < 1)

/**
 * 设置下载URL
 * @param url 下载链接
 */
const setDownloadURL = (url: string) => {
  downloadURL.value = url
}

/**
 * 输入验证状态
 * 标题或内容为空时禁用确认按钮
 */
const inputStatus = computed (() => tempPromptKey.value.trim().length < 1 || tempPromptValue.value.trim().length < 1)

/**
 * 添加提示词模板
 * 检查重复性并添加到列表开头
 */
const addPromptTemplate = () => {
  // 检查标题重复
  for (const i of promptList.value) {
    if (i.key === tempPromptKey.value) {
      message.error(t('store.addRepeatTitleTips'))
      return
    }
    // 检查内容重复
    if (i.value === tempPromptValue.value) {
      message.error(t('store.addRepeatContentTips', { msg: tempPromptKey.value }))
      return
    }
  }
  // 添加到列表开头
  promptList.value.unshift({ key: tempPromptKey.value, value: tempPromptValue.value } as never)
  message.success(t('common.addSuccess'))
  changeShowModal('add')
}

/**
 * 修改提示词模板
 * 检查重复性并更新指定项
 */
const modifyPromptTemplate = () => {
  let index = 0

  // 查找待修改项的索引
  for (const i of promptList.value) {
    if (i.key === tempModifiedItem.value.key && i.value === tempModifiedItem.value.value)
      break
    index = index + 1
  }

  // 过滤掉待修改项
  const tempList = promptList.value.filter((_: any, i: number) => i !== index)

  // 检查修改后的重复性
  for (const i of tempList) {
    if (i.key === tempPromptKey.value) {
      message.error(t('store.editRepeatTitleTips'))
      return
    }
    if (i.value === tempPromptValue.value) {
      message.error(t('store.editRepeatContentTips', { msg: i.key }))
      return
    }
  }

  // 更新列表
  promptList.value = [{ key: tempPromptKey.value, value: tempPromptValue.value }, ...tempList] as never
  message.success(t('common.editSuccess'))
  changeShowModal('modify')
}

/**
 * 删除提示词模板
 * @param row 要删除的提示词项
 */
const deletePromptTemplate = (row: { key: string; value: string }) => {
  promptList.value = [
    ...promptList.value.filter((item: { key: string; value: string }) => item.key !== row.key),
  ] as never
  message.success(t('common.deleteSuccess'))
}

/**
 * 清空所有提示词模板
 */
const clearPromptTemplate = () => {
  promptList.value = []
  message.success(t('common.clearSuccess'))
}

/**
 * 导入提示词模板
 * @param from 导入来源：online-在线，local-本地
 */
const importPromptTemplate = (from = 'online') => {
  try {
    const jsonData = JSON.parse(tempPromptValue.value)
    let key = ''
    let value = ''
    // 支持不同的JSON格式
    if ('key' in jsonData[0]) {
      key = 'key'
      value = 'value'
    }
    else if ('act' in jsonData[0]) {
      key = 'act'
      value = 'prompt'
    }
    else {
      // 不支持的格式
      message.warning('prompt key not supported.')
      throw new Error('prompt key not supported.')
    }

    // 逐个导入，检查重复性
    for (const i of jsonData) {
      if (!(key in i) || !(value in i))
        throw new Error(t('store.importError'))
      let safe = true
      for (const j of promptList.value) {
        if (j.key === i[key]) {
          message.warning(t('store.importRepeatTitle', { msg: i[key] }))
          safe = false
          break
        }
        if (j.value === i[value]) {
          message.warning(t('store.importRepeatContent', { msg: i[key] }))
          safe = false
          break
        }
      }
      if (safe)
        promptList.value.unshift({ key: i[key], value: i[value] } as never)
    }
    message.success(t('common.importSuccess'))
  }
  catch {
    message.error('JSON 格式错误，请检查 JSON 格式')
  }
  if (from === 'local')
    showModal.value = !showModal.value
}

/**
 * 导出提示词模板
 * 将当前列表导出为JSON文件
 */
const exportPromptTemplate = () => {
  exportLoading.value = true
  const jsonDataStr = JSON.stringify(promptList.value)
  const blob = new Blob([jsonDataStr], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'ChatGPTPromptTemplate.json'
  link.click()
  URL.revokeObjectURL(url)
  exportLoading.value = false
}

/**
 * 在线下载提示词模板
 * 从指定URL下载并导入模板
 */
const downloadPromptTemplate = async () => {
  try {
    importLoading.value = true
    const response = await fetch(downloadURL.value)
    const jsonData = await response.json()
    // 支持不同的JSON格式
    if ('key' in jsonData[0] && 'value' in jsonData[0])
      tempPromptValue.value = JSON.stringify(jsonData)
    if ('act' in jsonData[0] && 'prompt' in jsonData[0]) {
      const newJsonData = jsonData.map((item: { act: string; prompt: string }) => {
        return {
          key: item.act,
          value: item.prompt,
        }
      })
      tempPromptValue.value = JSON.stringify(newJsonData)
    }
    importPromptTemplate()
    downloadURL.value = ''
  }
  catch {
    message.error(t('store.downloadError'))
    downloadURL.value = ''
  }
  finally {
    importLoading.value = false
  }
}

/**
 * 渲染模板数据
 * 根据移动端状态调整显示长度
 */
const renderTemplate = () => {
  const [keyLimit, valueLimit] = isMobile.value ? [10, 30] : [15, 50]

  return promptList.value.map((item: { key: string; value: string }) => {
    return {
      renderKey: item.key.length <= keyLimit ? item.key : `${item.key.substring(0, keyLimit)}...`,
      renderValue: item.value.length <= valueLimit ? item.value : `${item.value.substring(0, valueLimit)}...`,
      key: item.key,
      value: item.value,
    }
  })
}

/**
 * 分页配置
 * 根据移动端状态调整分页参数
 */
const pagination = computed(() => {
  const [pageSize, pageSlot] = isMobile.value ? [6, 5] : [7, 15]
  return {
    pageSize, pageSlot,
  }
})

/**
 * 创建数据表格列配置
 * @returns 表格列配置
 */
const createColumns = (): DataTableColumns<DataProps> => {
  return [
    {
      title: t('store.title'),
      key: 'renderKey',
    },
    {
      title: t('store.description'),
      key: 'renderValue',
    },
    {
      title: t('common.action'),
      key: 'actions',
      width: 100,
      align: 'center',
      render(row) {
        return h('div', { class: 'flex items-center flex-col gap-2' }, {
          default: () => [h(
            NButton,
            {
              tertiary: true,
              size: 'small',
              type: 'info',
              onClick: () => changeShowModal('modify', row),
            },
            { default: () => t('common.edit') },
          ),
          h(
            NButton,
            {
              tertiary: true,
              size: 'small',
              type: 'error',
              onClick: () => deletePromptTemplate(row),
            },
            { default: () => t('common.delete') },
          ),
          ],
        })
      },
    },
  ]
}

const columns = createColumns()

/**
 * 监听提示词列表变化
 * 同步到store中
 */
watch(
  () => promptList,
  () => {
    promptStore.updatePromptList(promptList.value)
  },
  { deep: true },
)

/**
 * 数据源计算属性
 * 支持搜索过滤
 */
const dataSource = computed(() => {
  const data = renderTemplate()
  const value = searchValue.value
  if (value && value !== '') {
    return data.filter((item: DataProps) => {
      return item.renderKey.includes(value) || item.renderValue.includes(value)
    })
  }
  return data
})
</script>

<template>
  <!-- 提示词商店主模态框 -->
  <NModal v-model:show="show" style="width: 90%; max-width: 900px;" preset="card">
    <div class="space-y-4">
      <!-- 标签页导航 -->
      <NTabs type="segment">
        <!-- 本地管理标签页 -->
        <NTabPane name="local" :tab="$t('store.local')">
          <!-- 操作按钮区域 -->
          <div
            class="flex gap-3 mb-4"
            :class="[isMobile ? 'flex-col' : 'flex-row justify-between']"
          >
            <!-- 左侧操作按钮 -->
            <div class="flex items-center space-x-4">
              <NButton
                type="primary"
                size="small"
                @click="changeShowModal('add')"
              >
                {{ $t('common.add') }}
              </NButton>
              <NButton
                size="small"
                @click="changeShowModal('local_import')"
              >
                {{ $t('common.import') }}
              </NButton>
              <NButton
                size="small"
                :loading="exportLoading"
                @click="exportPromptTemplate()"
              >
                {{ $t('common.export') }}
              </NButton>
              <NPopconfirm @positive-click="clearPromptTemplate">
                <template #trigger>
                  <NButton size="small">
                    {{ $t('common.clear') }}
                  </NButton>
                </template>
                {{ $t('store.clearStoreConfirm') }}
              </NPopconfirm>
            </div>
            <!-- 右侧搜索框 -->
            <div class="flex items-center">
              <NInput v-model:value="searchValue" style="width: 100%" />
            </div>
          </div>
          <!-- 桌面端数据表格 -->
          <NDataTable
            v-if="!isMobile"
            :max-height="400"
            :columns="columns"
            :data="dataSource"
            :pagination="pagination"
            :bordered="false"
          />
          <!-- 移动端列表视图 -->
          <NList v-if="isMobile" style="max-height: 400px; overflow-y: auto;">
            <NListItem v-for="(item, index) of dataSource" :key="index">
              <NThing :title="item.renderKey" :description="item.renderValue" />
              <template #suffix>
                <div class="flex flex-col items-center gap-2">
                  <NButton tertiary size="small" type="info" @click="changeShowModal('modify', item)">
                    {{ t('common.edit') }}
                  </NButton>
                  <NButton tertiary size="small" type="error" @click="deletePromptTemplate(item)">
                    {{ t('common.delete') }}
                  </NButton>
                </div>
              </template>
            </NListItem>
          </NList>
        </NTabPane>
        <!-- 在线导入标签页 -->
        <NTabPane name="download" :tab="$t('store.online')">
          <!-- 导入警告提示 -->
          <p class="mb-4">
            {{ $t('store.onlineImportWarning') }}
          </p>
          <!-- URL输入和下载按钮 -->
          <div class="flex items-center gap-4">
            <NInput v-model:value="downloadURL" placeholder="" />
            <NButton
              strong
              secondary
              :disabled="downloadDisabled"
              :loading="importLoading"
              @click="downloadPromptTemplate()"
            >
              {{ $t('common.download') }}
            </NButton>
          </div>
          <NDivider />
          <!-- 推荐模板列表 -->
          <div class="max-h-[360px] overflow-y-auto space-y-4">
            <NCard
              v-for="info in promptRecommendList"
              :key="info.key" :title="info.key"
              :bordered="true"
              embedded
            >
              <p
                class="overflow-hidden text-ellipsis whitespace-nowrap"
                :title="info.desc"
              >
                {{ info.desc }}
              </p>
              <template #footer>
                <div class="flex items-center justify-end space-x-4">
                  <!-- 查看链接按钮 -->
                  <NButton text>
                    <a
                      :href="info.url"
                      target="_blank"
                    >
                      <SvgIcon class="text-xl" icon="ri:link" />
                    </a>
                  </NButton>
                  <!-- 添加到下载按钮 -->
                  <NButton text @click="setDownloadURL(info.downloadUrl) ">
                    <SvgIcon class="text-xl" icon="ri:add-fill" />
                  </NButton>
                </div>
              </template>
            </NCard>
          </div>
        </NTabPane>
      </NTabs>
    </div>
  </NModal>

  <!-- 操作模态框 -->
  <NModal v-model:show="showModal" style="width: 90%; max-width: 600px;" preset="card">
    <!-- 添加/修改模式 -->
    <NSpace v-if="modalMode === 'add' || modalMode === 'modify'" vertical>
      {{ t('store.title') }}
      <NInput v-model:value="tempPromptKey" />
      {{ t('store.description') }}
      <NInput v-model:value="tempPromptValue" type="textarea" />
      <NButton
        block
        type="primary"
        :disabled="inputStatus"
        @click="() => { modalMode === 'add' ? addPromptTemplate() : modifyPromptTemplate() }"
      >
        {{ t('common.confirm') }}
      </NButton>
    </NSpace>
    <!-- 本地导入模式 -->
    <NSpace v-if="modalMode === 'local_import'" vertical>
      <NInput
        v-model:value="tempPromptValue"
        :placeholder="t('store.importPlaceholder')"
        :autosize="{ minRows: 3, maxRows: 15 }"
        type="textarea"
      />
      <NButton
        block
        type="primary"
        :disabled="inputStatus"
        @click="() => { importPromptTemplate('local') }"
      >
        {{ t('common.import') }}
      </NButton>
    </NSpace>
  </NModal>
</template>
