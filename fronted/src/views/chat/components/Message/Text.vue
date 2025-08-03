<script lang="ts" setup>
/**
 * 消息文本渲染组件
 * 功能：支持Markdown渲染、代码高亮、数学公式、Mermaid图表等富文本显示
 */

import { computed, onMounted, onUnmounted, onUpdated, ref } from 'vue'
import MarkdownIt from 'markdown-it'
import MdKatex from '@vscode/markdown-it-katex'
import MdLinkAttributes from 'markdown-it-link-attributes'
import MdMermaid from 'mermaid-it-markdown'
import hljs from 'highlight.js'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { t } from '@/locales'
import { copyToClip } from '@/utils/copy'

// 组件属性定义
interface Props {
  inversion?: boolean // 是否为用户消息
  error?: boolean // 是否为错误消息
  text?: string // 消息文本内容
  loading?: boolean // 是否正在加载
  asRawText?: boolean // 是否显示原始文本（不渲染Markdown）
}

const props = defineProps<Props>()
const { isMobile } = useBasicLayout()
const textRef = ref<HTMLElement>()

// 初始化Markdown渲染器，配置代码高亮
const mdi = new MarkdownIt({
  html: false,
  linkify: true,
  highlight(code, language) {
    const validLang = !!(language && hljs.getLanguage(language))
    if (validLang) {
      const lang = language ?? ''
      return highlightBlock(hljs.highlight(code, { language: lang }).value, lang)
    }
    return highlightBlock(hljs.highlightAuto(code).value, '')
  },
})

// 添加Markdown插件：链接属性、数学公式、Mermaid图表
mdi.use(MdLinkAttributes, { attrs: { target: '_blank', rel: 'noopener' } }).use(MdKatex).use(MdMermaid)

// 消息容器样式类
const wrapClass = computed(() => {
  return [
    'text-wrap',
    'min-w-[20px]',
    'rounded-md',
    isMobile.value ? 'p-2' : 'px-3 py-2',
    props.inversion ? 'bg-[#d2f9d1]' : 'bg-[#f4f6f8]', // 用户消息和AI回复的不同背景色
    props.inversion ? 'dark:bg-[#a1dc95]' : 'dark:bg-[#1e1e20]',
    props.inversion ? 'message-request' : 'message-reply',
    { 'text-red-500': props.error },
  ]
})

// 处理后的文本内容
const text = computed(() => {
  const value = props.text ?? ''
  if (!props.asRawText) {
    // 对数学公式进行处理，自动添加 $$ 符号
    const escapedText = escapeBrackets(escapeDollarNumber(value))
    return mdi.render(escapedText)
  }
  return value
})

/**
 * 生成代码块的HTML结构，包含语言标识和复制按钮
 * @param str 代码内容
 * @param lang 编程语言
 * @returns 格式化的代码块HTML
 */
function highlightBlock(str: string, lang?: string) {
  return `<pre class="code-block-wrapper"><div class="code-block-header"><span class="code-block-header__lang">${lang}</span><span class="code-block-header__copy">${t('chat.copyCode')}</span></div><code class="hljs code-block-body ${lang}">${str}</code></pre>`
}

/**
 * 为代码块添加复制功能事件监听
 */
function addCopyEvents() {
  if (textRef.value) {
    const copyBtn = textRef.value.querySelectorAll('.code-block-header__copy')
    copyBtn.forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.parentElement?.nextElementSibling?.textContent
        if (code) {
          copyToClip(code).then(() => {
            btn.textContent = t('chat.copied')
            setTimeout(() => {
              btn.textContent = t('chat.copyCode')
            }, 1000)
          })
        }
      })
    })
  }
}

/**
 * 移除代码块复制事件监听
 */
function removeCopyEvents() {
  if (textRef.value) {
    const copyBtn = textRef.value.querySelectorAll('.code-block-header__copy')
    copyBtn.forEach((btn) => {
      btn.removeEventListener('click', () => { })
    })
  }
}

/**
 * 转义数字前的美元符号，避免与数学公式冲突
 * @param text 原始文本
 * @returns 转义后的文本
 */
function escapeDollarNumber(text: string) {
  let escapedText = ''

  for (let i = 0; i < text.length; i += 1) {
    let char = text[i]
    const nextChar = text[i + 1] || ' '

    if (char === '$' && nextChar >= '0' && nextChar <= '9')
      char = '\\$'

    escapedText += char
  }

  return escapedText
}

/**
 * 处理数学公式的括号转义
 * 将 \[...\] 和 \(...\) 格式转换为 $$...$$ 格式
 * @param text 原始文本
 * @returns 处理后的文本
 */
function escapeBrackets(text: string) {
  const pattern = /(```[\s\S]*?```|`.*?`)|\\\[([\s\S]*?[^\\])\\\]|\\\((.*?)\\\)/g
  return text.replace(pattern, (match, codeBlock, squareBracket, roundBracket) => {
    if (codeBlock)
      return codeBlock
    else if (squareBracket)
      return `$$${squareBracket}$$`
    else if (roundBracket)
      return `$${roundBracket}$`
    return match
  })
}

onMounted(() => {
  addCopyEvents()
})

onUpdated(() => {
  addCopyEvents()
})

onUnmounted(() => {
  removeCopyEvents()
})
</script>

<template>
  <!-- 消息文本容器 -->
  <div class="text-black" :class="wrapClass">
    <div ref="textRef" class="leading-relaxed break-words">
      <!-- AI回复：支持Markdown渲染和原始文本切换 -->
      <div v-if="!inversion">
        <div v-if="!asRawText" class="markdown-body" :class="{ 'markdown-body-generate': loading }" v-html="text" />
        <div v-else class="whitespace-pre-wrap" v-text="text" />
      </div>
      <!-- 用户消息：始终显示原始文本 -->
      <div v-else class="whitespace-pre-wrap" v-text="text" />
    </div>
  </div>
</template>

<style lang="less">
@import url(./style.less);
</style>
