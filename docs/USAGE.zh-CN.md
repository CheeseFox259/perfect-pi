# Perfect Pi 使用指南

Perfect Pi 是一套运行在 Pi 上的全栈工程工作流配置。它把需求澄清、架构分析、实现、调试、代码审查、浏览器验证、发布检查和跨会话交接组织成一条可恢复的链路。

本文按日常使用顺序编写。默认假设：

- 已安装 Pi `1.0.2`（与 `manifest.json` 中的 `piVersion` 一致）。
- 当前仓库是 `/Users/superhacker/perfect-pi`，实际使用时替换为你的路径。
- Node.js、Git 和 Pi 已在 `PATH` 中。

SoL-Pi 已作为受管 Git package 深度接入：默认启用受 guardrails 保护的融合验证、精确观察召回，以及你授权的 `cpa/gemini-3.8-flash-high` 日志 reducer；在线压缩默认关闭，可在可信项目中开启。使用 `/sol-pi` 查看有效配置。日志外发边界、20 次 session 请求上限、项目覆盖和回滚方式见 [SoL-Pi 接入说明](sol-pi.md)。

## 1. 安装与同步

进入 Perfect Pi 仓库：

```bash
cd /Users/superhacker/perfect-pi
```

先查看同步计划：

```bash
node setup.mjs --dry-run
```

执行同步：

```bash
node setup.mjs
node doctor.mjs
```

同步内容包括：

- `~/.pi/agent/AGENTS.md`
- 全局 extensions、prompts 和 agents
- Pi skills
- manifest 中声明的 npm packages
- Pi settings 中的主题、thinking level、compaction 和 skill visibility

同步会保留用户自己的 provider、model、credential、session 和未由 Perfect Pi 管理的 package。完成后重启 Pi，或在当前 Pi 会话执行：

```text
/reload
```

### 已有旧 skill 文件时

如果 `~/.pi/agent/skills/<name>` 中已经存在一个实体目录，而不是 Perfect Pi 管理的 symlink，安装器默认拒绝覆盖。先预览：

```bash
node setup.mjs --dry-run --adopt-overrides
```

确认备份和接管范围后再执行：

```bash
node setup.mjs --adopt-overrides
```

只有 `components.json` 中登记为 override 的 skill 可以被接管。原文件会备份到：

```text
~/.pi/agent/.perfect-pi-backups/<timestamp>-<pid>/
```

不要使用 `--adopt-overrides` 绕过无关文件保护。用户自己创建的 symlink、AGENTS.md、prompt 或 extension 仍会被拒绝覆盖。

### 隔离测试安装

只测试配置同步，不安装 npm package：

```bash
node setup.mjs --skip-package-install
```

只测试本地资源，不安装 upstream skill：

```bash
node setup.mjs --skip-skill-install
```

跳过安装不会伪造成功状态。被跳过的 source pin 会保留旧值，`doctor` 会报告 `DRIFTED`，下一次普通同步仍会重试。

## 2. 启动 Pi

在目标项目目录启动 Pi，而不是在 Perfect Pi 仓库中工作：

```bash
cd /path/to/your-project
pi
```

使用指定模型启动：

```bash
pi --model cpa/gemini-3.8-flash-high --thinking high
```

也可以在 Perfect Pi command palette 中切换 model 和 thinking level。当前默认设置是：

- thinking level：`high`
- TUI：fullscreen
- compaction：开启
- compaction reserve：`16384`
- recent context：`20000`

## 3. Command Palette

在交互式 Pi 中按：

```text
Ctrl+Shift+P
```

或者输入：

```text
/palette
```

主要入口：

| 入口 | 用途 |
| --- | --- |
| Route | 判断下一步工作流，只给建议，不自动执行 |
| Grill | 通过 TUI questionnaire 逐轮澄清设计和需求 |
| Spec | 把当前会话整理成持久 spec |
| Tickets | 把 spec 拆成带阻塞关系的垂直切片 |
| Implement spec | 执行已批准的 ticket graph |
| Maintain | 检查 upstream 更新和本地 override |
| Verify | 运行产品级验证 |
| UI check | 启动应用并验证浏览器路径 |
| Release check | 检查测试、构建、迁移和发布条件 |
| Code review | 审查工作树、提交范围或当前配置快照 |
| Context | 查看当前上下文状态 |
| Model | 切换模型 |
| Thinking | 调整 thinking budget |
| Tools | 手动启用或禁用工具 |
| Settings | 打开配置子菜单（Pi settings、Compaction Model、MCP Key、MiniMax Setup、MCP Servers、CCStyle、Tools） |

