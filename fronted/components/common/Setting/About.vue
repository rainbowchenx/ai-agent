<script setup lang='ts'>
/**
 * About组件
 * 显示应用版本信息、开源协议、API配置等详细信息
 */
import { computed, onMounted, ref } from 'vue'
import { NSpin } from 'naive-ui'
import pkg from '@/package.json' 
import { fetchChatConfig } from '@/api'
import { useAuthStore } from '@/store'

/**
 * 配置状态接口
 */
interface ConfigState {
  timeoutMs?: number      // 超时时间
  reverseProxy?: string   // 反向代理地址
  apiModel?: string       // API模型
  socksProxy?: string     // SOCKS代理
  httpsProxy?: string     // HTTPS代理
  usage?: string          // 使用量
}

const authStore = useAuthStore()

/**
 * 加载状态
 */
const loading = ref(false)

/**
 * 配置信息
 */
const config = ref<ConfigState>()

/**
 * 是否为ChatGPT API模式  TODO 后续需要配置国内模型
 */
const isChatGPTAPI = computed<boolean>(() => !!authStore.isChatGPTAPI)

/**
 * 获取配置信息
 * 从后端API获取应用配置
 */
async function fetchConfig() {
  try {
    loading.value = true
    const { data } = await fetchChatConfig<ConfigState>()
    config.value = data
  }
  finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchConfig()
})
</script>

<template>
  <!-- 加载状态包装器 -->
  <NSpin :show="loading">
    <div class="p-4 space-y-4">
      <!-- 版本信息 -->
      <h2 class="text-xl font-bold">
        Version - {{ pkg.version }}
      </h2>
      <!-- 开源信息 -->
      <div class="p-2 space-y-2 rounded-md bg-neutral-100 dark:bg-neutral-700">
        <p>
          {{ $t("setting.openSource") }}
          <a
            class="text-blue-600 dark:text-blue-500"
            href="#"
            target="_blank"
          >
            GitHub
          </a>
          {{ $t("setting.freeMIT") }}
        </p>
        <p>
          {{ $t("setting.stars") }}
        </p>
      </div>
      <!-- 配置信息展示 -->
      <p>{{ $t("setting.api") }}：{{ config?.apiModel ?? '-' }}</p>
      <p v-if="isChatGPTAPI">
        {{ $t("setting.monthlyUsage") }}：{{ config?.usage ?? '-' }}
      </p>
      <p v-if="!isChatGPTAPI">
        {{ $t("setting.reverseProxy") }}：{{ config?.reverseProxy ?? '-' }}
      </p>
      <p>{{ $t("setting.timeout") }}：{{ config?.timeoutMs ?? '-' }}</p>
      <p>{{ $t("setting.socks") }}：{{ config?.socksProxy ?? '-' }}</p>
      <p>{{ $t("setting.httpsProxy") }}：{{ config?.httpsProxy ?? '-' }}</p>
    </div>
  </NSpin>
</template>
