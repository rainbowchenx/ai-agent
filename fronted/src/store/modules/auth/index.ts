/**
 * 认证状态管理模块
 * 管理用户认证、会话、令牌等状态
 */

import { defineStore } from 'pinia'
import { getAuthInfo, setAuthInfo, removeAuthInfo } from './helper'
import type { AuthInfo } from './helper'
import { store } from '@/store/helper'
import { fetchSession } from '@/api'

/**
 * 会话响应接口
 */
interface SessionResponse {
  auth: boolean
  model: 'ChatGPTAPI' | 'ChatGPTUnofficialProxyAPI'
}

/**
 * 认证状态接口
 */
export interface AuthState {
  authInfo: AuthInfo | undefined
  session: SessionResponse | null
}

/**
 * 认证状态 Store
 * 管理认证相关的状态和操作
 */
export const useAuthStore = defineStore('auth-store', {
  state: (): AuthState => ({
    authInfo: getAuthInfo(),
    session: null,
  }),

  getters: {
    /**
     * 是否为 ChatGPT API 模式
     */
    isChatGPTAPI(state): boolean {
      return state.session?.model === 'ChatGPTAPI'
    },
  },

  actions: {
    /**
     * 获取会话信息
     * @returns 会话响应数据
     */
    async getSession() {
      try {
        const { data } = await fetchSession<SessionResponse>()
        this.session = { ...data }
        return Promise.resolve(data)
      }
      catch (error) {
        return Promise.reject(error)
      }
    },
    /**
     * 设置认证信息
     * @param authInfo 认证信息
     */
    setAuthInfo(authInfo: AuthInfo) {
      this.authInfo = authInfo
      setAuthInfo(authInfo)
    },
    /**
     * 移除认证信息
     */
    removeAuthInfo() {
      this.authInfo = undefined
      removeAuthInfo()
    }
  },
})

// 导出认证相关store
export function useAuthStoreWithout() {
  return useAuthStore(store)
}
