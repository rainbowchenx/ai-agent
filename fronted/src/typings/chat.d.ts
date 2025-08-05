/**
 * 聊天相关类型定义
 * 定义聊天功能中使用的所有TypeScript接口和类型
 */
declare namespace Chat {

	/**
	 * 单条聊天消息接口
	 * 表示聊天界面中的一条消息记录
	 */
	interface Chat {
		/** 消息时间戳 */
		dateTime: string
		/** 消息内容文本 */
		text: string
		/** 是否为用户消息（true为用户，false为AI） */
		inversion?: boolean
		/** 是否为错误消息 */
		error?: boolean
		/** 是否正在加载中 */
		loading?: boolean
		/** 对话请求配置选项 */
		conversationOptions?: ConversationRequest | null
		/** 请求选项，包含提示词和配置 */
		requestOptions: { prompt: string; options?: ConversationRequest | null }
	}

	/**
	 * 聊天历史记录接口
	 * 表示一个聊天会话的基本信息
	 */
	interface History {
		/** 会话标题 */
		title: string
		/** 是否处于编辑状态 */
		isEdit: boolean
		/** 会话唯一标识符（支持字符串或数字） */
		uuid: string | number
	}

	/**
	 * 聊天状态接口
	 * 管理整个聊天应用的状态
	 */
	interface ChatState {
		/** 当前活跃的会话ID */
		active: string | number | null
		/** 是否使用上下文（连续对话） */
		usingContext: boolean;
		/** 所有会话历史记录列表 */
		history: History[]
		/** 聊天消息数据，按会话分组 */
		chat: { uuid: string | number; data: Chat[] }[]
	}

	/**
	 * 对话请求接口
	 * 发送给AI的对话请求参数
	 */
	interface ConversationRequest {
		/** 对话ID，用于标识一个完整的对话会话 */
		conversationId?: string
		/** 父消息ID，用于建立消息的层级关系 */
		parentMessageId?: string
	}

	/**
	 * 对话响应接口
	 * AI返回的对话响应数据
	 */
	interface ConversationResponse {
		/** 对话ID */
		conversationId: string
		/** AI响应的详细信息 */
		detail: {
			/** AI生成的选择结果 */
			choices: { 
				/** 完成原因（如：stop, length等） */
				finish_reason: string
				/** 选择索引 */
				index: number
				/** 对数概率信息 */
				logprobs: any
				/** 生成的文本内容 */
				text: string 
			}[]
			/** 响应创建时间戳 */
			created: number
			/** 响应唯一ID */
			id: string
			/** 使用的AI模型名称 */
			model: string
			/** 对象类型 */
			object: string
			/** Token使用统计 */
			usage: { 
				/** 完成token数量 */
				completion_tokens: number
				/** 提示token数量 */
				prompt_tokens: number
				/** 总token数量 */
				total_tokens: number 
			}
		}
		/** 消息ID */
		id: string
		/** 父消息ID */
		parentMessageId: string
		/** 消息角色（user/assistant） */
		role: string
		/** 消息文本内容 */
		text: string
	}
}
