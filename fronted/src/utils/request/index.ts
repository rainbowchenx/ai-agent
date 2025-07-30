/**
 * HTTP请求封装模块
 * 提供统一的HTTP请求接口，支持所有常用HTTP方法
 */
import type { AxiosProgressEvent, AxiosResponse, GenericAbortSignal } from 'axios'
import request from './axios'
import { useAuthStore } from '@/store'

/**
 * HTTP请求选项接口
 */
export interface HttpOption {
  url: string                                    // 请求URL
  data?: any                                    // 请求数据
  method?: string                               // HTTP方法
  headers?: any                                 // 请求头
  onDownloadProgress?: (progressEvent: AxiosProgressEvent) => void  // 下载进度回调
  signal?: GenericAbortSignal                   // 取消请求信号
  beforeRequest?: () => void                    // 请求前回调
  afterRequest?: () => void                     // 请求后回调
}

/**
 * 统一响应接口
 */
export interface Response<T = any> {
  data: T                                       // 响应数据
  message: string | null                        // 响应消息
  status: string                                // 响应状态
}

/**
 * 通用HTTP请求函数
 * @param options 请求选项
 * @returns Promise<Response<T>>
 */
function http<T = any>(
  { url, data, method, headers, onDownloadProgress, signal, beforeRequest, afterRequest }: HttpOption,
): Promise<Response<T>> {
  /**
   * 成功响应处理器
   * @param res axios响应对象
   * @returns 处理后的响应数据
   */
  const successHandler = (res: AxiosResponse<Response<T>>) => {
    const authStore = useAuthStore()

    // 成功状态或字符串响应
    // if (res.data)
    return res

    // 未授权状态，清除认证信息
    // if (res.data.status === 'Unauthorized') {
    //   authStore.removeAuthInfo()
    //   window.location.reload()
    // }

    // return Promise.reject(res.data)
  }

  /**
   * 失败响应处理器
   * @param error 错误对象
   * @throws Error
   */
  const failHandler = (error: Response<Error>) => {

    afterRequest?.()
    throw new Error(error?.message || '请求失败')
  }

  beforeRequest?.()

  method = method || 'GET'

  const params = Object.assign(typeof data === 'function' ? data() : data ?? {}, {})

  // 根据HTTP方法选择对应的请求方式
  switch (method.toUpperCase()) {
    case 'GET':
      return request.get(url, { params, signal, onDownloadProgress }).then(successHandler, failHandler)
    case 'POST':
      return request.post(url, params, { headers, signal, onDownloadProgress }).then(successHandler, failHandler)
    case 'PUT':
      return request.put(url, params, { headers, signal, onDownloadProgress }).then(successHandler, failHandler)
    case 'DELETE':
      return request.delete(url, { params, headers, signal, onDownloadProgress }).then(successHandler, failHandler)
    case 'PATCH':
      return request.patch(url, params, { headers, signal, onDownloadProgress }).then(successHandler, failHandler)
    default:
      throw new Error(`不支持的HTTP方法: ${method}`)
  }
}




/**
 * GET请求
 * @param options 请求选项
 * @returns Promise<Response<T>>
 */
export function get<T = any>(
  { url, data, method = 'GET', onDownloadProgress, signal, beforeRequest, afterRequest }: HttpOption,
): Promise<Response<T>> {
  return http<T>({
    url,
    method,
    data,
    onDownloadProgress,
    signal,
    beforeRequest,
    afterRequest,
  })
}

/**
 * POST请求
 * @param options 请求选项
 * @returns Promise<Response<T>>
 */
export function post<T = any>(
  { url, data, method = 'POST', headers, onDownloadProgress, signal, beforeRequest, afterRequest }: HttpOption,
): Promise<Response<T>> {
  return http<T>({
    url,
    method,
    data,
    headers,
    onDownloadProgress,
    signal,
    beforeRequest,
    afterRequest,
  })
}

/**
 * PUT请求
 * @param options 请求选项
 * @returns Promise<Response<T>>
 */
export function put<T = any>(
  { url, data, method = 'PUT', headers, onDownloadProgress, signal, beforeRequest, afterRequest }: HttpOption,
): Promise<Response<T>> {
  return http<T>({
    url,
    method,
    data,
    headers,
    onDownloadProgress,
    signal,
    beforeRequest,
    afterRequest,
  })
}

/**
 * DELETE请求
 * @param options 请求选项
 * @returns Promise<Response<T>>
 */
export function del<T = any>(
  { url, data, method = 'DELETE', headers, onDownloadProgress, signal, beforeRequest, afterRequest }: HttpOption,
): Promise<Response<T>> {
  return http<T>({
    url,
    method,
    data,
    headers,
    onDownloadProgress,
    signal,
    beforeRequest,
    afterRequest,
  })
}

/**
 * PATCH请求
 * @param options 请求选项
 * @returns Promise<Response<T>>
 */
export function patch<T = any>(
  { url, data, method = 'PATCH', headers, onDownloadProgress, signal, beforeRequest, afterRequest }: HttpOption,
): Promise<Response<T>> {
  return http<T>({
    url,
    method,
    data,
    headers,
    onDownloadProgress,
    signal,
    beforeRequest,
    afterRequest,
  })
}

// 默认导出POST方法
// export default post
