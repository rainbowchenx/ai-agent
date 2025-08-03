import { ss } from '@/utils/storage'
import { t } from '@/locales'

const LOCAL_NAME = 'chatStorage'

export function defaultState(): Chat.ChatState {
  return {
    active: null, // 不使用硬编码UUID，初始状态为null
    usingContext: true,
    history: [], // 初始状态为空数组，等待从后端获取
    chat: [], // 初始状态为空数组，等待从后端获取
  }
}

export function getLocalState(): Chat.ChatState {
  const localState = ss.get(LOCAL_NAME)
  return { ...defaultState(), ...localState }
}

export function setLocalState(state: Chat.ChatState) {
  ss.set(LOCAL_NAME, state)
}
