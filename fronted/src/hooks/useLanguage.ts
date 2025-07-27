/**
 * 国际化配置
 */

import { computed } from 'vue'
import { enUS, zhCN } from 'naive-ui'
import { useAppStore } from '@/store'
import { setLocale } from '@/locales'

/**
 * 语言切换组合式函数
 * @returns 返回当前语言配置
 */
export function useLanguage() {
  const appStore = useAppStore()

  const language = computed(() => {
    setLocale(appStore.language)
    switch (appStore.language) {
      case 'en-US':
        return enUS
      case 'zh-CN':
        return zhCN
      default:
        return enUS
    }
  })

  return { language }
}
