<script setup lang='ts'>
/**
 * 聊天消息组件
 * 功能：渲染单条聊天消息，包括用户消息和AI回复，提供复制、删除、重新生成等操作
 */

import { computed, ref } from 'vue'
import { NDropdown, useMessage } from 'naive-ui'
import AvatarComponent from './Avatar.vue'
import TextComponent from './Text.vue'
import { SvgIcon } from '@/components/common'
import { useIconRender } from '@/hooks/useIconRender'
import { t } from '@/locales'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { copyToClip } from '@/utils/copy'

// 组件属性定义
interface Props {
  dateTime?: string // 消息时间
  text?: string // 消息内容
  inversion?: boolean // 是否为用户消息（true为用户，false为AI）
  error?: boolean // 是否为错误消息
  loading?: boolean // 是否正在加载
}

// 组件事件定义
interface Emit {
  (ev: 'regenerate'): void // 重新生成回复
  (ev: 'delete'): void // 删除消息
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()

const { isMobile } = useBasicLayout()
const { iconRender } = useIconRender()
const message = useMessage()

// 组件引用
const textRef = ref<HTMLElement>()
const messageRef = ref<HTMLElement>()

// 是否显示原始文本（用于AI回复的代码/文本切换）
const asRawText = ref(props.inversion)

// 右键菜单选项配置
const options = computed(() => {
  const common = [
    {
      label: t('chat.copy'),
      key: 'copyText',
      icon: iconRender({ icon: 'ri:file-copy-2-line' }),
    },
    {
      label: t('common.delete'),
      key: 'delete',
      icon: iconRender({ icon: 'ri:delete-bin-line' }),
    },
  ]

  // 只有AI回复才显示原始文本/渲染文本切换选项
  if (!props.inversion) {
    common.unshift({
      label: asRawText.value ? t('chat.preview') : t('chat.showRawText'),
      key: 'toggleRenderType',
      icon: iconRender({ icon: asRawText.value ? 'ic:outline-code-off' : 'ic:outline-code' }),
    })
  }

  return common
})

/**
 * 处理右键菜单选择事件
 * @param key 菜单项标识
 */
function handleSelect(key: 'copyText' | 'delete' | 'toggleRenderType') {
  switch (key) {
    case 'copyText':
      handleCopy()
      return
    case 'toggleRenderType':
      asRawText.value = !asRawText.value
      return
    case 'delete':
      emit('delete')
  }
}

/**
 * 处理重新生成回复
 * 滚动到当前消息位置并触发重新生成事件
 */
function handleRegenerate() {
  messageRef.value?.scrollIntoView()
  emit('regenerate')
}

/**
 * 复制消息内容到剪贴板
 */
async function handleCopy() {
  try {
    await copyToClip(props.text || '')
    message.success(t('chat.copied'))
  }
  catch {
    message.error(t('chat.copyFailed'))
  }
}
</script>

<template>
  <!-- 消息容器，根据inversion决定布局方向 -->
  <div
    ref="messageRef"
    class="flex w-full mb-6 overflow-hidden"
    :class="[{ 'flex-row-reverse': inversion }]"
  >
    <!-- 头像区域 -->
    <div
      class="flex items-center justify-center flex-shrink-0 h-8 overflow-hidden rounded-full basis-8"
      :class="[inversion ? 'ml-2' : 'mr-2']"
    >
      <AvatarComponent :image="inversion" />
    </div>
    
    <!-- 消息内容区域 -->
    <div class="overflow-hidden text-sm " :class="[inversion ? 'items-end' : 'items-start']">
      <!-- 时间戳 -->
      <p class="text-xs text-[#b4bbc4]" :class="[inversion ? 'text-right' : 'text-left']">
        {{ dateTime }}
      </p>
      
      <!-- 消息内容和操作按钮 -->
      <div
        class="flex items-end gap-1 mt-2"
        :class="[inversion ? 'flex-row-reverse' : 'flex-row']"
      >
        <!-- 消息文本内容 -->
        <TextComponent
          ref="textRef"
          :inversion="inversion"
          :error="error"
          :text="text"
          :loading="loading"
          :as-raw-text="asRawText"
        />
        
        <!-- 操作按钮区域 -->
        <div class="flex flex-col">
          <!-- 重新生成按钮（仅AI回复显示） -->
          <button
            v-if="!inversion"
            class="mb-2 transition text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-300"
            @click="handleRegenerate"
          >
            <SvgIcon icon="ri:restart-line" />
          </button>
          
          <!-- 右键菜单 -->
          <NDropdown
            :trigger="isMobile ? 'click' : 'hover'"
            :placement="!inversion ? 'right' : 'left'"
            :options="options"
            @select="handleSelect"
          >
            <button class="transition text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-200">
              <SvgIcon icon="ri:more-2-fill" />
            </button>
          </NDropdown>
        </div>
      </div>
    </div>
  </div>
</template>
