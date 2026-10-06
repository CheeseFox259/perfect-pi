# Pi 1.0 功能采用盘点

日期：2026-10-05。状态：盘点完成，功能集成尚未执行。范围：已安装的 Pi 1.0.2、1.0.0/1.0.1/1.0.2 官方 CHANGELOG、当前 Perfect Pi 仓库（含前两轮未提交修复）。

## Pi 1.0.3 后续说明

本文件保留 1.0.2 时的历史盘点，不代表当前采用状态。Pi 1.0.3 的 `image()` 会在视觉附件旁提供临时文件路径，因此 N04 的“生成结果默认不落盘”已不再适用于该版本；写入失败时仍需检查返回结果，临时路径也不是持久资产。当前 prototype 仍采用网页生成与 `image_handoff` 导入，不因此默认调用图像 API。此次基线维护与验证范围见 [Pi 1.0.3 评估](pi-1.0.3-assessment.md)。

## 结论

Perfect Pi 已采用部分 Pi 原生能力，但尚未形成系统性的功能演进闭环。不能把“锁定 1.0.2、扩展能加载、回归全绿”当作“新功能已经融入工作流”。推荐先补原生工具入口和成本统计，再接入图像工作流及项目级 MCP 配置；生命周期、渲染和自动模型路由需要独立验证后迁移。

本报告中的优先级是建议，不是实施授权。没有升级 runtime、同步 live、副作用 MCP 调用、读取凭据、远程模型请求或提交/push。仓库中的压缩模型和生命周期修复尚未同步 live；已安装 Pi 自身的新能力不等于对应 Perfect Pi 适配也已生效。

## 基线与证据

- 仓库 `manifest.json:piVersion` 和被检查的 Pi package 均为 `1.0.2`。[P1][S1]
- `node scripts/check-pi-updates.mjs` 首次 npm 查询超时；以 `npm view @earendil-works/pi-coding-agent version --json --fetch-retries=0 --fetch-timeout=8000` 重试得到 `"1.0.2"`。这只证明检查时 npm 的 latest 值，不预测未来版本。
- CHANGELOG 来源是已安装发行包，不是网络搜索摘要。`package.json` SHA-256：`17739a1faa0f13a6d43a6db5b9ec57d7210e0b3ad6eacd0e46614224908bd3d2`；`CHANGELOG.md` SHA-256：`3b58fb99e46aa0a9185fb7ba052b4cad0d72f38ba2b634553ecdb25e4b82b654`。
- GitHub raw fetch 被本地代理的 fake-IP SSRF 检查阻止；没有修改代理/SSRF 配置。因此不把 GitHub main 的未发布变化纳入本轮。
- 三个独立只读子代理分别盘点工具/MCP、上下文/生命周期、模型/配置。本轮采用 blocking fact-finding，不是后台任务。主代理复核了来源并运行隔离探针。

状态定义：**已采用**表示在代码/配置中有明确映射；**部分采用**表示入口或组合缺失；**集成候选**表示尚未实现；**替换候选**不表示可以无损删除旧实现；**按需/暂缓**表示需凭据、场景、授权或实验。

## 1.0.x 新功能清单

