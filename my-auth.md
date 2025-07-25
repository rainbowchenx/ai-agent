# FastAPI-LangGraph 项目用户注册、登录与鉴权实现梳理

## 1. 主要功能概述

本项目的认证（auth）模块实现了用户注册、登录、JWT 令牌生成与校验、会话管理等功能，保证了用户身份的安全验证和会话隔离。

## 2. 涉及的主要文件

- `app/api/v1/auth.py`：API 路由，处理注册、登录、会话相关接口。
- `app/utils/auth.py`：认证工具，负责 JWT 令牌的生成与校验。
- `app/schemas/auth.py`：Pydantic 数据模型，定义注册、登录、令牌、用户、会话等数据结构。
- `app/models/user.py`、`app/models/session.py`：用户与会话的 ORM 模型。
- `app/services/database.py`：数据库操作服务。
- `app/core/config.py`：全局配置，含 JWT 密钥、算法等。

## 3. 注册流程

1. **接口**：`POST /api/v1/register`
2. **参数**：`email`（邮箱）、`password`（密码，需强度校验）
3. **流程**：
   - 邮箱、密码数据清洗与强度校验（正则）
   - 检查邮箱是否已注册
   - 密码加密存储（`User.hash_password`）
   - 创建用户，生成 JWT 访问令牌
   - 返回用户信息和令牌
4. **安全点**：
   - 密码强度校验（大写、小写、数字、特殊字符）
   - 密码加密存储
   - 邮箱唯一性校验

## 4. 登录流程

1. **接口**：`POST /api/v1/login`
2. **参数**：`username`（邮箱）、`password`（密码）、`grant_type`（必须为 password）
3. **流程**：
   - 数据清洗
   - 检查授权类型
   - 查询用户并校验密码
   - 生成 JWT 访问令牌
   - 返回令牌信息
4. **安全点**：
   - 密码校验失败不暴露具体原因
   - 令牌只通过 HTTPS 传输

## 5. JWT 令牌生成与校验

- **生成**：
  - `create_access_token(thread_id, expires_delta)`
  - 载荷包含`sub`（用户/会话 ID）、`exp`（过期时间）、`iat`（签发时间）、`jti`（唯一标识）
  - 使用`settings.JWT_SECRET_KEY`和`settings.JWT_ALGORITHM`签名
- **校验**：
  - `verify_token(token)`
  - 校验格式、签名、过期时间，提取`sub`作为用户/会话 ID
  - 校验失败抛出异常或返回 None

## 6. 会话管理

- **创建会话**：`POST /api/v1/session`，为用户生成唯一会话 ID，存储于数据库，返回会话令牌
- **获取/更新/删除会话**：均需令牌校验，确保操作人是会话所有者

## 7. 依赖注入与安全

- 路由依赖`Depends(security)`自动提取并校验 JWT
- 通过`get_current_user`、`get_current_session`实现用户/会话身份注入
- 所有敏感操作均需鉴权

## 8. 速率限制

- 通过`limiter.limit`装饰器，结合配置文件动态设置各接口速率限制，防止暴力破解

## 9. 关键安全实践

- 所有输入均做数据清洗和格式校验
- 密码加密存储，绝不明文
- JWT 密钥、算法、过期时间等通过环境变量集中管理
- 认证失败返回标准 HTTP 错误码和信息

## 10. 典型调用链

- 注册/登录 → 生成 JWT → 客户端持有 → 后续请求带 Authorization 头 → 服务端依赖注入校验 → 获取用户/会话身份 → 业务处理

---

如需扩展第三方登录、双因子认证、OAuth 等，可在此基础上增加相应逻辑和数据结构。
