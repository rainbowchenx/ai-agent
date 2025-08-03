<script setup lang="ts">
import { onMounted } from 'vue'
import { NConfigProvider } from 'naive-ui'
import { NaiveProvider } from '@/components/common'
import { useTheme } from '@/hooks/useTheme'
import { useLanguage } from '@/hooks/useLanguage'
import { useChatStore, useAuthStore } from '@/store'

const { theme, themeOverrides } = useTheme()
const { language } = useLanguage()

// 应用启动时的初始化逻辑
onMounted(async () => {
  const authStore = useAuthStore()
  const chatStore = useChatStore()
  
  // 如果用户已登录，初始化聊天store
  if (authStore.authInfo?.token) {
    try {
      await chatStore.init()
    } catch (error) {
      console.error('应用启动时初始化聊天store失败:', error)
    }
  }
})
</script>

<template>
  <NConfigProvider
    class="h-full"
    :theme="theme"
    :theme-overrides="themeOverrides"
    :locale="language"
  >
    <NaiveProvider>
      <RouterView />
    </NaiveProvider>
  </NConfigProvider>
</template>