| ID | 原生能力 / 版本 | Perfect Pi 当前状态 | 工作流组合与建议 |
|---|---|---|---|
| N01 | Fullscreen default / 1.0.0 | 已采用：managed settings 显式 `tuiMode: fullscreen`。[S1][P1] | 保留；涉及 TUI 改动时验证窄屏、tmux、滚动、图片和取消。不要仅为追随默认值删除用户 regular 模式选择。 |
| N02 | Header-only quiet startup / 1.0.0 | 已采用：`quietStartup: header`。[S1][P1] | 保留；版本 drift 由 doctor 单独提供，不应因启动变安静而隐藏兼容告警。 |
| N03 | Leaner codemode / 1.0.0；输出上限修复 / 1.0.1 | 部分采用：runtime 原生支持，但 manifest 未初始化 `+codemode`；capability 映射仍是旧 MCP 名称。探针 E1 确认。[S1][S2][P1][P2] | **优先集成**：为读文件/搜索/研究提供原生批量执行与结果过滤入口，同时保留直调工具；先比较真实 prompt/schema 大小，不搬用上游约 40% 数字为本项目收益。 |
| N04 | `models.generateImages()` in codemode / 1.0.0 | 集成候选：prototype 仍强调 ChatGPT/DALL-E + clipboard 的人工路径。[S1][S3][P3] | **优先集成**：有可用 image model 时生成概念图/素材，并将资产保存、预览、引用到 prototype；保留无 API 用户的 clipboard fallback。生成结果默认不落盘。 |
| N05 | Radius 一次登录并配置 MCP / 1.0.0 | 按需：无仓库级 Radius 策略；本轮不检查用户实际登录状态。[S1] | 可作为账号/MCP onboarding 选项，但不默认接入远程服务，不替代已有 web/browser 工具。 |
| N06 | Anthropic copy-code/headless login / 1.0.0；OAuth URL copy key / 1.0.1 | runtime 具备；工作流文档未专门覆盖。[S1] | 按需补 SSH/tmux/远端 worker 登录指引，调用原生 `/login` 而非自建登录/凭据桥。 |
| N07 | MCP OAuth issuer/scopes/per-server credentials、metadata URL / 1.0.0 | native MCP 路径自动受益，但未做真实 OAuth E2E。[S1][S4] | 沿用原生管理；只在目标 server discovery 确有问题时配置 metadata URL，不盲目复制认证参数。 |
| N08 | Project MCP overrides / 1.0.1 | 集成候选：项目 trust 已参与 SoL/phase 加载，但 MCP 工具入口没有配套采用规则。[S1][S4][S5][P2] | **优先集成**：仓库级最小 MCP profile，覆盖 `enabled/exposure/toolExposure`；用 trusted fixture 验证 global/project precedence、禁用、resume/reload。不向项目文件复制 global token。 |
| N09 | MCP CIMD / 1.0.1 | 按需：不是所有授权服务器支持。[S1][S4] | 仅为拒绝动态注册且支持 CIMD 的服务器提供 onboarding 选项；不普遍替换 OAuth。 |
| N10 | `pi.registerToolRenderer()` / 1.0.1 | 替换候选：当前 pi-cc-extensions 0.9.5 全局工具渲染仍 patch `ToolExecutionComponent.prototype`。[S1][S6][P4] | **优先验证替换**：用 resolver + `next()` 组合 unknown/resumed MCP、subagent、SoL 工具渲染；先验证 rich diff、折叠/展开、hover、动画、导出与专用 renderer。新 API 不是全部 prototype patch 的自动等价替代。 |
| N11 | Cloudflare Clef/Clef Flash classifiers / 1.0.1 | 暂缓实验：没有 classifier workflow；不判断用户是否有凭据。[S1][S3] | 用 `/skill:route` 的既有样例做离线/获批线上基准；无模型或低置信度回退到现有规则/询问。不能拿概率推断外部操作授权。 |
| N12 | Nix flake / 1.0.1；npm 不再 pin transitive dependencies / 1.0.1 | 集成候选：runtime resolver 聚焦 node_modules；CI 只安装 npm runtime。[S1][S7][P5] | **优先兼容工作**：增加 managed installer / Nix 的检测与验证路径；先核实实际布局。锁定 Pi 包版本不等于锁定整个依赖树。迁移本机安装方式需单独批准。 |
| N13 | `samplingParamsByThinkingLevel` / 1.0.2 | 按需：核心已支持，仓库没有定义 per-model sampling profile；本轮不读取私人 models.json。[S1][S3] | 为明确支持的 OpenAI-compatible endpoint 提供可选 profile；只对适用 API 生效，不把通用 temperature/top_p 写到所有模型。不承诺质量提升，需受控评测。 |

额外 1.0.1 行为变化：Anthropic 中途增加/重定义工具使用 inline 声明，有利于动态工具工作流缓存，但只证明上游实现改变，不能替代本项目缓存成本测量。[S1]

## 已继承但未充分组合的能力

下面不是全部“1.0 后新增”。明确标注原始版本，避免把旧能力包装成新功能。

