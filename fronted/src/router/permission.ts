import type { Router } from 'vue-router'
import { useAuthStoreWithout } from '@/store/modules/auth'
import { useChatStore } from '@/store/modules/chat'

export function setupPageGuard(router: Router) {
  router.beforeEach(async (to, from, next) => {
    const authStore = useAuthStoreWithout()
    if (!authStore.session) {
      try {
        const data = await authStore.getSession()
        if (String(data.auth) === 'false' && authStore.authInfo?.token)
          authStore.removeAuthInfo()
        if (to.path === '/500')
          next({ name: 'Root' })
        else
          next()
      }
      catch (error) {
        // if (to.path !== '/500')
        //   next({ name: '500' })
        // else
        //   next()
        next({ name: 'Login' })
      }
    }
    else {
      // 用户已登录，检查是否需要获取会话数据
      if (to.name === 'Chat' && authStore.authInfo?.token) {
        const chatStore = useChatStore()
        // 如果还没有会话数据，则获取
        if (chatStore.history.length === 0 || (chatStore.history.length === 1 && chatStore.history[0].title === '新对话')) {
          try {
            await chatStore.getUserSessions()
            console.log('路由守卫中加载会话数据完成')
          } catch (error) {
            console.error('路由守卫中加载会话数据失败:', error)
          }
        }
      }
      next()
    }
  })
}
