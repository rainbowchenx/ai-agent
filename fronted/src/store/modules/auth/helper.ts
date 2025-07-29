import { ss } from '@/utils/storage'

const LOCAL_NAME = 'SECRET_TOKEN'

// 登录返回用户信息
export interface AuthInfo {
  id: number,
  email: string,
  token: Token
}
export interface Token {
  access_token: string,
  token_type: string,
  expires_at: number,
}

export function getAuthInfo(){
  return ss.get(LOCAL_NAME)
}

export function setAuthInfo(authInfo: AuthInfo){
  return ss.set(LOCAL_NAME, authInfo)
}

export function removeAuthInfo(){
  return ss.remove(LOCAL_NAME)
}