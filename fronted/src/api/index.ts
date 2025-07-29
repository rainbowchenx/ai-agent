/**
 * API接口定义模块
 * 包含与后端API交互的所有接口函数
 */

import type { AxiosProgressEvent, GenericAbortSignal } from 'axios'
import { post } from '@/utils/request'
import { useAuthStore, useSettingStore } from '@/store'
import type { RegisterResponse, LoginResponse } from './auth-types'

/**
 * 发送聊天请求到后端API
 * @param prompt 用户输入的提示词或消息内容
 * @param options 可选的聊天选项
 * @param signal 用于取消请求的AbortSignal
 * @returns 返回聊天响应的Promise
 */
export function fetchChatAPI<T = any>(
  prompt: string,
  options?: { conversationId?: string; parentMessageId?: string },
  signal?: GenericAbortSignal,
) {
  return post<T>({
    url: '/chat',
    data: { prompt, options },
    signal,
  })
}

/**
 * 获取聊天配置信息
 * @returns 返回配置信息的Promise
 */
export function fetchChatConfig<T = any>() {
  return post<T>({
    url: '/config',
  })
}

/**
 * 发送流式聊天请求
 * @param params 请求参数对象
 * @returns 返回流式响应的Promise
 */
export function fetchChatAPIProcess<T = any>(
  params: {
    prompt: string
    options?: { conversationId?: string; parentMessageId?: string }
    signal?: GenericAbortSignal
    onDownloadProgress?: (progressEvent: AxiosProgressEvent) => void },
) {
  const settingStore = useSettingStore()
  const authStore = useAuthStore()

  let data: Record<string, any> = {
    prompt: params.prompt,
    options: params.options,
  }

  // 如果是ChatGPT API模式，添加额外的配置参数
  if (authStore.isChatGPTAPI) {
    data = {
      ...data,
      systemMessage: settingStore.systemMessage,
      temperature: settingStore.temperature,
      top_p: settingStore.top_p,
    }
  }

  return post<T>({
    url: '/chat-process',
    data,
    signal: params.signal,
    onDownloadProgress: params.onDownloadProgress,
  })
}

/**
 * 获取所有的会话
 * @returns 返回会话信息的Promise
 */
export function fetchSession<T>() {
  return post<T>({
    url: '/session',
  })
}

/**
 * 创建新的聊天会话
 * @returns 返回会话信息的Promise
 */
export function fetchCreateSession<T>() {
  return post<T>({
    url: '/auth/session',
  })
}
/**
 * 更新会话名称
 * @param session_id 会话ID
 * @param name 会话名称
 * @returns 返回会话信息的Promise
 */
export function fetchUpdateSession<T>(session_id: string, name: string) {
  return post<T>({
    url: '/auth/session/{session_id}/name',
    data: { session_id, name },
  })
}
/**
 * 验证用户令牌
 * @param token 用户访问令牌
 * @returns 返回验证结果的Promise
 */
export function fetchVerify<T>(token: string) {
  return post<T>({
    url: '/verify',
    data: { token },
  })
}

/**
 * 注册新用户
 * @param email 用户邮箱
 * @param password 用户密码
 * @returns 返回注册结果的Promise
 */
export function fetchRegisterAccount(email: string, password: string) {
  return post<RegisterResponse>({
    url: '/auth/register',
    data: { email, password },
  })
}

/**
 * 登录用户
 * @param email 用户邮箱
 * @param password 用户密码
 * @returns 返回登录结果的Promise
 */
export function fetchLoginAccount<T>(email: string, password: string) {
  return post<T>({
    url: '/auth/login',
    headers:{
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    data: { username: email, password, grant_type: 'password' },
  })
}