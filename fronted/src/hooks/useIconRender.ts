import { h } from 'vue'
import { SvgIcon } from '@/components/common'

/**
 * 图标渲染hook， 传入color、size和icon，返回图标渲染函数
 * @returns 返回图标渲染函数
 */
export const useIconRender = () => {
  interface IconConfig {
    icon?: string
    color?: string
    fontSize?: number
  }

  interface IconStyle {
    color?: string
    fontSize?: string
  }

  /**
   * 图标渲染函数
   * @param config 图标配置对象
   * @returns 返回渲染的图标组件
   */
  const iconRender = (config: IconConfig) => {
    const { color, fontSize, icon } = config

    const style: IconStyle = {}

    if (color)
      style.color = color

    if (fontSize)
      style.fontSize = `${fontSize}px`

    if (!icon)
      window.console.warn('iconRender: icon is required')
    // 使用h函数渲染图标组件，传入icon和style 
    return () => h(SvgIcon, { icon, style })
  }

  return {
    iconRender,
  }
}