按 `Esc` 取消不会发送半成品请求。Spec、Tickets 和 Implement spec 的空输入表示“使用当前会话内容”。

## 4. 推荐的日常工作流

### 4.1 小型明确修改

适用于 typo、单文件小修复、已明确的局部变更：

```text
/skill:route 修复登录按钮的文案拼写错误
```

如果返回：

```text
Route: direct
```

可以直接执行修改。也可以明确告诉 Pi：

```text
按已确认的方向直接实现这个小修改，并运行相关测试。
```

### 4.2 需求不清楚

```text
/skill:route 增加团队邀请功能，但权限、过期时间和通知方式还没有决定
```

通常会返回 `grill-with-docs`。直接启动：

```text
/skill:grill-with-docs 增加团队邀请功能，但权限、过期时间和通知方式还没有决定
```

在交互式 TUI 中，问题通过 `questionnaire` 或 `question` 显示。推荐选项可以直接回车，按 `e` 可以修改或补充答案，也可以选择自定义输入。

Grilling 的原则：

- Pi 负责读取代码、文档和环境事实。
- 用户决定产品行为、接口边界和取舍。
- 取消或未回答不等于批准。
- 已经确认的决定在本次会话中不会重复询问。

### 4.3 普通 bug 或回归

```text
/skill:diagnosing-bugs 保存按钮偶发抛出 TypeError，先建立一个能稳定复现问题的测试
```

这个流程会优先建立红色反馈环，再复现、最小化、提出可证伪假设、修复并加入回归测试。不要只让 Pi“猜原因”；要求它先运行能捕获用户实际症状的命令或测试。

### 4.4 需要持久化的中型工作

如果决定已经确定，但不会在当前会话完成：

```text
/skill:to-spec
```

如果项目还没有 tracker 配置，先执行：

```text
/skill:setup-matt-pocock-skills
```

默认推荐 local Markdown tracker。配置完成后，spec 位于：

```text
.scratch/<feature>/spec.md
```

spec 应包含：

- Problem and goal
- Agreed decisions
- Acceptance criteria
- Testing decision
- Out of scope
- Open questions

有未解决的实现阻塞问题时，状态不能标记为 `ready-for-agent`。

### 4.5 把 spec 拆成 ticket graph

```text
/skill:to-tickets .scratch/team-invites/spec.md
```

Pi 会先提出 ticket 草案，等待你确认粒度和阻塞边，再发布文件：

```text
.scratch/team-invites/issues/01-<slug>.md
.scratch/team-invites/issues/02-<slug>.md
```

每个 implementation ticket 使用以下状态：

```text
Triage: ready-for-agent
Execution: open
Claimed by: none
Branch: none
Blocked by: none
Verified commit: none
Last attempt: none
```

`Triage` 表示是否准备好交给 agent；`Execution` 表示实现进度。不要把两者混用。`complete` 只有在集成分支验证通过并记录 `Verified commit` 后才能使用。

### 4.6 执行已批准的 ticket graph

```text
/skill:implement-spec .scratch/team-invites/spec.md
```

Pi 会：

1. 读取 spec、ticket 和 tracker contract。
2. 检查缺失边、循环依赖、非法状态和旧 claim。
3. 创建 integration branch。
4. 为 frontier ticket 写入 claim 状态。
5. 为每个 ticket 创建独立 Git worktree。
6. 使用 blocking `subagent`（内置快速无头模式）或 **Tmux 多会话并行分发与实时观测**。
7. 在 integration branch 检查、合并和验证。
8. 只有集成验证成功后才写 `Execution: complete`。
9. 对最终 committed diff 执行 code review。
10. 只清理已经合并且验证成功的 worktree。

### 4.7 使用 tmux 进行多会话并行分发与实时观测

当需要对多个 ticket 进行直观的可视化监控、随时交互审查运行过程时，可以使用 tmux 观测与分发体系：

