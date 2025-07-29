/**
 * 认证相关的TypeScript类型定义
 * 与后端接口保持一致的响应数据结构
 */

/**
 * 令牌信息接口
 */
export interface Token {
  access_token: string
  token_type: string
  expires_at: string  // ISO 8601格式的时间字符串
}

/**
 * 注册响应接口
 */
export interface RegisterResponse {
  id: number
  email: string
  token: Token
}

/**
 * 登录响应接口
 */
export interface LoginResponse {
  access_token: string
  token_type: string
  expires_at: string
} 