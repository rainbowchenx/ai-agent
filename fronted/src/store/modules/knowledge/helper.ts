import { ss } from '@/utils/storage'

const LOCAL_NAME = 'knowledgeStorage'

export function defaultState(): Knowledge.KnowledgeState {
  return {
    knowledgeList: [],
    currentKnowledge: null,
  }
}

export function getLocalState(): Knowledge.KnowledgeState {
  const localState = ss.get(LOCAL_NAME)
  return { ...defaultState(), ...localState }
}

export function setLocalState(state: Knowledge.KnowledgeState) {
  ss.set(LOCAL_NAME, state)
} 