#### 自动分发与会话开启

通过扩展命令或 CLI 启动：

```bash
# 自动检测当前前沿 ticket、创建 worktree、开启 tmux session 并分发任务
node scripts/tmux-tickets.mjs dispatch --feature team-invites --wait
```

或者在 Pi 会话内：
- 使用工具 `tmux_tickets` (`action: "dispatch", feature: "team-invites", wait: true`)
- 或在命令面板（`Ctrl+Shift+P`）选择 `Tmux tickets`

Supervisor 会执行：
1. 自动计算 `.scratch/<feature>/issues/` 中所有无依赖阻塞的 `open` ticket；
2. 为每个 ticket 建立分支与独立 Git worktree（`../<repo>-<NN>-<slug>`）；
3. 建立专用 tmux 会话 `pi-spec-<feature>`；
4. **窗口 0 (dashboard)**：启动彩色 ASCII 实时观测看板；
5. **窗口 1..N (worker)**：在对应的 worktree 中分别拉起一个独立的 Pi session（严格执行 `cpa/gemini-3.8-flash-high:high` 安全模型策略）；
6. 每个窗口独立运行测试并生成提交，日志持久化在 `.scratch/<feature>/runs/<run-id>/<NN>/worker.log`；
7. 运行完成后保留窗口便于用户翻阅终端日志，并向父级返回验证的 commit SHA。

#### 观测机制与界面

随时接入 tmux 会话查看直观看板与各代理执行过程：

```bash
tmux attach -t pi-spec-team-invites
```

