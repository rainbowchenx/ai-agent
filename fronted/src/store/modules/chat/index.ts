/**
 * 聊天状态管理模块
 * 管理聊天会话、消息历史、当前会话等状态
 */

import { defineStore } from 'pinia'
import { defaultState, getLocalState, setLocalState } from './helper'
import { router } from '@/router'
import { t } from '@/locales'

/**
 * 聊天状态 Store
 * 管理聊天相关的所有状态和操作
 */
export const useChatStore = defineStore('chat-store', {
  state: (): Chat.ChatState => getLocalState(),

  getters: {
    /**
     * 获取当前活跃会话的历史记录
     */
    getChatHistoryByCurrentActive(state: Chat.ChatState) {
      const index = state.history.findIndex(item => item.uuid === state.active)
      if (index !== -1)
        return state.history[index]
      return null
    },

    /**
     * 根据UUID获取聊天记录
     * @param uuid 会话UUID
     */
    getChatByUuid(state: Chat.ChatState) {
      return (uuid?: number) => {
        if (uuid)
          return state.chat.find(item => item.uuid === uuid)?.data ?? []
        return state.chat.find(item => item.uuid === state.active)?.data ?? []
      }
    },
  },

  actions: {
    /**
     * 设置是否使用上下文
     * @param context 是否使用上下文
     */
    setUsingContext(context: boolean) {
      this.usingContext = context
      this.recordState()
    },

    /**
     * 添加聊天历史
     * @param history 历史记录
     * @param chatData 聊天数据
     */
    addHistory(history: Chat.History, chatData: Chat.Chat[] = []) {
      this.history.unshift(history)
      this.chat.unshift({ uuid: history.uuid, data: chatData })
      this.active = history.uuid
      this.reloadRoute(history.uuid)
    },

    /**
     * 更新聊天历史
     * @param uuid 会话UUID
     * @param edit 编辑内容
     */
    updateHistory(uuid: number, edit: Partial<Chat.History>) {
      const index = this.history.findIndex(item => item.uuid === uuid)
      if (index !== -1) {
        this.history[index] = { ...this.history[index], ...edit }
        this.recordState()
      }
    },

    /**
     * 删除聊天历史
     * @param index 历史记录索引
     */
    async deleteHistory(index: number) {
      this.history.splice(index, 1)
      this.chat.splice(index, 1)

      if (this.history.length === 0) {
        this.active = null
        this.reloadRoute()
        return
      }

      if (index > 0 && index <= this.history.length) {
        const uuid = this.history[index - 1].uuid
        this.active = uuid
        this.reloadRoute(uuid)
        return
      }

      if (index === 0) {
        if (this.history.length > 0) {
          const uuid = this.history[0].uuid
          this.active = uuid
          this.reloadRoute(uuid)
        }
      }

      if (index > this.history.length) {
        const uuid = this.history[this.history.length - 1].uuid
        this.active = uuid
        this.reloadRoute(uuid)
      }
    },

    /**
     * 设置活跃会话
     * @param uuid 会话UUID
     */
    async setActive(uuid: number) {
      this.active = uuid
      return await this.reloadRoute(uuid)
    },

    /**
     * 根据UUID和索引获取聊天记录
     * @param uuid 会话UUID
     * @param index 消息索引
     */
    getChatByUuidAndIndex(uuid: number, index: number) {
      if (!uuid || uuid === 0) {
        if (this.chat.length)
          return this.chat[0].data[index]
        return null
      }
      const chatIndex = this.chat.findIndex(item => item.uuid === uuid)
      if (chatIndex !== -1)
        return this.chat[chatIndex].data[index]
      return null
    },

    /**
     * 根据UUID添加聊天记录
     * @param uuid 会话UUID
     * @param chat 聊天记录
     */
    addChatByUuid(uuid: number, chat: Chat.Chat) {
      if (!uuid || uuid === 0) {
        if (this.history.length === 0) {
          const uuid = Date.now()
          this.history.push({ uuid, title: chat.text, isEdit: false })
          this.chat.push({ uuid, data: [chat] })
          this.active = uuid
          this.recordState()
        }
        else {
          this.chat[0].data.push(chat)
          if (this.history[0].title === t('chat.newChatTitle'))
            this.history[0].title = chat.text
          this.recordState()
        }
      }

      const index = this.chat.findIndex(item => item.uuid === uuid)
      if (index !== -1) {
        this.chat[index].data.push(chat)
        if (this.history[index].title === t('chat.newChatTitle'))
          this.history[index].title = chat.text
        this.recordState()
      }
    },

    /**
     * 更新聊天记录
     * @param uuid 会话UUID
     * @param index 消息索引
     * @param chat 聊天记录
     */
    updateChatByUuid(uuid: number, index: number, chat: Chat.Chat) {
      if (!uuid || uuid === 0) {
        if (this.chat.length) {
          this.chat[0].data[index] = chat
          this.recordState()
        }
        return
      }

      const chatIndex = this.chat.findIndex(item => item.uuid === uuid)
      if (chatIndex !== -1) {
        this.chat[chatIndex].data[index] = chat
        this.recordState()
      }
    },

    /**
     * 部分更新聊天记录
     * @param uuid 会话UUID
     * @param index 消息索引
     * @param chat 更新内容
     */
    updateChatSomeByUuid(uuid: number, index: number, chat: Partial<Chat.Chat>) {
      if (!uuid || uuid === 0) {
        if (this.chat.length) {
          this.chat[0].data[index] = { ...this.chat[0].data[index], ...chat }
          this.recordState()
        }
        return
      }

      const chatIndex = this.chat.findIndex(item => item.uuid === uuid)
      if (chatIndex !== -1) {
        this.chat[chatIndex].data[index] = { ...this.chat[chatIndex].data[index], ...chat }
        this.recordState()
      }
    },

    /**
     * 删除聊天记录
     * @param uuid 会话UUID
     * @param index 消息索引
     */
    deleteChatByUuid(uuid: number, index: number) {
      if (!uuid || uuid === 0) {
        if (this.chat.length) {
          this.chat[0].data.splice(index, 1)
          this.recordState()
        }
        return
      }

      const chatIndex = this.chat.findIndex(item => item.uuid === uuid)
      if (chatIndex !== -1) {
        this.chat[chatIndex].data.splice(index, 1)
        this.recordState()
      }
    },

    /**
     * 清空聊天记录
     * @param uuid 会话UUID
     */
    clearChatByUuid(uuid: number) {
      if (!uuid || uuid === 0) {
        if (this.chat.length) {
          this.chat[0].data = []
          this.recordState()
        }
        return
      }

      const index = this.chat.findIndex(item => item.uuid === uuid)
      if (index !== -1) {
        this.chat[index].data = []
        this.recordState()
      }
    },

    /**
     * 清空所有历史记录
     */
    clearHistory() {
      this.$state = { ...defaultState() }
      this.recordState()
    },

    /**
     * 重新加载路由
     * @param uuid 会话UUID (可选)
     */
    async reloadRoute(uuid?: number) {
      this.recordState()
      await router.push({ name: 'Chat', params: { uuid } })
    },

    /**
     * 记录当前状态
     */
    recordState() {
      setLocalState(this.$state)
    },
  },
})
