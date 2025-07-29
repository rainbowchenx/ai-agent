/**
 * 聊天侧边栏主组件
 * 提供聊天历史列表、新建聊天、清空历史等功能
 */
<script setup lang='ts'>
import type { CSSProperties } from 'vue'
import { computed, ref, watch } from 'vue'
import { NButton, NLayoutSider, useDialog } from 'naive-ui'
import List from './List.vue'
import Footer from './Footer.vue'
import { useAppStore, useChatStore } from '@/store'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { PromptStore, SvgIcon } from '@/components/common'
import { t } from '@/locales'
import { fetchCreateSession } from '@/api'

// 获取应用和聊天状态管理
const appStore = useAppStore()
const chatStore = useChatStore()

// 全局dialog弹窗
const dialog = useDialog()

// 移动端判断
const { isMobile } = useBasicLayout()

// 控制提示词商店显示状态
const show = ref(false)

// 计算侧边栏折叠状态
const collapsed = computed(() => appStore.siderCollapsed)

/**
 * 处理新建聊天
 * 创建新的聊天历史记录并切换到移动端时自动折叠侧边栏
 */
async function handleAdd() {
  // 发请求创建新的聊天历史记录
  const res:any = await fetchCreateSession();
  console.log("创建新的聊天历史记录",res);
  if(res.status === 200){
    const data = res.data;
    chatStore.addHistory({ 
      title: data.name? data.name : t('chat.newChatTitle'), 
      uuid: data.session_id, 
      isEdit: false })
    if (isMobile.value)
      appStore.setSiderCollapsed(true)
  }
}

/**
 * 处理侧边栏折叠状态切换
 */
function handleUpdateCollapsed() {
  appStore.setSiderCollapsed(!collapsed.value)
}

/**
 * 处理清空所有聊天历史
 * 显示确认对话框，用户确认后清空历史记录
 */
function handleClearAll() {
  dialog.warning({
    title: t('chat.deleteMessage'),
    content: t('chat.clearHistoryConfirm'),
    positiveText: t('common.yes'),
    negativeText: t('common.no'),
    onPositiveClick: () => {
      chatStore.clearHistory()
      if (isMobile.value)
        appStore.setSiderCollapsed(true)
    },
  })
}

/**
 * 计算移动端样式类
 * 在移动端时使用固定定位和较高的z-index
 */
const getMobileClass = computed<CSSProperties>(() => {
  if (isMobile.value) {
    return {
      position: 'fixed',
      zIndex: 50,
    }
  }
  return {}
})

/**
 * 计算移动端安全区域样式
 * 为移动端设备添加底部安全区域的内边距
 */
const mobileSafeArea = computed(() => {
  if (isMobile.value) {
    return {
      paddingBottom: 'env(safe-area-inset-bottom)',
    }
  }
  return {}
})

/**
 * 监听移动端状态变化
 * 当切换到移动端时自动折叠侧边栏
 */
watch(
  isMobile,
  (val) => {
    appStore.setSiderCollapsed(val)
  },
  {
    immediate: true,
    flush: 'post',
  },
)
</script>

<template>
  <!-- 侧边栏主容器 -->
  <NLayoutSider
    :collapsed="collapsed"
    :collapsed-width="0"
    :width="260"
    :show-trigger="isMobile ? false : 'arrow-circle'"
    collapse-mode="transform"
    position="absolute"
    bordered
    :style="getMobileClass"
    @update-collapsed="handleUpdateCollapsed"
  >
    <!-- 侧边栏内容容器 -->
    <div class="flex flex-col h-full" :style="mobileSafeArea">
      <!-- 主要内容区域 -->
      <main class="flex flex-col flex-1 min-h-0">
        <!-- 新建聊天按钮区域 -->
        <div class="p-4">
          <NButton dashed block @click="handleAdd">
            {{ $t('chat.newChatButton') }}
          </NButton>
        </div>
        
        <!-- 聊天历史列表区域 -->
        <div class="flex-1 min-h-0 pb-4 overflow-hidden">
          <List />
        </div>
        
        <!-- 底部操作区域 -->
        <div class="flex items-center p-4 space-x-4">
          <!-- 提示词商店按钮 -->
          <div class="flex-1">
            <NButton block @click="show = true">
              {{ $t('store.siderButton') }}
            </NButton>
          </div>
          <!-- 清空历史按钮 -->
          <NButton @click="handleClearAll">
            <SvgIcon icon="ri:close-circle-line" />
          </NButton>
        </div>
      </main>
      
      <!-- 底部用户信息和设置 -->
      <Footer />
    </div>
  </NLayoutSider>
  
  <!-- 移动端遮罩层 -->
  <template v-if="isMobile">
    <div v-show="!collapsed" class="fixed inset-0 z-40 w-full h-full bg-black/40" @click="handleUpdateCollapsed" />
  </template>
  
  <!-- 提示词商店组件 -->
  <PromptStore v-model:visible="show" />
</template>
