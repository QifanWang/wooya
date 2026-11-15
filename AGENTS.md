# AGENTS.md — Wooya 开发约定

- 产品定位、用户故事与验收标准见 `docs/spec/mvp-spec.md`；改行为先对照 spec，验收标准是回归底线。
- Node ≥ 20，纯 ESM（相对导入带 `.js` 后缀）；agent loop 与工具层零框架；运行时依赖仅限基础设施类库（LLM 客户端 openai-node），HTML 转换等简易实现允许后续引依赖替换。
- 工具签名统一「JSON in / JSON out」，为将来子进程化与多语言 tool 留口；新增资料类型检索按 `Retriever` 思路注册实现，不改框架。
- `sources/`、`outputs/`、`.wooya/` 是运行期数据，不提交进仓库、不写死进测试。
- `~/.wooya/providers.json` 存有明文 API key（MVP 决策，二期接系统凭证）；任何输出、日志、示例中不得出现完整 key。
- 系统提示词在 `src/agent/prompts.ts`：默认双轨回答与苏格拉底导师两种形态；改措辞需同步 spec 中的引用格式与边界约定。
- 构建 `npm run build`；本地调试 `npm run dev -- <参数>`；运行日志在资料目录 `.wooya/agent.log`。
