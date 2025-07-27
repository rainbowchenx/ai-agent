/**
 * 用户状态管理模块
 * 管理用户信息、用户设置等状态
 */

import { defineStore } from 'pinia'
import type { UserInfo, UserState } from './helper'
import { defaultSetting, getLocalState, setLocalState } from './helper'

/**
 * 用户状态 Store
 * 管理用户相关的状态和操作
 */
export const useUserStore = defineStore('user-store', {
  state: (): UserState => getLocalState(),
  actions: {
    /**
     * 更新用户信息
     * @param userInfo 用户信息
     */
    updateUserInfo(userInfo: Partial<UserInfo>) {
      this.userInfo = { ...this.userInfo, ...userInfo }
      this.recordState()
    },

    /**
     * 重置用户信息
     */
    resetUserInfo() {
      this.userInfo = { ...defaultSetting().userInfo }
      this.recordState()
    },

    /**
     * 记录当前状态
     */
    recordState() {
      setLocalState(this.$state)
    },
  },
})
