/**
 * 应用状态管理模块
 * 全局存储和管理应用级别的状态，如主题、语言、侧边栏等
 */

import { defineStore } from 'pinia'
import type { AppState, Language, Theme } from './helper'
import { getLocalSetting, setLocalSetting } from './helper'
import { store } from '@/store/helper'

/**
 * 应用状态 Store
 * 管理应用全局配置和状态
 */
export const useAppStore = defineStore('app-store', {
  state: (): AppState => getLocalSetting(),
  actions: {
    /**
     * 设置侧边栏折叠状态
     * @param collapsed 是否折叠
     */
    setSiderCollapsed(collapsed: boolean) {
      this.siderCollapsed = collapsed
      this.recordState()
    },

    /**
     * 设置主题
     * @param theme 主题类型
     */
    setTheme(theme: Theme) {
      this.theme = theme
      this.recordState()
    },

    /**
     * 设置语言
     * @param language 语言类型
     */
    setLanguage(language: Language) {
      if (this.language !== language) {
        this.language = language
        this.recordState()
      }
    },

    /**
     * 记录状态到本地存储
     */
    recordState() {
      setLocalSetting(this.$state)
    },
  },
})

/**
 * 在组件外使用 App Store
 * @returns App Store 实例
 */
export function useAppStoreWithOut() {
  return useAppStore(store)
}
