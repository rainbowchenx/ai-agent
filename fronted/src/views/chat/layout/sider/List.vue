/**
 * 聊天历史列表组件
 * 显示用户的聊天历史记录，支持选择、编辑、删除操作
 */
<script setup lang='ts'>
import { computed, onMounted } from 'vue'
import { NInput, NPopconfirm, NScrollbar } from 'naive-ui'
import { SvgIcon } from '@/components/common'
import { useAppStore, useChatStore } from '@/store'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { debounce } from '@/utils/functions/debounce'

const { isMobile } = useBasicLayout()

// 获取应用和聊天状态管理
const appStore = useAppStore()
const chatStore = useChatStore()

// 计算聊天历史数据源
const dataSources = computed(() => chatStore.history)

/**
 * 处理聊天历史选择
 * 如果当前聊天已激活则不执行操作
 * 更新之前激活的聊天为非编辑状态，设置新的激活聊天
 * @param history 选中的聊天历史对象
 */
async function handleSelect({ uuid }: Chat.History) {
  if (isActive(uuid))
    return

  if (chatStore.active)
    chatStore.updateHistory(chatStore.active, { isEdit: false })
  await chatStore.setActive(uuid)

  if (isMobile.value)
    appStore.setSiderCollapsed(true)
}

/**
 * 处理聊天标题编辑状态切换
 * @param history 聊天历史对象
 * @param isEdit 是否进入编辑状态
 * @param event 鼠标事件对象
 */
function handleEdit({ uuid }: Chat.History, isEdit: boolean, event?: MouseEvent) {
  event?.stopPropagation()

  console.log("handleEdit", uuid, isEdit)
  chatStore.updateHistory(uuid, { isEdit })
}

/**
 * 处理保存编辑内容
 * @param history 聊天历史对象
 * @param event 鼠标事件对象
 */
async function handleSave({ uuid }: Chat.History, event?: MouseEvent) {
  event?.stopPropagation()
  try {
    // 保存编辑内容，这会触发后端API调用
    await chatStore.updateHistory(uuid, { isEdit: false })
    console.log('标题保存成功')
  } catch (error) {
    console.error('保存标题失败:', error)
  }
}

/**
 * 处理删除聊天历史
 * @param index 要删除的历史记录索引
 * @param event 鼠标或触摸事件对象
 */
async function handleDelete(index: number, event?: MouseEvent | TouchEvent) {
  event?.stopPropagation()
  await chatStore.deleteHistory(index)
  if (isMobile.value)
    appStore.setSiderCollapsed(true)
}

// 防抖删除函数，避免快速点击导致误删
const handleDeleteDebounce = debounce(handleDelete, 600)

/**
 * 处理编辑状态下的回车键事件
 * 按回车键保存编辑内容
 * @param history 聊天历史对象
 * @param event 键盘事件对象
 */
async function handleEnter({ uuid }: Chat.History, event: KeyboardEvent) {
  event?.stopPropagation()
  if (event.key === 'Enter') {
    try {
      // 保存编辑内容，这会触发后端API调用
      await chatStore.updateHistory(uuid, { isEdit: false })
      console.log('标题保存成功')
    } catch (error) {
      console.error('保存标题失败:', error)
    }
  }
}

/**
 * 判断聊天历史是否为当前激活状态
 * @param uuid 聊天历史的唯一标识
 * @returns 是否为激活状态
 */
function isActive(uuid: number) {
  return chatStore.active === uuid
}

onMounted(async () => {
  await chatStore.getUserSessions()
})
</script>

<template>
  <!-- 可滚动的聊天历史列表容器 -->
  <NScrollbar class="px-4">
    <div class="flex flex-col gap-2 text-sm">
      <!-- 空状态显示 -->
      <template v-if="!dataSources.length">
        <div class="flex flex-col items-center mt-4 text-center text-neutral-300">
          <SvgIcon icon="ri:inbox-line" class="mb-2 text-3xl" />
          <span>{{ $t('common.noData') }}</span>
        </div>
      </template>
      
      <!-- 聊天历史列表 -->
      <template v-else>
        <div v-for="(item, index) of dataSources" :key="index">
          <!-- 单个聊天历史项 -->
          <a
            class="relative flex items-center gap-3 px-3 py-3 break-all border rounded-md cursor-pointer hover:bg-neutral-100 group dark:border-neutral-800 dark:hover:bg-[#24272e]"
            :class="isActive(item.uuid) && ['border-[#4b9e5f]', 'bg-neutral-100', 'text-[#4b9e5f]', 'dark:bg-[#24272e]', 'dark:border-[#4b9e5f]', 'pr-14']"
            @click="handleSelect(item)"
          >
            <!-- 聊天图标 -->
            <span>
              <SvgIcon icon="ri:message-3-line" />
            </span>
            
            <!-- 聊天标题区域 -->
            <div class="relative flex-1 overflow-hidden break-all text-ellipsis whitespace-nowrap">
              <!-- 编辑状态：显示输入框 -->
              <NInput
                v-if="item.isEdit"
                v-model:value="item.title" size="tiny"
                @keypress="handleEnter(item, $event)"
              />
              <!-- 非编辑状态：显示标题文本 -->
              <span v-else>{{ item.title }}</span>
            </div>
            
            <!-- 操作按钮区域（仅在激活状态显示） -->
            <div v-if="isActive(item.uuid)" class="absolute z-10 flex visible right-1">
              <!-- 编辑状态：显示保存按钮 -->
              <template v-if="item.isEdit">
                <button class="p-1" @click="handleSave(item, $event)">
                  <SvgIcon icon="ri:save-line" />
                </button>
              </template>
              <!-- 非编辑状态：显示编辑和删除按钮 -->
              <template v-else>
                <button class="p-1">
                  <SvgIcon icon="ri:edit-line" @click="handleEdit(item, true, $event)" />
                </button>
                <!-- 删除确认弹窗 -->
                <NPopconfirm placement="bottom" @positive-click="handleDeleteDebounce(index, $event)">
                  <template #trigger>
                    <button class="p-1">
                      <SvgIcon icon="ri:delete-bin-line" />
                    </button>
                  </template>
                  {{ $t('chat.deleteHistoryConfirm') }}
                </NPopconfirm>
              </template>
            </div>
          </a>
        </div>
      </template>
    </div>
  </NScrollbar>
</template>
