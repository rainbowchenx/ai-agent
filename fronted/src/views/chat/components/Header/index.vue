<script lang="ts" setup>
/**
 * 移动端聊天页面头部组件
 * 功能：提供侧边栏切换、会话标题显示、导出和清空操作
 */

import { computed, nextTick } from 'vue'
import { HoverButton, SvgIcon } from '@/components/common'
import { useAppStore, useChatStore } from '@/store'

// 组件属性：是否使用上下文
interface Props {
  usingContext: boolean
}

// 组件事件：导出和清空操作
interface Emit {
  (ev: 'export'): void
  (ev: 'handleClear'): void
}

defineProps<Props>()
const emit = defineEmits<Emit>()

const appStore = useAppStore()
const chatStore = useChatStore()

// 侧边栏折叠状态
const collapsed = computed(() => appStore.siderCollapsed)
// 当前活跃的聊天历史
const currentChatHistory = computed(() => chatStore.getChatHistoryByCurrentActive)

/**
 * 切换侧边栏显示/隐藏状态
 */
function handleUpdateCollapsed() {
  appStore.setSiderCollapsed(!collapsed.value)
}

/**
 * 双击标题时滚动到页面顶部
 */
function onScrollToTop() {
  const scrollRef = document.querySelector('#scrollRef')
  if (scrollRef)
    nextTick(() => scrollRef.scrollTop = 0)
}

/**
 * 触发导出操作
 */
function handleExport() {
  emit('export')
}

/**
 * 触发清空聊天操作
 */
function handleClear() {
  emit('handleClear')
}
</script>

<template>
  <!-- 固定头部容器 -->
  <header
    class="sticky top-0 left-0 right-0 z-30 border-b dark:border-neutral-800 bg-white/80 dark:bg-black/20 backdrop-blur"
  >
    <div class="relative flex items-center justify-between min-w-0 overflow-hidden h-14">
      <!-- 左侧：侧边栏切换按钮 -->
      <div class="flex items-center">
        <button
          class="flex items-center justify-center w-11 h-11"
          @click="handleUpdateCollapsed"
        >
          <SvgIcon v-if="collapsed" class="text-2xl" icon="ri:align-justify" />
          <SvgIcon v-else class="text-2xl" icon="ri:align-right" />
        </button>
      </div>
      
      <!-- 中间：会话标题（双击可滚动到顶部） -->
      <h1
        class="flex-1 px-4 pr-6 overflow-hidden cursor-pointer select-none text-ellipsis whitespace-nowrap"
        @dblclick="onScrollToTop"
      >
        {{ currentChatHistory?.title ?? '' }}
      </h1>
      
      <!-- 右侧：操作按钮 -->
      <div class="flex items-center space-x-2">
        <!-- 导出按钮 -->
        <HoverButton @click="handleExport">
          <span class="text-xl text-[#4f555e] dark:text-white">
            <SvgIcon icon="ri:download-2-line" />
          </span>
        </HoverButton>
        
        <!-- 清空按钮 -->
        <HoverButton @click="handleClear">
          <span class="text-xl text-[#4f555e] dark:text-white">
            <SvgIcon icon="ri:delete-bin-line" />
          </span>
        </HoverButton>
      </div>
    </div>
  </header>
</template>
