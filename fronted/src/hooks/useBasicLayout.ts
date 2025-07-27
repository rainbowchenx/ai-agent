/**
 * 自定义 hook， 基于vueuse的响应式布局函数，根据屏幕宽度判断是否为移动端，宽度小于sm的为移动端，即640px以下
 */

import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'

/**
 * 基础布局组合式函数
 * @returns 返回移动端检测状态 - boolean
 */
export function useBasicLayout() {
  const breakpoints = useBreakpoints(breakpointsTailwind)
  const isMobile = breakpoints.smaller('sm')

  return { isMobile }
}