**看板界面示例**：
```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ PERFECT PI TMUX TICKET DASHBOARD                                            │
│ Session: pi-spec-team-invites  Branch: feat/invites  Spec: spec.md          │
├─────────────────────────────────────────────────────────────────────────────┤
│ Status: 1 Running | 1 Succeeded | 0 Failed | Total: 2                       │
├─────────────────────────────────────────────────────────────────────────────┤
│ ID  Title                     Status        Elapsed   Commit     Window     │
│ 01  Setup invite model        [SUCCEEDED]   42s       a1b2c3d    Win 1      │
│ 02  Invite email notifications[RUNNING]     15s       ......     Win 2      │
├─────────────────────────────────────────────────────────────────────────────┤
│ Recent Activity (Live Tail):                                                │
│   [02] Running test suite: test/email.test.ts (2 passed)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ Tmux Controls:                                                              │
│   [Ctrl-b n] Next Window  |  [Ctrl-b p] Prev Window  |  [Ctrl-b <N>] Jump   │
│   [Ctrl-b d] Detach tmux  |  Press q here to quit dashboard                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 状态查询与生命周期命令

```text
/tmux-tickets status team-invites       # 查看当前或最近一次运行的 tickets 状态
/tmux-tickets frontier team-invites     # 查看当前满足前沿条件的准备就绪 ticket
/tmux-tickets kill team-invites         # 结束当前特性的 tmux 会话
```

CLI 等效命令：

```bash
node scripts/tmux-tickets.mjs status --feature team-invites
node scripts/tmux-tickets.mjs frontier --feature team-invites
node scripts/tmux-tickets.mjs kill --feature team-invites
```

Pi 的 `subagent` 是阻塞调用。只有 `research` 是真正的后台研究；实现工作不会伪装成 detached background job。

### 4.8 原型与视觉概念探索 (Prototype)

当需要为设计或架构决策建立快速验证物时使用：

```text
/skill:prototype
```

流程会自动根据问题切入两个子分支：
- **逻辑/状态原型 (LOGIC)**：单文件 HTML，带自由调试按钮和分步导引，便于验证复杂状态机；
- **界面原型 (UI)**：同一路由下的多套结构性变体（默认 3 套），通过屏幕底部浮动条快捷切换（`?variant=`）。

#### 无需生图 API 的人机协同生图 (Web Image Handoff)

UI 原型阶段如需高保真概念图辅助设计：
1. **Pi 负责完整设计构思**：输出包含目标视口、功能分区、字体层次、配色约束和负向提示词的完整提示词，不因为人机交接而简化或改写。
2. **交互面板挂起等待 (`image_handoff`)**：Pi 弹出提示词面板并保持等待，用户可直接复制提示词前往 ChatGPT / Midjourney 等网页生成图片。
3. **视觉附件回流**：用户在同一交互面板中选择 **Import Clipboard Image**（自动通过受管脚本提取剪贴板 PNG）或 **Import Image File**（输入本地路径）；图片将作为多模态视觉附件进入上下文，驱动后续代码编写。
4. **验证标记隔离**：仅在显式工作流测试时允许加入测试识别标记（如右上角小圆点），真实业务设计提示词不添加测试标记。

## 5. Code Review

### 工作树审查

实现前已经存在未提交改动时，使用：

```text
/skill:code-review
```

并告诉 Pi：

```text
使用 working-tree mode。基线是 <starting-sha>。包含 staged、unstaged 和本次新增的 untracked 文件；把已有改动单独列出。
```

Working-tree review 会覆盖：

- staged changes
- unstaged changes
- task-owned untracked files
- 已存在的 pre-existing changes

### 已提交范围审查

```text
/skill:code-review HEAD~5
```

或者提供分支、tag、commit SHA。Pi 会明确记录 baseline 和 tip，不会把空 diff 当成通过。

### 当前配置快照审查

```text
/skill:code-review 当前完整配置快照
```

这会使用 snapshot/current-tree audit。它是当前状态审查，不会虚构 Git 历史。

Code review 始终分为两个独立轴：

- Standards：仓库规范和 Fowler smell baseline。
- Spec：需求、验收标准和实际行为是否一致。

## 6. 验证产品行为

完成实现后：

```text
/verify
```

或者：

```text
/verify checkout flow
```

验证分为三个等级：

- Tier 0：直接查询或小范围变更，跑便宜的相关检查。
- Tier 1：普通 bug 或 feature，运行测试、typecheck、build、LSP 或 code review。
- Tier 2：UI、auth、支付、关键流程、重大重构或 release candidate，启动真实应用并使用 browser 检查 console/network。

验证报告必须明确区分：

```text
Verified
Not run
Blocked
Not applicable
```

不要把“没有运行”写成“通过”。

常用快捷入口：

```text
/ui-check 登录流程
/release-check
```

需要长时间运行的 dev server 或 watcher 时，让 Pi 使用 `process`，不要手动在 shell 中用 `&`、`nohup` 或 `setsid`。

## 7. 按需启用工具

新会话默认只加载核心工具和 `subagent`，减少首轮 context。需要额外能力时，让 Pi 调用 `capabilities`，例如：

```text
启用 browser capability，然后验证当前应用的登录页面。
```

支持的 capability：

| Capability | 对应的工具与能力 |
| --- | --- |
| `code` | 原生 `codemode`：支持多工具并行调用与大规模结果过滤 |
| `web` | `web_search`、`source_check`、`fetch_content`、`get_search_content` |
| `browser` | `agent_browser`、browser automation 和高级浏览器工具 |
| `mcp` | 原生 `codemode`、`tool_search` 及已连接服务器的 resource 工具 |
| `lsp` | diagnostics 和 source fixes |
| `process` | dev server、watcher、日志和进程控制 |
| `research` | 后台研究并写入 Markdown findings |

也可以手动输入：

```text
/tools
```

注意：
- capability activation 不会自动获得生产写入权限。
- `--tools`、`--exclude-tools` 等显式 CLI 限制优先级最高。
- capability 启用后，下一次模型请求才能稳定看到新增 tool schema。
- 工具输出采用原生 `structuredContent`，便于代码模式精确消费。

## 8. 自定义全局压缩模型与 SoL-Pi 生命周期保障

### 独立全局压缩模型 (Compaction Model)

Perfect Pi 支持为上下文压缩配置专用模型，默认使用 `cpa/gemini-3.8-flash-high`：
- **统一拦截**：统一覆盖手动 `/compact`、达到阈值的容量压缩 (`threshold`)、上下文超限溢出恢复 (`overflow`) 以及 SoL-Pi 在线压缩 (`OCC`)。
- **保护当前会话模型**：压缩过程不改变正在进行的主对话模型与 thinking budget。
- **平滑回退**：当配置的压缩模型不可用、无凭据或网络报错时，发出警告并自动回退到当前主对话模型；若为用户主动按 `Esc` 取消，则直接中止，绝不发起意外回退请求。
- **设置入口**：
  ```text
  /compaction-model                                    # 交互式选择已授权模型
  /compaction-model cpa/gemini-3.8-flash-high           # 设定指定路由
  /compaction-model status                             # 查看当前生效的压缩模型
  ```
  在命令面板中亦可通过 `Ctrl+Shift+P -> Settings -> Compaction Model` 打开。配置持久化在全局 `settings.json` 的 `perfectPiCompaction` 中，项目配置无法覆盖，后续环境同步会自动保留用户偏好。

### SoL-Pi 诊断日志授权与生命周期防死锁

SoL-Pi 日志 reducer 采用会话级原子授权机制：
- 仅在真正需要远程调用时请求授权，短命令或无诊断输出绝不弹窗打扰；
- 并行工具调用共享同一个带超时（60s）和可取消的确认选择框，按 `Esc` 或超时视为“未决定”而非拒绝，彻底杜绝选择器孤儿导致的死锁；
- 授权决策严格按 `sessionId` + `route` 隔离，fork 分支与新会话绝不越权继承；
- 远程调用前预先占位记录 attempt，即使网络异常失败也严格消耗 20 次预算上限，保障会话安全边界。

## 9. MCP 协议接入与 MiniMax 私有凭据管理

### MiniMax Coding Plan MCP

通过官方 stdio 服务接入 MiniMax 网络搜索与图片理解能力：
- 官方入口：`uvx minimax-coding-plan-mcp -y`
- 暴露工具：`mcp__MiniMax__web_search`、`mcp__MiniMax__understand_image`

### 私密凭据录入与安全存储 (`/mcp-key` & `/mcp-setup`)

为了杜绝 API Key 被意外提交到 Git、写入日志或传入命令参数，Perfect Pi 提供了私密遮蔽录入机制：
1. **首次配置**：
   ```text
   /mcp-setup
   ```
   选择服务区域后，在遮蔽弹窗中输入 Key。
2. **Key 更新与管理**：
   ```text
   /mcp-key MiniMax
   ```
3. **安全存储机制**：
   - Key 仅保存在 `~/.pi/agent/mcp-private/secrets.json`，目录权限严格锁定为 `0700`，文件权限锁定为 `0600`。
   - `mcp.json` 中配置的 stdio 包装脚本 (`mcp-launch.mjs`) 仅在拉起子进程时将 Key 注入其环境变量，并对子进程的标准输出/错误流进行流式脱敏，参数中绝不含有 Key。
   - 包装器退出时自动清理子进程组，杜绝后台僵尸进程。

### 受信任项目的 MCP 覆盖 (`/mcp-project`)

项目可在 `.pi/mcp.json` 中配置只读覆盖（仅允许修改 `enabled` 和 `exposure`）：
```text
/mcp-project MiniMax on codemode       # 仅在代码模式中搜索调用（推荐）
/mcp-project MiniMax on deferred       # 通过 tool_search 延迟发现
/mcp-project MiniMax off hidden        # 在当前项目中禁用
```
项目配置文件内绝不包含任何全局凭据。未受信任的项目无法写入或生效该覆盖。

## 10. Subagent 模型控制

Perfect Pi 在 `subagent` 和 `research` 工具执行前检查模型：

- 默认模型：`cpa/gemini-3.8-flash-high`
- 默认 thinking：`high`
- 不带模型参数时，不继承父会话的昂贵模型，而是注入默认模型。
- 模型请求不在 allowlist 时会被阻止；模型不能自行授权。
- 用户可以在当前会话明确授权：

```text
/subagent-model allow hikari/gpt-6-astra
```

查看当前策略：

```text
/subagent-model
```

撤销一个授权：

```text
/subagent-model revoke hikari/gpt-6-astra
```

恢复默认状态：

```text
/subagent-model reset
```

授权只作用于当前 Pi 会话。它不会写入 provider credentials，也不会修改全局模型默认值。若想让子代理使用另一个模型，应由用户先执行授权命令，再让 Pi 重试被阻止的调用。

## 11. Research、浏览器和开发服务器

### Web research

```text
/skill:research 研究 Stripe webhook 重试语义，使用官方文档并保存带引用的 findings
```

研究结果应写入明确的 Markdown 文件。依赖该事实的设计问题，要在读取 findings 后再继续。

### Browser verification

```text
/ui-check 验证注册、登录和退出流程，并检查 console 与失败请求
```

浏览器检查应覆盖需要证明的路径，以及 loading、empty、error、success 和 responsive 状态。没有真实浏览器证据时，不要声称完成了视觉验证。

### Dev server

让 Pi 使用 `process` 启动和管理服务。典型操作：

```text
启动项目的 dev server，等待 ready 信号，然后使用 browser 检查首页
```

Pi 应在启动前检查是否已有同名进程，并关注 `ready`、`listening`、`EADDRINUSE` 和 `Error:` 等日志信号。

## 12. Upstream skill 维护

检查 upstream：

```bash
node reconcile.mjs status
```

无网络时：

```bash
node reconcile.mjs status --offline --json
```

查看某个 override 和其精确 base 的差异：

```bash
node reconcile.mjs diff grilling --offline
```

验证真实 incoming commit 的 three-way merge：

```bash
node reconcile.mjs 3way-test grilling --upstream-ref <commit> --offline
```

维护流程使用三个 ref：

- `components.json` 的 `upstreams[source].pinnedRef`：source-wide pinned upstream。
- `manifest.json` 的 `skills[].ref`：实际安装使用的 source ref。
- `components.json` 中 override 的 `baseRef`：该本地适配的 base。

不要把 manifest 的 `skills[].ref` 写成 `pinnedRef`，也不要用 self-merge 验证升级。

确认升级策略后，才执行：

```text
/skill:maintain
```

维护 skill 会先报告更新，再等待选择 three-way merge、upstream-only 或查看细节。外部 push、PR 和远程 issue 写入仍需明确授权。

## 13. Pi 运行时持续兼容与升级机制 (CI Canary)

Perfect Pi 将 Pi 的长期版本更新作为持续兼容性工程管理：
- **版本发现**：
  ```bash
  node scripts/check-pi-updates.mjs
  ```
  查询 npm 官方发布的最新稳定版本，分类区分 patch / minor / major。仅提供决策依据，绝不自动修改本地版本锁定。
- **运行时 API 契约与全量扩展加载验证**：
  ```bash
  node scripts/check-pi-compatibility.mjs
  ```
  验证当前宿主 Pi 的公共 API、`FileSettingsStorage.withLock` 内部存储桥接，以及所有受管 TypeScript 扩展的加载情况。版本漂移与 API 兼容性解耦报告。
- **SoL-Pi 契约验证**：
  ```bash
  node scripts/check-sol-pi-contract.mjs --json
  ```
- **每日只读 CI Canary** (`.github/workflows/pi-compatibility.yml`)：
  在独立 GitHub Actions Runner 中以矩阵方式并行测试 `baseline`（manifest 锁定版本）和 `latest`（npm 最新版），运行全量回归和契约验证。权限严格保持只读，不自动升级本地或远端环境。

## 14. 诊断、度量和状态检查

检查本地同步状态：

```bash
node doctor.mjs
node doctor.mjs --json
```

`doctor` 会把已安装的 Pi 运行时与 `manifest.json` 的 `piVersion` 比对，输出 `pi runtime` 一行。升级 Pi 后若该行报 `DRIFTED`，只需把 `piVersion` 更新到新版本；报 `MISSING` 则表示在已搜索的全局 `node_modules` 中找不到 Pi（可用 `PI_GLOBAL_NODE_MODULES` 指定额外路径）。

检查 skill 覆盖和 Pi 兼容性：

```bash
node skill-audit.mjs
```

检查启动 context 和真实 CLI 工具 schema：

```bash
node measure.mjs /path/to/project
```
`measure.mjs` 基于 CLI 实际发出的系统消息中的 `toolsAdded` 声明进行精确 schema token 估算，不再因独立的 SDK 会话而漏算原生工具。

固定模型做测量：

```bash
PI_EVAL_MODEL=cpa/gemini-3.8-flash-high node measure.mjs /path/to/project
```

检查路由逻辑：

```bash
PI_EVAL_MODEL=cpa/gemini-3.8-flash-high \
  ROUTE_TEST_CWD=/path/to/project \
  node route-smoke.mjs /tmp/route-results.json
