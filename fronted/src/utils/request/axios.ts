/**
 * Axios 实例配置和拦截器
 * 提供统一的HTTP请求配置和拦截器处理
 */
import axios, { type AxiosResponse } from 'axios'
import { useAuthStore } from '@/store'

/**
 * 创建axios实例
 * 配置基础URL和默认设置
 */
const service = axios.create({
  baseURL: import.meta.env.VITE_GLOB_API_URL,
  timeout: 10000, // 10秒超时
  headers: {
    'Content-Type': 'application/json',
  },
})

/**
 * 请求拦截器
 * 在请求发送前添加认证token
 */
service.interceptors.request.use(
  (config) => {
    const token = useAuthStore().authInfo?.token.access_token
    if (token)
      config.headers.Authorization = `Bearer ${token}`
    return config
  },
  (error) => {
    // 修复：直接返回Promise.reject(error)，而不是error.response
    return Promise.reject(error)
  },
)

/**
 * 响应拦截器
 * 统一处理响应数据和错误
 */
service.interceptors.response.use(
  (response: AxiosResponse): AxiosResponse => {
    // 状态码200表示成功
    if (response.status === 200)
      return response

    // 其他状态码抛出错误
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  },
  (error) => {
    // 统一错误处理
    if (error.response) {
      // 服务器返回错误状态码
      const { status, data } = error.response
      switch (status) {
        case 401:
          // 未授权，清除认证信息
          const authStore = useAuthStore()
          authStore.removeAuthInfo()
          window.location.reload()
          break
        case 403:
          console.error('权限不足')
          break
        case 404:
          console.error('请求的资源不存在')
          break
        case 500:
          console.error('服务器内部错误')
          break
        default:
          console.error(`请求失败: ${status}`)
      }
    } else if (error.request) {
      // 网络错误
      console.error('网络连接失败')
    } else {
      // 其他错误
      console.error('请求配置错误:', error.message)
    }
    
    return Promise.reject(error)
  },
)

export default service
