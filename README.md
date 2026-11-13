# Agent 计划模式入口

为 Agent 提供 `enter_plan_mode` 工具，并在系统提示词末尾提醒 Agent：除单文件、局部且需求完全明确的小任务外，必须先进入计划模式、只读探索并提交计划。用户仍通过 `exit_plan_mode` 审阅并批准计划。

## 兼容版本

针对 DSH `0.2.2-rc.2` 编写与验证，`engines.dsh` 为 `^0.2.2-rc.2`，覆盖 0.2 线后续 rc 与正式版。若后续版本调整了工具、提示词或预设服务契约，需要重新核对。

## 构建

源码为 TypeScript，位于 `src/index.ts`；运行时加载 `lib/` 中的编译产物。

```powershell
npm install --ignore-scripts --legacy-peer-deps
npm run build
```

`lib/` 随仓库提交，安装与加载不需要构建工具链。修改源码后必须重新构建，否则运行的是旧产物；安装过程不会自动构建。

## 本地安装

本 bundle 以工作区目录链接方式安装时，运行时依赖从源码目录解析，而不是从 profile 的 `node_modules` 解析。依赖已随 `package.json` 安装到本目录后，通过 `plugin_manager` 的 `install_bundle` 安装。

## 行为

- 工具仅在当前 Agent 的预设提供原生 `planMode` 服务时出现。
- `agent-plan-entry:complexity-policy` 提示词段落位于所有内置系统段落之后；当本步选中的计划状态为激活时（包括已激活与等待生效的进入），该段落不注入，避免与原生计划指引重复。取消计划模式的那一步会恢复注入。
- 工具在该 Agent 的整个会话中持续可见，计划模式切换不会改变工具目录；已激活时调用只返回当前状态。
- 调用发生在开放轮次内，因此原生服务会把进入请求排队到下一个被接受的步骤。
- 调用结果要求 Agent 把当前步骤剩余部分视为只读；下一步在计划模式指引下探索，并最终调用 `exit_plan_mode`。
- 状态、提示词、恢复与 fork 行为完全复用 `@deepseek-ai/dsh-plan-mode`，插件不维护第二份计划状态。

## 工具参数

`reason` 为必填字符串，用于记录使规划变得必要的具体复杂度，例如跨文件影响、架构决策、需求不确定性或较高风险。

## 缓存影响

进入计划模式会重写请求前缀，本节记录该代价的来源与边界，结论基于 DSH `0.2.2-rc.2` 的 `dsh-agent-loop`、`dsh-llm`、`dsh-llm-pi-ai` 实现。

- **变化点**：进入时原生 `plan:policy` 系统段落（顺序 500）从无到有，原生 `exit_plan_mode` 同时进入工具表。两者都由 `@deepseek-ai/dsh-plan-mode` 决定，不由本插件引入。
- **根因**：`agent-loop` 在工具集变化且路由未声明 `toolUpdate` 时置 `startsSeries: true`，开启新的请求序列并重发完整系统提示词与工具声明。当前 `openai-responses` 路由正属此情形。
- **不可配置**：该能力对应 pi-ai 的 `compat.supportsMidConvoSystemMessages` 与 `supportsAdditionalTools`，`dsh-llm-pi-ai` 把所有协议的这两个字段标记为 `withhold`，写入 profile 会在 `resolveModelCompat` 处直接报错。
- **不可遮蔽**：用同名常驻工具抵消工具表变化行不通，`ToolsService.resolve()` 先按作用域遮蔽再按 `when` 过滤，原生 `exit_plan_mode` 注册始终遮蔽外部同名注册。
- **本插件不额外增本**：`agent-plan-entry:complexity-policy` 段落随模式翻转，但原生段落已先改变整段系统提示词，因此不构成额外的缓存边界；保持现状即可。

仅当上游放开这些 compat gate 或改用支持增量工具更新的路由时，本节结论需要重新评估。

## 适用边界

适合多文件或架构改动、需求含糊、执行顺序不显然以及后果较大的任务；只有单文件、局部且需求完全明确的小任务可以直接执行。计划模式只提供行为指引，不强制限制工具，强制边界仍由沙箱与审批策略负责。
