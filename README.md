# FastAPI LangGraph Agent Template

A production-ready FastAPI template for building AI agent applications with LangGraph integration. This template provides a robust foundation for building scalable, secure, and maintainable AI agent services.

## 🌟 Features

- **Production-Ready Architecture**

  - FastAPI for high-performance async API endpoints
  - LangGraph integration for AI agent workflows

  - Structured logging with environment-specific formatting
  - Rate limiting with configurable rules
  - PostgreSQL for data persistence

- **Security**

  - JWT-based authentication
  - Session management
  - Input sanitization
  - CORS configuration
  - Rate limiting protection

- **Developer Experience**

  - Environment-specific configuration
  - Comprehensive logging system
  - Clear project structure
  - Type hints throughout
  - Easy local development setup

## 🚀 Quick Start

### Prerequisites

- Python 3.13+
- PostgreSQL ([see Database setup](#database-setup))

### Environment Setup

1. Clone the repository:

```bash
git clone <repository-url>
cd <project-directory>
```

2. Create and activate a virtual environment:

```bash
uv sync
```

3. Copy the example environment file:

```bash
cp .env.example .env.[development|staging|production] # e.g. .env.development
```

4. Update the `.env` file with your configuration (see `.env.example` for reference)

### Database setup

1. Create a PostgreSQL database (e.g Supabase or local PostgreSQL)
2. Update the database connection string in your `.env` file:

```bash
POSTGRES_URL="postgresql://:your-db-password@POSTGRES_HOST:POSTGRES_PORT/POSTGRES_DB"
```

- You don't have to create the tables manually, the ORM will handle that for you.But if you faced any issues,please run the `schemas.sql` file to create the tables manually.

### Running the Application

#### Local Development

1. Install dependencies:

```bash
uv sync
```

2. Run the application:

```bash
make [dev|staging|production] # e.g. make dev
```

1. Go to Swagger UI:

```bash
http://localhost:8000/docs
```

## 🔧 Configuration

The application uses a flexible configuration system with environment-specific settings:

- `.env.development`
-

# 知识库功能说明

## 概述

知识库功能允许用户上传和管理文档，这些文档将被处理并存储为向量数据，用于增强 AI 对话的上下文理解能力。

## 功能特性

### 1. 文档上传

- 支持多种文档格式：PDF、Word (.doc/.docx)、TXT、Markdown (.md)
- 拖拽上传或点击选择文件
- 支持文档描述添加
- 实时上传进度显示

### 2. 文档管理

- 文档列表展示
- 搜索和过滤功能
- 文档状态监控（处理中/已完成/失败）
- 文档删除功能

### 3. 文档信息

- 文件名称和描述
- 文件类型和大小
- 上传时间
- 处理状态
- 向量数量统计

## 使用方法

### 访问知识库

1. 在聊天页面左侧边栏找到"知识库"按钮
2. 点击按钮打开知识库管理界面

### 上传文档

1. 点击"上传文档"按钮
2. 选择要上传的文件（支持拖拽）
3. 输入文档描述
4. 点击"上传"按钮

### 管理文档

1. 在文档列表中查看所有已上传的文档
2. 使用搜索框快速查找特定文档
3. 点击删除按钮移除不需要的文档

## 技术实现

### 前端组件

- `KnowledgeStore/index.vue` - 知识库主组件
- `store/modules/knowledge/` - 状态管理
- `api/knowledge.ts` - API 接口封装
- `typings/knowledge.d.ts` - 类型定义

### 国际化支持

- 中文：`locales/zh-CN.ts`
- 英文：`locales/en-US.ts`

### 样式设计

- 采用项目统一的配色方案
- 响应式设计，支持移动端
- 使用 Naive UI 组件库

## 后续开发计划

### 后端集成

- [ ] Chroma 向量数据库集成
- [ ] 文档解析和向量化处理
- [ ] 文档检索 API
- [ ] 向量相似度搜索

### 功能增强

- [ ] 文档预览功能
- [ ] 批量上传
- [ ] 文档分类管理
- [ ] 向量检索结果展示
- [ ] 知识库在对话中的应用

### 性能优化

- [ ] 大文件上传优化
- [ ] 分页加载
- [ ] 缓存机制
- [ ] 异步处理状态更新

## 注意事项

1. 目前前端界面已完成，但后端 API 尚未实现
2. 使用模拟数据进行界面测试
3. 文件上传大小限制需要根据后端配置调整
4. 支持的文档格式可能需要根据后端处理能力调整