| ID | 能力 / 原始版本 | 当前映射与下一步 |
|---|---|---|
| I01 | Native MCP + codemode + tool_search / 0.99.0；lazy discovery / 0.99.2 | 原生实现无需再装一套 MCP bridge；但 `capabilities.mcp = [mcp,mcpScript]` 已脱节。`global/AGENTS.md` 要求 codemode/discovery，而 activation 没有对应实现。E1 表明显式 `+codemode/+tool_search` 有效，但已有 tools-config 在 `/tree` 后可关闭它们。必须设计可恢复的启用入口、CLI 限制和按 branch 的选择语义。[S2][S4][S8][P2][P6] |
| I02 | Exposure/namespace/outputSchema/structuredContent/annotations / 0.99.0 | 目前大部分本地工具只返回 text/details；`capabilities`、phase status、tmux status 适合提供 typed structured output。保留 `structured_output` 的终止语义，outputSchema 本身不保证少一个模型回合。工具 annotations 只是提示，不是可信授权边界。[S6][P2][P7] |
| I03 | Guarded nested calls `ctx.executeTool()` / 0.99.0 | 已采用：edit/write fusion 的验证走 guarded bash；无需替换成直接 shell。原生 nestedCalls/usage 应成为测量和导出的数据源之一。[S6][P8] |
| I04 | Virtual models / 0.99.0 | 集成候选：当前主模型/child model/compaction model 分离但不按阶段路由。先做 `perfect-pi/auto` opt-in 原型，明确 planning/build/review 的物理模型与预算、sticky continuation/retry、fork/resume 和授权。不能把第一次 edit 当作规划完成；`direct` 包含所有 loop 外请求，不仅压缩。频繁切换可能损失 prompt cache。[S9][P9][P10] |
| I05 | Actionable `turn_end/agent_before_settle` / 0.87.0 | 替换候选：SoL OCC 仍 `context.abort()` 后在 `agent_settled` 调用 compaction/sendMessage、维护 continuation Promise。可验证 boundary drafts + continue 是否简化流程，但要保留容量压缩、取消、状态与 economics gate；“API 可用”不等于生命周期等价。[S6][P11] |
| I06 | Append-only `context_edit` / 0.87.0 | 替换候选：observation 每次 context projection 替换大结果。E2 证明原始证据保留、未来上下文替换、branch-before-edit 恢复原文。可尝试将 placeholder 投影持久化，但归档、发送次数、hash、ledger、recall 和 compaction checkpoint 仍须保留。[S10][P12] |
| I07 | Per-model compaction budgets / 0.86.0 | 部分采用：自定义压缩模型仍使用 native preparation；manifest 只配统一 token budgets，OCC 预估还使用 fork 常量。要区分当前对话模型的保留预算与摘要模型输出上限，验证 native/OCC 估计一致，不随意减小 keepRecentTokens。[S11][P1][P8][P10] |
| I08 | Cache warming / 0.86.0 | runtime 默认 streaming；实际是否执行取决于 cache lifetime、成本条件、用户设置。SoL economics 不能忽略 usage 成本。先修 totals 后再决定 off/streaming/idle，不默认开启付费 idle warming。[S12][P13] |
| I09 | `session_compact_failed` / 0.84.3；native usage entries | 集成候选：SoL adapter 记录成功、不记录对应失败/abort；observe 只汇总 assistant usage。E3 确认漏统计 compaction/branch_summary/usage/toolResult。应先以 raw entry IDs/事件身份去重，再分角色记录模型 usage，不把 cost totals 当作 assistant request count。[S10][S11][P8][P13] |
| I10 | `ui_prompt_start/end` / 0.84.4；`agent_settled` 终态 | 集成候选：tmux worker 目前主要收集 print stdout 和进程 exit。可增加 JSON/RPC/SDK 状态流，区分 RUNNING、WAITING_FOR_USER、COMPACTING、RETRYING，使用 settled 作为 run 终态信号之一。它改善可观测性，不自行解决 consent orphan。[S6][S8][P14] |
| I11 | CLI/SDK built-in extension 差异 | 测量缺口：CLI 默认装载 built-in codemode/MCP，SDK 不自动装载。measure 先运行 CLI 再新建裸 SDK session 查询 schemas，可能少算 native tools。先统一 resource loader/built-ins 和 schema 来源，再比较新功能收益。[S8][P15] |
| I12 | User-level trust / project overrides | 已部分采用：SoL config/phase contract 使用 `ctx.isProjectTrusted()`；tmux print worker 不显式带 approve/no-approve，其 project resources 受 saved/global policy 决定。扩展工作流时必须显式决定可信资源来源；不要为自动化方便 blanket `--approve`。AGENTS 内容本身仍可能是 untrusted input。[S5][P8][P14] |

