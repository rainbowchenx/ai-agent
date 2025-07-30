<script setup lang='ts'>
/**
 * 用户头像组件
 * 显示用户头像、姓名和描述信息
 */
import { computed } from 'vue'
import { NAvatar } from 'naive-ui'
import { useUserStore } from '@/store'
import defaultAvatar from '@/assets/avatar.jpg'
import { isString } from '@/utils/is'

const userStore = useUserStore()

/**
 * 用户信息计算属性
 * 从store中获取用户信息
 */
const userInfo = computed(() => userStore.userInfo)
</script>

<template>
  <!-- 用户信息展示容器 -->
  <div class="flex items-center overflow-hidden">
    <!-- 头像容器 -->
    <div class="w-10 h-10 overflow-hidden rounded-full shrink-0">
      <!-- 有自定义头像时显示自定义头像 -->
      <template v-if="isString(userInfo.avatar) && userInfo.avatar.length > 0">
        <NAvatar
          size="large"
          round
          :src="userInfo.avatar"
          :fallback-src="defaultAvatar"
        />
      </template>
      <!-- 无自定义头像时显示默认头像 -->
      <template v-else>
        <NAvatar size="large" round :src="defaultAvatar" />
      </template>
    </div>
    <!-- 用户信息文本区域 -->
    <div class="flex-1 min-w-0 ml-2">
      <!-- 用户姓名 -->
      <h2 class="overflow-hidden font-bold text-md text-ellipsis whitespace-nowrap">
        {{ userInfo.name ?? 'rain' }}
      </h2>
      <!-- 用户描述 -->
      <p class="overflow-hidden text-xs text-gray-500 text-ellipsis whitespace-nowrap">
        <span
          v-if="isString(userInfo.description) && userInfo.description !== ''"
          v-html="userInfo.description"
        />
      </p>
    </div>
  </div>
</template>
