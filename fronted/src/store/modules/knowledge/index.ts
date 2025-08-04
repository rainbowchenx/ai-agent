import { defineStore } from 'pinia'
import { defaultState } from './helper'
import { getLocalState, setLocalState } from './helper'

export const useKnowledgeStore = defineStore('knowledge-store', {
  state: (): Knowledge.KnowledgeState => getLocalState(),
  getters: {
    getKnowledgeList(): Knowledge.KnowledgeItem[] {
      return this.knowledgeList
    },
    getCurrentKnowledge(): Knowledge.KnowledgeItem | null {
      return this.currentKnowledge
    },
  },
  actions: {
    setKnowledgeList(knowledgeList: Knowledge.KnowledgeItem[]) {
      this.knowledgeList = knowledgeList
      this.recordState()
    },
    addKnowledge(knowledge: Knowledge.KnowledgeItem) {
      this.knowledgeList.unshift(knowledge)
      this.recordState()
    },
    updateKnowledge(id: string, knowledge: Partial<Knowledge.KnowledgeItem>) {
      const index = this.knowledgeList.findIndex(item => item.id === id)
      if (index !== -1) {
        this.knowledgeList[index] = { ...this.knowledgeList[index], ...knowledge }
        this.recordState()
      }
    },
    removeKnowledge(id: string) {
      const index = this.knowledgeList.findIndex(item => item.id === id)
      if (index !== -1) {
        this.knowledgeList.splice(index, 1)
        this.recordState()
      }
    },
    setCurrentKnowledge(knowledge: Knowledge.KnowledgeItem | null) {
      this.currentKnowledge = knowledge
      this.recordState()
    },
    clearKnowledgeList() {
      this.knowledgeList = []
      this.currentKnowledge = null
      this.recordState()
    },
    recordState() {
      setLocalState(this.$state)
    },
  },
}) 