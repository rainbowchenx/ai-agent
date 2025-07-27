/**
 * Store 主入口文件
 * 负责初始化 Pinia 状态管理器
 */

import type { App } from 'vue'
import { store } from './helper'

/**
 * 注册函数，全局注册store
 * @param app Vue 应用实例
 */
export function setupStore(app: App) {
  app.use(store)
}

export * from './modules'
