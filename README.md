# Wooya — 个人学习 Agent

一个可脱离任何 IDE 运行的本地学习资料 agent：收录资料、双轨回答（模型自答 + 库内对照）、以苏格拉底问答记录学习者的理解输出。数据本地优先，能力可扩展。面向所有自学者，安装即用。

## 核心价值

1. **主权与可扩展**：资料与学习记录留在本地（markdown + JSON，格式开放），未来可自行接云同步；检索策略按资料类型可插拔，学习流程可自定义扩展。
2. **双轨回答**：LLM 给出自己的回答，同时核对库内资料——一致 / 冲突 / 补充分别标注，缺料时指引用户收录。
3. **学习输出沉淀**：agent 以苏格拉底式导师提问，用户逐轮回答，问答记录整段存档（用户回答原话保留，AI 不润色），为反馈修正闭环提供原料。

## 使用（MVP 规划中）

| 命令 / 入口 | 形态 | 行为 |
| --- | --- | --- |
| `wooya` | 交互式会话（默认） | 多轮对话；收录 / 提问 / 学习问答都是会话内意图，支持 `/add` `/sources` `/provider` `/model` `/learn` `/clear`；`/provider` 登记与切换 API 供应商（key 存 `~/.wooya/providers.json`，明文），`/learn <概念>` 进入苏格拉底问答，`/end` 结束并存档 |
| `wooya ask "<问题>"` | 单发 | 双轨回答：模型回答 + 库内对照（带 `sources/...:行号` 引用） |
| `wooya add <url \| repo \| file>` | 单发 | 收录资料进 `sources/`，仓库记录 commit SHA |
| `wooya init` | 单发 | 生成 `.wooya/config.json` |

## 开发

- 技术栈：Node/TS（Node ≥ 20），自建 agent loop，不依赖框架。
- 检索：grep 式检索（优先 ripgrep）+ agentic search；`Retriever` 协议按资料类型可插拔注册。
- LLM：OpenAI-compatible endpoint；provider 在会话内用 `/provider` 登记（key 存 `~/.wooya/providers.json`），不走环境变量。
- Agent 维度取舍（上下文裁剪、错误恢复、观测等）见 spec §4。

## 状态

Spec 已定稿，待进入 Impl。设计决策记录见 spec §9。
