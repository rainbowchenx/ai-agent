/**
 * 侧边栏底部组件
 * 显示用户头像和设置按钮
 * 提供用户信息展示和设置入口
 */
<script setup lang='ts'>
import { defineAsyncComponent, ref } from 'vue'
import { HoverButton, SvgIcon, UserAvatar } from '@/components/common'

// 异步加载设置组件，提高性能
const Setting = defineAsyncComponent(() => import('@/components/common/Setting/index.vue'))

// 控制设置面板显示状态
const show = ref(false)
</script>

<template>
  <!-- 底部容器 -->
  <footer class="flex items-center justify-between min-w-0 p-4 overflow-hidden border-t dark:border-neutral-800">
    <!-- 用户头像区域 -->
    <div class="flex-1 flex-shrink-0 overflow-hidden">
      <UserAvatar />
    </div>

    <!-- 设置按钮 -->
    <HoverButton @click="show = true">
      <span class="text-xl text-[#4f555e] dark:text-white">
        <SvgIcon icon="ri:settings-4-line" />
      </span>
    </HoverButton>

    <!-- 设置面板（条件渲染） -->
    <Setting v-if="show" v-model:visible="show" />
  </footer>
</template>