## 实测证据

探针位置：`/tmp/perfect-pi-adoption-audit-F2MqXx/probes.mjs`。只在临时 agent 目录创建 SDK session，无 prompt、无 MCP server、无凭据和网络模型。探针调用真实 Pi loader、原生工具注册、codemode sandbox、SessionManager 和当前 observe。

**E1 - native tools 能运行，但 capability 映射不正确**

- 默认 session：registered 有 `codemode/tool_search`；active 为 `read/bash/edit/write/capabilities`。
- `capabilities.enable(["mcp"])` 后 active 不变，`missing = ["mcp", "mcpScript"]`。
- 设置 `defaultTools: ["+codemode", "+tool_search"]` 后两个 native tools 都 active；capabilities 的 MCP availability 仍为空。
- 写入 branch tools-config `[read,capabilities]` 并触发真实 tools-extension session_tree handlers 后，两个 native tools 都不再 active。
- 原生 codemode 以无 session-tool context 运行纯计算 `return { answer: 6 * 7 }`，返回 `{"answer":42}`。这证明 sandbox 执行，不证明 MCP/guarded nested calls E2E。
- 实际 native MCP 在 server 连接后可以自动开启 codemode/tool_search，因此不能声称当前 live MCP 一概不可用；缺口是可移植的 capability/UI/restore 合约。[S4]

**E2 - native context_edit 的持久投影语义**

- append toolResult `synthetic exact diagnostic`，再 appendContextEdit 成 `synthetic recall handle`。
- buildSessionContext 可见 handle，getEntry(target) 的 raw content 仍为原文。
- branch(target) 回到 edit 之前，model context 又可见原文。
- 没有验证该机制与实际 observation FULL_SENDS、reducer、fork archive 或 compaction 的组合。

**E3 - 成本报告未覆盖新能力**

- 合成记录包含 assistant usage.input=1、compaction=10、branch_summary=20、usage/cache_warm=30、codemode toolResult=40。
- 按官方 session usage 合约，这些均为可归属 usage；输入量合计 101。
- 当前 buildReport 的 `totals.input = 1`、`requests = 1`。requests 仍可表示 assistant calls，但 totals 不能据此声称整个 session 的成本/usage 完整。[S10][S6]

## 推荐实施顺序

1. **基础接入**：I01/N03 的 native tool activation + discovery + branch/CLI 限制；I09/I11 的 usage totals、nestedCalls 和 CLI/SDK 测量一致性。这些先于节费实验。
2. **可直接进入工作流的能力**：N04 image prototype 的生成/保存/预览闭环及 fallback；N08 trusted project MCP profiles；I02 typed structured outputs。每一项分别形成可验证的集成，不一次打开所有能力。
3. **减少自定义依赖**：N10 renderer resolver、I05 lifecycle boundary、I06 context_edit 分别做对照原型，保留原有行为后才移除 patch/bridge/投影逻辑。
4. **高级模型策略**：I04 virtual routing、N11 classifier、N13 sampling、I07/I08 compaction/cache budgets。需明确可用模型、成本授权和基准，默认 opt-in。
5. **部署可移植性**：N12 managed/Nix layouts、I10 worker event 状态、I12 trust。与 CI 增加对应 fixtures，不自动迁移本机。

不要合并/删除仍拥有独立领域逻辑的组件：subagent/tmux 的隔离和 tracker claim、guardrails 的操作限制、SoL 的 evidence/recall/economics、questionnaire 的多问题交互、browser/LSP/process 的专门运行时。[P7][P9][P14]

## 长期演进闭环

目前每日 CI 只回答 compatibility，不自动评估功能采用。后续应增加 feature-adoption ledger，每条记录 source version/来源、受影响 workflow、adopt/compose/replace/defer 决定、理由、实现引用、回归证据和 rollout 状态。

每次版本更新同时检查两条线：

- 兼容线：原有功能还能正确运行、契约和依赖是否变化。
- 演进线：新能力是否值得采用；能否替换旧实现；是否存在低风险的 workflow 组合。

