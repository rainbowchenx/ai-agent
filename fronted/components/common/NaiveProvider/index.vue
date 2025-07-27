<script setup lang="ts">
/**
 * Naive UI 全局provider组件,所有其他组件都必须在该组件下才可以使用全局功能
 * 提供全局的对话框、加载条、消息、通知等功能
 */
import { defineComponent, h } from 'vue'
import {
  NDialogProvider,
  NLoadingBarProvider,
  NMessageProvider,
  NNotificationProvider,
  useDialog,
  useLoadingBar,
  useMessage,
  useNotification,
} from 'naive-ui'

/**
 * 注册全局工具函数
 * 将Naive UI的工具函数挂载到window对象上，方便全局调用
 */
function registerNaiveTools() {
  window.$loadingBar = useLoadingBar()    // 全局加载条
  window.$dialog = useDialog()            // 全局对话框
  window.$message = useMessage()          // 全局消息提示
  window.$notification = useNotification() // 全局通知
}

/**
 * Naive UI 内容组件
 * 用于注册全局工具函数
 */
const NaiveProviderContent = defineComponent({
  name: 'NaiveProviderContent',
  setup() {
    registerNaiveTools()
  },
  render() {
    return h('div')
  },
})
</script>

<template>
  <!-- Naive UI 全局提供者嵌套结构 -->
  <NLoadingBarProvider>
    <NDialogProvider>
      <NNotificationProvider>
        <NMessageProvider>
          <!-- 使用插槽传递子组件 -->
          <slot />
          <NaiveProviderContent />
        </NMessageProvider>
      </NNotificationProvider>
    </NDialogProvider>
  </NLoadingBarProvider>
</template>
