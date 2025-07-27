<script setup lang='ts'>
/**
 * SVG图标组件
 * 基于@iconify/vue的图标渲染组件，支持动态图标和属性传递
 */
import { computed, useAttrs } from 'vue'
import { Icon } from '@iconify/vue'

interface Props {
  icon?: string    // 图标名称
}

defineProps<Props>()

const attrs = useAttrs()

/**
 * 绑定属性计算
 * 将传入的class和style属性传递给图标组件
 */
const bindAttrs = computed<{ class: string; style: string }>(() => ({
  class: (attrs.class as string) || '',
  style: (attrs.style as string) || '',
}))
</script>

<template>
  <!-- 图标渲染组件 -->
  <Icon :icon="icon || ''" v-bind="bindAttrs" />
</template>
