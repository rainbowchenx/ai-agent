<script setup lang='ts'>
/**
 * 设置面板组件
 * 提供应用设置的统一入口，包含通用设置、高级设置和关于页面
 */
import { computed, ref } from 'vue'
import { NModal, NTabPane, NTabs } from 'naive-ui'
import General from './General.vue'
import Advanced from './Advanced.vue'
import About from './About.vue'
import { useAuthStore } from '@/store'
import { SvgIcon } from '@/components/common'

/**
 * 组件属性接口
 */
interface Props {
  visible: boolean    // 是否显示设置面板
}

/**
 * 组件事件接口
 */
interface Emit {
  (e: 'update:visible', visible: boolean): void    // 更新显示状态
}

const props = defineProps<Props>()

const emit = defineEmits<Emit>()

const authStore = useAuthStore()

/**
 * 是否为ChatGPT API模式
 * 根据认证状态判断是否显示高级设置
 */
const isChatGPTAPI = computed<boolean>(() => !!authStore.isChatGPTAPI)

/**
 * 当前激活的标签页
 */
const active = ref('General')

/**
 * 显示状态计算属性
 * 支持双向绑定
 */
const show = computed({
  get() {
    return props.visible
  },
  set(visible: boolean) {
    emit('update:visible', visible)
  },
})
</script>

<template>
  <!-- 设置面板模态框 -->
  <NModal v-model:show="show" :auto-focus="false" preset="card" style="width: 95%; max-width: 640px">
    <div>
      <!-- 标签页导航 -->
      <NTabs v-model:value="active" type="line" animated>
        <!-- 通用设置标签页 -->
        <NTabPane name="General" tab="General">
          <template #tab>
            <SvgIcon class="text-lg" icon="ri:file-user-line" />
            <span class="ml-2">{{ $t('setting.general') }}</span>
          </template>
          <div class="min-h-[100px]">
            <General />
          </div>
        </NTabPane>
        <!-- 高级设置标签页（仅ChatGPT API模式显示） -->
        <NTabPane v-if="isChatGPTAPI" name="Advanced" tab="Advanced">
          <template #tab>
            <SvgIcon class="text-lg" icon="ri:equalizer-line" />
            <span class="ml-2">{{ $t('setting.advanced') }}</span>
          </template>
          <div class="min-h-[100px]">
            <Advanced />
          </div>
        </NTabPane>
        <!-- 配置信息标签页 -->
        <NTabPane name="Config" tab="Config">
          <template #tab>
            <SvgIcon class="text-lg" icon="ri:list-settings-line" />
            <span class="ml-2">{{ $t('setting.config') }}</span>
          </template>
          <About />
        </NTabPane>
      </NTabs>
    </div>
  </NModal>
</template>