采用成功必须有用户路径证据，不只 export/loader 检查。未知配置、远程 provider 行为、缓存成本和性能收益应保留为未验证项。保持 native upstream 代码与 Perfect Pi policy/adapter 分离，不通过直接改已安装包实现合并。

## 来源索引

所有 Pi 来源均来自已安装 `@earendil-works/pi-coding-agent@1.0.2`。发行包内文档/实现是本次实读证据；[上游仓库](https://github.com/earendil-works/pi) 与 [npm 包](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 是公共入口，不声称本轮成功 fetch GitHub main。

- [S1] [Pi CHANGELOG](/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md:3)，1.0.x lines 3-101；继承能力 lines 103-239、264-407、478-606。
- [S2] [Codemode](/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/codemode.md:1)。
- [S3] [Models: sampling/classifier/image](/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/models.md:100)。
- [S4] [MCP exposure/OAuth/project config](/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/mcp.md:1)。
- [S5] [Project trust](/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/security.md:29)。
- [S6] [Extension boundaries/exposure/renderers/nested usage](/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md:54)。
- [S7] [Managed/Nix installation](/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/quickstart.md:8)。
- [S8] [SDK lifecycle and built-in extensions](/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md:119)。
- [S9] [Virtual models](/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/virtual-models.md:1)，[Jev example](/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/jev-router.ts:1)。
- [S10] [Session usage/context_edit](/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md:113)；实际 replacement 类型是 `{ content: ... } | null`，见 [type declarations](/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts:119)。
- [S11] [Compaction hooks/budgets](/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/compaction.md:287)。
- [S12] [Settings/cache warming/defaultTools](/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/settings.md:7)。
- [P1] [Manifest](../../manifest.json:1)。
- [P2] [Capabilities](../../global/extensions/tools.ts:17)。
- [P3] [Prototype](../../skills/prototype/SKILL.md:25)。
- [P4] [Installed renderer prototype patch](/Users/superhacker/.pi/agent/npm/node_modules/pi-cc-extensions/extensions/renderer/default-mode.ts:516)。仅检查已安装副本，未修改第三方包。
- [P5] [Runtime resolver](../../scripts/pi-runtime.mjs:20) 与 [.github CI](../../.github/workflows/pi-compatibility.yml:1)。
- [P6] [Global instruction](../../global/AGENTS.md:7)。
- [P7] [Structured output](../../global/extensions/structured-output.ts:36)。
- [P8] [SoL adapter](../../global/extensions/sol-pi.ts:95)。
- [P9] [Child model policy](../../global/extensions/subagent-policy.ts:11)。
- [P10] [Compaction model](../../global/extensions/compaction-model.ts:8)。
- [P11] [Patched OCC lifecycle](/Users/superhacker/.pi/agent/git/github.com/CheeseFox259/SoL-Pi/src/sol-pi/extensions/online-context-compact/extension.ts:402)。
- [P12] [Observation projection](/Users/superhacker/.pi/agent/git/github.com/CheeseFox259/SoL-Pi/src/sol-pi/extensions/observation-pack/index.ts:145)。
- [P13] [Observe usage](../../observe.mjs:80)。
- [P14] [Ticket worker](../../scripts/ticket-worker.mjs:140)。
- [P15] [Measure CLI/SDK split](../../measure.mjs:17)。

## 验证边界

**Verified**：上游发布说明和文档与仓库映射；三个只读子代理盘点；npm bounded retry 返回 1.0.2；E1/E2/E3 隔离运行。未进行 provider 登录/凭据读取或远程模型调用，未输出私有配置。

**Not run**：新功能集成、真实 MCP/OAuth、远程 classifier/image/chat、Pi 安装迁移、Nix/Windows、真实终端渲染、缓存/质量/时延 A/B、GitHub CI 云端执行。此前测试通过不作为本轮新增功能 E2E 证据。

**Blocked**：GitHub raw fetch 受 fake-IP SSRF 拦截；首次 npm update check 超时，后续 bounded retry 成功。无法据此审计未发布 main。

**Not applicable**：本轮是盘点，不涉及 setup/live 同步、提交/外部发布、生产部署或数据库迁移。
