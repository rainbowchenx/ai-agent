<script setup lang='ts'>
/**
 * 悬停按钮组件
 * 提供带工具提示的按钮功能，支持自定义提示内容和位置
 */
import { computed } from 'vue'
import type { PopoverPlacement } from 'naive-ui'
import { NTooltip } from 'naive-ui'
import Button from './Button.vue'


interface Props {
  tooltip?: string        // 工具提示文本
  placement?: PopoverPlacement  // 提示框位置
}

interface Emit {
  (e: 'click'): void      // 点击事件
}

const props = withDefaults(defineProps<Props>(), {
  tooltip: '',
  placement: 'bottom',
})

const emit = defineEmits<Emit>()

/**
 * 是否显示工具提示
 * 当tooltip有内容时才显示提示框
 */
const showTooltip = computed(() => Boolean(props.tooltip))

function handleClick() {
  emit('click')
}
</script>

<template>
  <!-- 带工具提示的按钮 -->
  <div v-if="showTooltip">
    <NTooltip :placement="placement" trigger="hover">
      <template #trigger>
        <Button @click="handleClick">
          <slot />
        </Button>
      </template>
      {{ tooltip }}
    </NTooltip>
  </div>
  <!-- 普通按钮 -->
  <div v-else>
    <Button @click="handleClick">
      <slot />
    </Button>
  </div>
</template>
