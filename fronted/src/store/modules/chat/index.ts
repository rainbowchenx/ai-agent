/**
 * 聊天状态管理模块
 * 管理聊天会话、消息历史、当前会话等状态
 */

import { defineStore } from 'pinia'
import { defaultState, getLocalState, setLocalState } from './helper'
import { router } from '@/router'
import { t } from '@/locales'
import { fetchDeleteSession, fetchUpdateSession, fetchSession, fetchSessionMessages } from '@/api'

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
     * 初始化聊天store
     * 在应用启动时调用，确保会话数据同步
     */
    async init() {
      // 如果从localStorage恢复的状态中有会话数据，则获取对应的聊天记录
      if (this.history.length > 0 && this.history.some(item => item.title !== '新对话')) {
        try {
          await this.loadAllSessionMessages()
          console.log('初始化时加载会话消息完成')
        } catch (error) {
          console.error('初始化时加载会话消息失败:', error)
        }
      }
    },

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
    async updateHistory(uuid: number, edit: Partial<Chat.History>) {
      const index = this.history.findIndex(item => item.uuid === uuid)
      if (index !== -1) {
        this.history[index] = { ...this.history[index], ...edit }
        this.recordState()
        
        if (edit.isEdit === false) {
          try {
            const res = await fetchUpdateSession(uuid.toString(), this.history[index].title)
            console.log("更新会话名称", res)
          } catch (error) {
            console.error('更新会话名称失败:', error)
          }
        }
      }
    },

    /**
     * 删除聊天历史
     * @param index 历史记录索引
     */
    async deleteHistory(index: number) {
      try{
        const uuid = this.history[index].uuid
        await fetchDeleteSession(uuid.toString())
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
      } catch (error) {
        console.error('删除会话失败:', error)
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

    async getUserSessions() {
      try {
        const res: any = await fetchSession()
        console.log("获取会话", res)
        if (res.status === 200) {
          this.history = res.data.map((item: any) => ({
            uuid: item.session_id,
            title: item.name || t('chat.newChatTitle'),
            isEdit: false
          }))
          
          // 获取每个会话的聊天记录
          await this.loadAllSessionMessages()
        }
      } catch (error) {
        console.error('获取会话失败:', error)
      }
      this.recordState()
    },

    /**
     * 加载所有会话的聊天记录
     */
    async loadAllSessionMessages() {
      try {
        // 为每个会话获取聊天记录
        for (const historyItem of this.history) {
          await this.loadSessionMessages(historyItem.uuid)
        }
      } catch (error) {
        console.error('加载会话消息失败:', error)
      }
    },

    /**
     * 加载指定会话的聊天记录
     * @param sessionId 会话ID
     */
    async loadSessionMessages(sessionId: number) {
      try {
        console.log(`开始获取会话 ${sessionId} 的消息...`)
        const res: any = await fetchSessionMessages(sessionId.toString())
        console.log(`获取会话 ${sessionId} 的消息响应:`, res)
        
        if (res.status === 200 && res.data && res.data.messages) {
          console.log(`会话 ${sessionId} 的消息数量:`, res.data.messages.length)
          
          // 转换后端消息格式为前端格式
          const chatMessages = res.data.messages.map((msg: any) => ({
            dateTime: new Date(msg.timestamp || Date.now()).toLocaleString(),
            text: msg.content,
            inversion: msg.role === 'user', // 用户消息为true，AI消息为false
            error: false,
            loading: false,
            conversationOptions: msg.conversation_id ? {
              conversationId: msg.conversation_id,
              parentMessageId: msg.id
            } : null,
            requestOptions: { prompt: msg.content, options: null },
          }))
          
          console.log(`转换后的消息:`, chatMessages)
          
          // 更新或添加聊天记录
          const chatIndex = this.chat.findIndex(item => item.uuid === sessionId)
          if (chatIndex !== -1) {
            this.chat[chatIndex].data = chatMessages
            console.log(`更新会话 ${sessionId} 的聊天记录，消息数量:`, chatMessages.length)
          } else {
            this.chat.push({ uuid: sessionId, data: chatMessages })
            console.log(`添加会话 ${sessionId} 的聊天记录，消息数量:`, chatMessages.length)
          }
        } else {
          console.log(`会话 ${sessionId} 没有消息或响应格式不正确:`, res)
        }
      } catch (error) {
        console.error(`加载会话 ${sessionId} 消息失败:`, error)
        // 如果获取失败，至少确保该会话在chat数组中有记录
        const chatIndex = this.chat.findIndex(item => item.uuid === sessionId)
        if (chatIndex === -1) {
          this.chat.push({ uuid: sessionId, data: [] })
        }
      }
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
