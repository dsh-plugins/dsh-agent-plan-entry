# Agent 计划模式入口

为 Agent 提供 `enter_plan_mode` 工具，提醒 Agent 除单文件、局部且需求完全明确的小任务外先进入计划模式、只读探索并提交计划；同时把计划相关的提示词从系统提示词搬到最后一条用户消息，避免计划模式切换重写请求前缀。用户仍通过 `exit_plan_mode` 审阅并批准计划。

## 兼容版本

针对 DSH `0.2.2-rc.2` 编写与验证，`engines.dsh` 为 `>=0.2.2-rc.2 <0.3.0`，覆盖 0.2 线后续 rc 与正式版。若后续版本调整了工具、提示词或预设服务契约，需要重新核对。

所有 `@deepseek-ai/*` 依赖都声明为 `peerDependencies`：插件以工作区目录链接安装时，Harness 只把祖先 `package.json` 中声明为 peer 的名字解析到安装副本。`devDependencies` 中的同批包只用于 `tsc` 读取类型。

## 构建

源码为 TypeScript，位于 `src/`；运行时加载 `lib/` 中的编译产物，`lib/` 随仓库提交。

```powershell
npm install --ignore-scripts --legacy-peer-deps
npm run typecheck
npm run build
npm test
```

`src` 内的相对导入写作 `.ts`（`allowImportingTsExtensions`），`tsc` 通过 `rewriteRelativeImportExtensions` 生成 `lib/*.js` 的 `.js` 说明符。`npm test` 用 Node 24+ 的原生类型剥离直接运行 `tests/*.test.ts`，不需要先构建；这些测试只覆盖 `src/guidance.ts` 这类不依赖 Harness 的纯函数。修改源码后必须重新构建，安装过程不会自动构建。

## 本地安装

通过 `plugin_manager` 的 `install_bundle` 安装本目录。`cordis.patch.yml` 只插入一行 Host 入口：

```yaml
- insert:
    - id: agent-plan-entry
      name: '@local/agent-plan-entry'
```

## 行为

- 工具仅在当前 Agent 的预设提供原生 `planMode` 服务时出现，整个会话内可见性不变；已激活时调用只返回当前状态。
- 调用发生在开放轮次内，因此原生服务会把进入请求排队到下一个被接受的步骤；调用结果要求 Agent 把当前步骤剩余部分视为只读。
- 状态、恢复与 fork 全部复用 `@deepseek-ai/dsh-plan-mode`，插件不维护第二份计划状态。

## 上下文位置

以下两段不再进入系统提示词（surface 节点 0），而是每步以一条尾部用户消息送达：

| 段落 | 内容 | 何时送达 |
|---|---|---|
| `agent-plan-entry:complexity-policy` | 本插件的复杂度提醒 | 计划模式未激活时 |
| `plan:policy` | 部署配置的原生计划指引（默认配置在 preset 的 `plan-mode` 行） | 计划模式激活（含等待生效的进入）时 |

送达形状（`source.kind = 'agent-plan-entry'`，`form = 'snapshot'`，`sections` 记录结构化来源）：

```
<system-reminder>
Current plan-mode guidance. This snapshot supersedes earlier plan-mode guidance.

{各段落文本，按原顺序以空行连接}
</system-reminder>
```

指导文本与头部版本逐字一致：插件从组装结果取出该段，用 `renderPrompt` 按原变量插值得到模型可见文本，再搬到最后。因此 `{{model}}` 之类的变量照常生效；段落文本里出现的 `</system-reminder>` 会被转义，避免提前闭合包裹。

切换时只追加、不重写：计划段从无到有时首句写 `Plan mode is now active.`，从有到无时写 `Plan mode is now inactive.`，其余情况写 `Current plan-mode guidance.`，因此进入与退出在预览里也能区分。文本与上一次送达相同则不重复发送；从有到无且 `noticeWhenCleared` 为真时，追加一条 `Plan mode is inactive. … no longer applies …` 通知（`form = 'notice'`）。已送达内容从 Session surface 反向折叠得到，compaction、resume、fork 后自动重建；被压缩遮蔽的指导会在下一次开始时重发。

## 配置

```yaml
- id: agent-plan-entry
  name: '@local/agent-plan-entry'
  config:
    relocatedSections: ['plan:policy']
    noticeWhenCleared: true
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `relocatedSections` | `['plan:policy']` | 额外搬到尾部的系统提示词段名；本插件自己的复杂度段落固定搬运 |
| `noticeWhenCleared` | `true` | 指导从有到无时补一条失效通知 |

未知键或类型错误在加载期报错，不会静默忽略。

## 缓存影响

结论基于 DSH `0.2.2-rc.2` 的 `dsh-agent-loop`、`dsh-llm`、`dsh-llm-pi-ai` 实现。

- **本插件消除的变化点**：进入/退出计划模式时，`plan:policy` 与 `agent-plan-entry:complexity-policy` 的文本不再改变系统提示词，节点 0 的字节保持稳定；指导以新消息追加在对话尾部。
- **仍未消除的变化点**：原生 `exit_plan_mode` 首次进入计划模式时被准入，工具表随之变化。当路由未声明 `toolUpdate`（当前 `openai-responses` 配置即如此），`agent-loop` 会置 `startsSeries` 并重发完整系统提示词与工具声明，这一次仍会重写请求前缀。要彻底消除，需要同时安装按需披露工具定义的插件（例如动态工具加载），或换用支持增量工具更新的路由。
- **不可配置**：`supportsMidConvoSystemMessages` 与 `supportsAdditionalTools` 在 `dsh-llm-pi-ai` 中对所有协议标记为 `withhold`，写入 profile 会在 `resolveModelCompat` 处报错。
- **本插件不额外增加边界**：送达只追加消息；重复内容不发送。

## 适用边界

适合多文件或架构改动、需求含糊、执行顺序不显然以及后果较大的任务；只有单文件、局部且需求完全明确的小任务可以直接执行。计划模式只提供行为指引，不强制限制工具，强制边界仍由沙箱与审批策略负责。

## 已知限制

- **完整段落人设**：若部署注册了 `complete: true` 的人设段落，装配结束时会用它整体替换系统提示词，计划指导无法搬运；插件会告警一次，此时计划指引只由 `exit_plan_mode` 的返回文本承担。
- **只装本插件时**：如上文「缓存影响」所述，工具表变化仍会触发一次完整重发。
- **历史会话**：升级前写入的会话，其计划指导在节点 0；首次组装后节点 0 少掉这两段，会发生一次替换，之后稳定。
