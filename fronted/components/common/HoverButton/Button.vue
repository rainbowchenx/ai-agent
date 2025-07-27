<script setup lang='ts'>
/**
 * 基础按钮组件
 * 提供圆形按钮样式，支持点击事件和插槽内容
 */
interface Emit {
  (e: 'click'): void      
}

const emit = defineEmits<Emit>()

// 触发父组件的click事件
function handleClick() {
  emit('click')
}
</script>

<template>
  <!-- 圆形按钮，支持悬停效果 -->
  <button
    class="flex items-center justify-center w-10 h-10 transition rounded-full hover:bg-neutral-100 dark:hover:bg-[#414755]"
    @click="handleClick"
  >
    <slot />
  </button>
</template>