```

分析会话用量与 SoL 效率报告（覆盖 assistant、工具调用、压缩、branch summary 和 cache warm）：

```bash
node observe.mjs /path/to/pi-session.jsonl
node observe.mjs /path/to/pi-session.jsonl --summary
```

## 15. 常见问题

### `doctor` 显示 `DRIFTED`

先看 JSON 详情：

```bash
node doctor.mjs --json
```

常见原因：

- upstream source pin 变化但尚未安装。
- skill 安装被 `--skip-skill-install` 跳过。
- 用户直接修改了受 Perfect Pi 管理的文件。
- settings 中的 managed field 与 manifest 不一致。
- 旧的 upstream skill 和本地 override 同时可见。

处理方式：

```bash
node setup.mjs --dry-run
node setup.mjs
node doctor.mjs
```

如果是已有实体 override 文件，先使用 `--adopt-overrides`，不要直接删除文件。

### Pi 报 skill collision

确认：

```bash
node skill-audit.mjs
node doctor.mjs
```

然后重新同步：

```bash
node setup.mjs --skip-package-install --adopt-overrides
```

如果 collision 仍存在，检查 `settings.json` 中是否还有旧的手工 skill path。不要随意删除用户 settings；先确认该 path 是否属于 Perfect Pi ownership registry。

### `question` / `questionnaire` 没有弹出 UI

确认当前是交互式 TUI：

```bash
pi
```

JSON、print 和部分 RPC 场景没有完整 terminal custom UI，会返回明确的 UI unavailable 结果或走文本 fallback。不要把 headless 模式当成可以自动回答用户决定。

### 浏览器工具不可用

确认：

```bash
which agent-browser
node doctor.mjs
```

在 Pi 中启用：

```text
启用 browser capability
```

### LSP 不可用

`doctor` 或验证报告中的 LSP 结果可能是 `MISSING` 或 `BLOCKED`。这通常表示 `pi-lsp.json` 中指定的 language server 命令没有安装。安装并配置目标 server 后，再重新运行：

```text
/verify
```

### Pi 没有继续执行 route 返回的建议

这是设计行为。`/skill:route` 只推荐路径，不自动启动后续 workflow。复制推荐的入口，例如：

```text
/skill:diagnosing-bugs
/skill:grill-with-docs
/skill:implement
/skill:to-spec
/skill:to-tickets
/skill:implement-spec
/verify
```

## 16. 一条完整示例

假设要增加一个需要前后端配合的团队邀请功能：

```text
1. /skill:route 增加团队邀请，包含前端邀请表单、API、数据库状态和邮件通知
2. /skill:grill-with-docs 团队邀请功能
3. /skill:setup-matt-pocock-skills        # 只在当前 repo 尚未配置 tracker 时执行
4. /skill:to-spec
5. /skill:to-tickets .scratch/team-invites/spec.md
6. /skill:implement-spec .scratch/team-invites/spec.md
7. /verify 团队邀请完整流程
8. /skill:code-review <starting-sha 或当前工作树范围>
9. /release-check
10. /skill:handoff                        # 如果还需要下一次会话继续
```

对小改动不要强行走完整 ticket ladder。对跨会话、多模块、需要恢复和并行 worktree 的工作，才使用 spec、tickets 和 implement-spec。

## 17. 当前能力边界

Perfect Pi 已验证：

- skill 发现、override 隔离和安装状态管理。
- Pi extension loader、question/questionnaire UI handler。
- 路由 smoke、工作树审查、ticket contract。
- Git three-way merge 和本地 tracker ledger。
- capability 按需加载。
- 只读 Pi skill evaluation subprocess。

尚未由本配置统一验证：

- 真实 GitHub/GitLab issue 发布、远程 claim 镜像和 PR 创建。
- 任意项目的完整 frontend/API/database 端到端开发。
- 生产部署、迁移和回滚。
- 所有语言的 LSP server 安装。

这些边界不影响日常使用，但在高风险任务中必须使用 `verify-product`，并把 `Not run` 或 `Blocked` 事实写进结果。
