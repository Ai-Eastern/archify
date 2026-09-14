# Goal：为 Architecture 节点增加有证据的开发者指南

在 Archify 当前开发分支为 Architecture 节点实现“节点速览 + 节点开发指南”两层阅读体验。新开发者选中节点后，先在现有检查器中看到职责、实现范围和精选 interface；明确打开开发指南后，在主工作区阅读运行流程、interface、状态约束以及修改与验证入口。所有具名符号和行为说明都关联固定源码版本的证据，原有详情、关系、源码、下探、引用、导出和阅读恢复完整保留。

本文是可直接执行的实施 goal。执行时完成代码、生成产物、自动验收、视觉检查、证据记录及实施后消融。编写本文不代表已经启动或完成实施。

## 1. 执行顺序

1. **固定行为与内容基线。** 记录实际工作区、分支、HEAD、未提交修改和本地指令；保存现有 Architecture v1 fixture、普通单图、Atlas 五图样本、节点卡片、详情／关系／源码、下探、引用、历史恢复及导出行为。为新增 schema、证据引用、速览、开发指南、地址和失败状态先建立红测。完成条件：旧能力清单、固定输入摘要和至少四类节点 fixture 可复现，红测能分别拒绝非法资料与缺失交互。
2. **实现节点资料接口。** 增加可选 `components[].developer_guide`、稳定源码 ID 和逐条 `source_refs`；完成 schema、生成 validator、语义检查、仓库证据核验、确定性序列化和单份运行时载荷。完成条件：旧 v1 输入继续通过；有效新输入往返无损；无效引用、版本或内容预算在替换旧产物前失败。
3. **实现两层阅读体验。** 在现有详情中加入有界速览；用同一资料模型实现主工作区开发指南，接通普通 Architecture 与 Atlas workbench。完成进入、返回、深链、原生 Back／Forward、共享引用、窄屏、键盘、无动效及失败恢复。完成条件：真实浏览器能走完整路径，画布和旧检查器内容不因节点速览发生位移或丢失。
4. **真实样本、全量回归与消融。** 使用当前分支在全新目录生成带指南的 OpenPI 五图样本；检查内容真实性、最终体积、离线使用、导出隔离和连续过程。逐项删除新增候选设计并重跑原验收。完成条件：AC01–AC14 全部通过，最终 HTML、源码与输入摘要、回执、PNG、浏览器证据及消融记录绑定同一产物；另按第 7 节记录新人效果状态。

## 2. 产品契约

### 2.1 节点速览

选择节点仍只改变节点选择，不切换主工作区、不改变画布尺寸或镜头。保留现有“详情 / 关系 / 源码”三个页签；详情页依次显示：

1. 原职责说明。
2. `implementation_scope`：`repository`、`external` 或 `generated` 的本地化短标签。
3. 最多三条精选 interface：方向、名称和一句用途；每条可以跳到精确关系或源码，但不复制关系和源码的完整内容。
4. “打开开发指南 →”，仅在有效完整指南存在时显示。
5. 既有类型、上下文、标签和稳定 ID 等元数据。

缺少 `developer_guide` 的节点保持实施前详情，不增加空标题、空页签或占位卡。画布节点不增加文档徽标、内容数量或 interface 列表。

### 2.2 节点开发指南

开发指南是同一 `(diagramId, nodeId)` 的第二阅读表面，不是新网页、Atlas 新层级或第二份当前节点状态。用户明确点击入口后，指南替换主工作区中的图；左侧架构目录、全局工具栏和节点速览保持。隐藏图保留相机快照，但处于 `inert` 状态并离开无障碍树。

指南正文使用一个滚动根和一个章节目录，不使用嵌套页签。只渲染有内容的固定章节：

| 章节 | 回答的问题 | 内容预算 |
| --- | --- | --- |
| `flow` | 何时触发、怎样推进、何时结束 | 3–7 个有序步骤 |
| `interfaces` | 谁通过哪个 interface 调用或依赖该 module | 最多 6 项；速览取前 3 项 |
| `state` | 状态由谁持有、生命周期与持久化范围 | 最多 5 项 |
| `constraints` | invariant、失败、取消、权限或并发约束 | 最多 5 项 |
| `change_points` | 某类改动从哪里进入、怎样验证、影响什么 | 最多 5 项 |

章节和条目采用作者顺序。正文不嵌入整段源码；interface 可显示简短签名，源码页签继续提供完整证据目录。内容不足一节时省略该节，不为完整性填充猜测或“暂无”。

普通单图与 Atlas 读取同一资料模型和阅读实现。Atlas 额外保持目录、访问快照、父层关系与跨图状态；不得为两个表面重复序列化正文。

### 2.3 地址、历史与返回

地址模型：

```text
NodeAddress = diagram + focus
Surface     = graph | guide
GuideState  = section?

#diagram=execution&focus=workflow-engine
#diagram=execution&focus=workflow-engine&inspect=guide
#diagram=execution&focus=workflow-engine&inspect=guide&section=interfaces
```

- Atlas 地址使用 `diagram`；普通单图没有 diagram 维度，生成和复制链接时省略该参数，不能填入虚构占位值。
- `inspect=guide` 必须带有效 `focus`；`section` 为固定章节 ID，省略时打开首个存在章节。
- 图中选择节点使用既有地址更新，不新增历史项。
- 从图打开指南在成功 ready 后恰好 `pushState` 一次；准备失败时图、URL 和 history 不变。
- 章节切换使用 `replaceState`，连续切换不堆积历史。
- 从普通访问打开指南时，“返回图”优先回到匹配的来源 history entry，使 Forward 可以恢复最后章节。冷指南深链没有内部来源时，返回图在当前 entry 上移除 `inspect/section`，不把用户带离产物。
- Back／Forward 恢复图相机、节点选择、检查器页签、每个滚动根、指南章节及可恢复焦点。折叠行、hover、toast 和关系预览属于瞬时状态，不进入共享 URL。
- “复制节点链接”保留当前 occurrence；“复制开发指南链接”指向 canonical definition 和当前章节，不携带 entry ID、滚动、展开或预览状态。
- 从引用 occurrence 打开指南时，成功导航到 canonical definition；Back 返回原 occurrence、原本地图关系、相机和检查器状态。引用节点不复制规范节点的开发指南正文。
- “进入子图”与“打开开发指南”保持两个独立、明确命名的动作。
- 指南活动时，通过架构目录、关系、源码或其他已有入口选择另一节点或图，成功后进入目标的 graph surface 并沿用该入口既有的 history 规则；不把新节点悄悄套进旧指南。目标准备失败时保留当前已提交的 graph 或 guide surface、URL 和 history。

### 2.4 失败与空状态

| 场景 | 行为 |
| --- | --- |
| 有效节点没有指南 | 常规选择时不显示入口；外部旧深链显示“尚未提供开发指南”，仍可返回图、关系或源码 |
| 非法 diagram / focus / section | 显示可定位错误和有效返回动作；冷启动保留目标 URL |
| 用户点击后渲染失败 | 当前已提交的 graph 或 guide surface 保持唯一活动权限，就近显示失败与重试，URL/history 不提交 |
| Back／Forward 目标失败 | 保留浏览器目标地址和错误状态，后续 Back／Forward 仍可继续 |
| 迟到的旧指南结果 | 丢弃，不改变 DOM、URL、history 或快照 |
| 剪贴板失败 | 在触发按钮附近报告，不改变导航状态 |
| 离线打开 | 指南完整可读，不主动请求网络 |

## 3. 数据与证据契约

### 3.1 作者格式

`developer_guide` 是 `components[]` 的可选字段，命名避免与 Atlas 的 `details` 下探语义冲突。作者格式固定如下：

```json
{
  "id": "workflow-engine",
  "type": "backend",
  "label": "Dynamic Workflow",
  "sources": [
    {
      "id": "workflow-entry",
      "role": "registration",
      "path": "extensions/workflows/index.ts",
      "line": 1123
    },
    {
      "id": "workflow-params",
      "role": "schema",
      "path": "extensions/workflows/index.ts",
      "line": 535,
      "symbol": "WorkflowParams"
    },
    {
      "id": "workflow-sandbox-call",
      "role": "callsite",
      "path": "extensions/workflows/index.ts",
      "line": 2057
    }
  ],
  "developer_guide": {
    "implementation_scope": "repository",
    "summary": {
      "text": "注册 workflow 工具，并将准备后的脚本传给 runWorkflowSandbox。",
      "source_refs": ["workflow-entry", "workflow-sandbox-call"]
    },
    "sections": [
      {
        "kind": "interfaces",
        "items": [
          {
            "id": "workflow-tool",
            "title": "workflow",
            "code": "workflow({ script, args?, background?, wait?, resume_from_run_id? })",
            "direction": "provided",
            "text": "接收 script 和可选运行参数来提交工作流。",
            "source_refs": ["workflow-entry", "workflow-params"]
          }
        ]
      }
    ]
  }
}
```

结构规则：

- `sources[].id`、`role`、`symbol` 对旧节点可选；被 `source_refs` 引用的来源必须具备稳定 `id` 和 `role`。现有每节点最多 3 个 `sources` 的上限保留，首版定位为精选指南而非完整参考手册。
- 来源角色固定为 `definition`、`export`、`registration`、`callsite`、`guard`、`test`、`schema`、`documentation`。同节点 ID 唯一。
- `summary` 和每个条目至少引用一个同节点 source，引用唯一且最多 3 个。跨节点引用、孤儿引用和重复章节失败。
- section kind 固定为第 2.2 节五类，不接受自定义 kind、HTML、Markdown、任意组件或 UI placement 字段。
- `developer_guide` 必须含 `implementation_scope`、`summary` 和 1–5 个非空 `sections`。`summary.text` 为 1–240 个 Unicode 字符。
- 条目共同字段为稳定 `id`、纯文本 `title`、`text`、`source_refs`；`title` 为 1–80 字符，`text` 为 1–280 字符。`interfaces` 条目另要求 `direction`，可选 1–200 字符的 `code`；方向为 `provided`、`required`、`bidirectional` 或 `observed`。其他章节出现 interface 专属字段时失败。
- `flow` 含 3–7 项，`interfaces` 含 1–6 项，其余章节各含 1–5 项。所有对象 `additionalProperties: false`；所有稳定 ID 沿用现有 restricted ID 规则。
- 每节点编译后 guide 对象经 HTML-safe JSON 序列化不超过 4 KiB；单成员实际写入 inert script 的分块 JSON 文本不超过 64 KiB；Atlas 预算为各成员这段实际 script 文本字节之和，不超过 128 KiB。三者均按 UTF-8 字节计量，错误包含 component ID 和 JSON path。
- Atlas reference occurrence 不得作者一份重复的 `developer_guide`；manifest 校验拒绝冲突内容。规范节点没有指南时，occurrence 不显示指南入口。

### 3.2 真实性等级

Archify 区分结构有效、位置有效和说明正确：

1. JSON Schema 证明格式和有界性。
2. 仓库核验证明 origin、40 位 revision、commit、blob、路径和行范围存在。
3. `symbol` 存在时，必须能在固定 revision 的作者所选源码范围内按精确 token 定位；这不等同于 AST 级声明识别。接口方向还须具有匹配的 export、registration 或 callsite 角色。
4. 独立语义审读确认说明没有超出证据。审读者不能是同一次内容编写过程；可以是另一代理或真人，必须逐条记录 pass/fail。自动化不能用“路径存在”替代语义核验。

读者 UI 使用“关联源码”“调用侧观察”“测试覆盖”等准确措辞，不显示未经校准的置信度数字，也不把它们统称为“行为已验证”。

硬规则：

- 节点名称不产生代码实体。`Agent Loop` 不自动推导 `AgentLoop.run/start/stop`。
- 找到函数定义不等于公开 interface；`provided` 必须有 export 或 registration 证据，`required/observed` 必须有 callsite 或 registration 证据。`bidirectional` 必须引用至少两个不同来源：一项满足 provided 方向，另一项满足 required/observed 方向；同一个 source ID 不能同时充当两边证据。
- 重试、并发、顺序、幂等、取消、退出、状态所有权和持久化只在对应实现、guard 或 test 支持时出现。缺少依据就省略。
- `external` 节点首版只描述当前仓库能证明的接入面或调用侧观察，不声称外部 implementation 内部行为。`generated` 节点优先引用 schema 或 generator。
- 更换 repository revision 后重新执行全部来源和 symbol 核验；旧说明不继承“已核验”状态。产物明确是固定 revision 快照，不暗示实时知识。
- `local-only` 保留可复制的相对路径、行号和 symbol；payload、DOM 和可访问名称不生成远程 href，也不泄漏本机 repo root。

### 3.3 编译与运行时 seam

- 作者资料与节点共置；生成阶段编译成按 node ID 索引、仅出现一次的安全 JSON 数据块。Viewer 接口保持为读取节点资料并按当前 surface 投影，不把存储、验证或生成逻辑泄漏到 UI。
- schema 和 payload 不包含 `tab`、`panel`、`placement`、viewport 或 Atlas 布局信息。
- render 阶段不调用 LLM、不读取工作区 HEAD、不联网、不添加时间戳；同输入、revision、locale 和生成器必须逐字节确定。
- 覆盖 CJK、emoji、引号、反斜杠、控制字符、`<>&` 和 `</script>`；新增 payload 每行 UTF-8 不超过 8,192 字节。
- 指南正文不复制进 canonical SVG、分享卡、PNG/JPEG/WebP/SVG/WebM 或回执。回执只保存数量、字节和摘要。Node Finder 首版不索引指南正文。
- 自定义模板没有指南时继续工作；输入含指南但模板缺必需 slot 时明确失败，不静默丢资料。
- 固定 UI 文案、章节名、错误和空状态沿用现有 i18n 机制，至少提供 `en` 与 `zh-CN`；两种 locale 的 fixture 都不得显示原始翻译 key。作者提供的指南正文按原文保存和显示，不在生成或运行时自动翻译，也不把正文改成 `{en, zh-CN}` 对象。

## 4. 改动边界

### 本轮实施

- Architecture v1 的可选节点开发指南 schema、生成 validator、语义校验、证据引用、序列化与交付回执。
- 普通 Architecture 和 Atlas 的节点速览、主工作区指南、章节导航、返回与分享链接。
- Atlas 引用 occurrence 到 canonical definition 的指南导航，以及下探与指南动作区分。
- 地址、历史、访问快照、失败、窄屏、键盘、焦点、深浅主题和 reduced motion 行为。
- i18n、离线安全、相关模板、生成资产、示例、测试、文档和 `archify.zip`。
- 至少四类 fixture：repository module、external dependency、state/database、无指南旧节点；另含拥有 Atlas 子图和被共享引用的节点。
- 当前分支全新生成的 OpenPI 五图真实样本及证据。

### 本轮不扩展

- 不实现 AST／语言服务器、全仓库调用图、LLM 自动生成、运行时源码读取、实时同步或内容编辑器。
- 不实现跨仓库证据、多 repository 节点、远程文档抓取、sidecar 文档、在线 owner／Issue／部署／指标或告警。
- 不扩展 Workflow、Sequence、Dataflow、Lifecycle 的节点 schema。
- 不增加自由 Markdown/HTML、自定义 section、插件专属 Viewer、代码高亮器、接口试跑、测试执行或内嵌 IDE。
- 不增加第四个检查器页签、右侧/底部抽屉、可调整分栏、常驻小地图、节点文档徽标、接口行级 permalink、收藏或跨图全文搜索。
- 不扩大现有每节点 3 个 sources 上限，不承诺完整 API 参考手册，也不要求每个节点填满所有章节。
- 不重新设计节点卡片、架构布局、关系模型、下探树或视觉预设。

功能保全优先于新增指南。不能通过删除职责、关系、源码、详情页签、来源路径、分享、导出或阅读状态来降低信息密度或满足体积预算。发现预算冲突时继续优化或报告未达标，不降低旧能力。

## 5. 必须通过的验收

| 编号 | 完成条件及证据 |
| --- | --- |
| AC01 基线与功能保全 | 保存实施前输入、源码、生成产物和旧功能清单。最终真实操作仍能使用职责、详情／关系／源码、概览卡、章节、下探、共享引用、查找、路径/影响范围、分享、快捷键及全部既有导出。核对原内容而非只检查 DOM 存在；隐藏指南不替换或截断旧内容。 |
| AC02 Schema 与旧 v1 | 新字段仅为 Architecture `components[]` 的可选扩展。全部旧 v1 fixture 在新版中继续 validate/render；没有指南时不新增 repo-root 要求：未声明仓库证据的旧输入无需 repo root，既有证据输入沿用原核验规则。无指南不产生指南 payload/入口/空区块，canonical SVG 几何与语义内容不变。新版读取旧文件；不承诺旧二进制读取新字段。非法字段、kind、空 section、超长内容和超量条目以精确 JSON path 失败。 |
| AC03 引用与预算 | 同节点 source/item ID 唯一；每项 source refs 同节点可解析且无重复；跨节点、孤儿引用、重复 section 和错误专属字段失败。按安全序列化后的 UTF-8 计量并满足 4 KiB/节点、64 KiB/成员、128 KiB/Atlas，总 payload 最长行 ≤8,192 bytes。两个 surface 只存一份资料。 |
| AC04 证据与真实性 | 含指南的成员必须绑定固定 repository revision；origin、commit、blob、路径、行范围和可选 symbol 全部核验。最终真实样本逐项列出“说明 → 证据 → 独立语义审读结果”；审读者不同于内容编写过程，虚构符号、错误公开 interface 和无依据行为保证均为 0。路径存在和 schema 通过不能代替该清单。变更 revision 后失效定位必须失败并要求重核。 |
| AC05 速览 | 真实浏览器用本 goal 的固定 fixture 选择有指南节点后，现有详情首屏显示职责、scope、最多 3 个精选 interface 和明确指南入口；速览用途可作有界视觉摘录，完整作者正文仍在指南中，既有职责不得裁剪。关系和源码仍在原页签。无指南节点完全回退旧表现。选择、切页签及展开速览使图 bounding rect 各边变化 ≤1 CSS px，相机 scale 误差 ≤0.001、中心误差 ≤2 px，history 增量为 0。 |
| AC06 指南阅读面 | 明确打开后只有一个可见、可交互主工作区和一个可见 H1；指南展示正确节点、固定章节、源码/关系动作和返回入口，隐藏图可交互元素为 0。指南内部一个滚动根、无嵌套页签、无横向滚动；重复打开同一指南 5 次不增加 history、ready 事件或活动实例。 |
| AC07 地址与历史 | 从图打开指南成功后恰好调用一次 `pushState` 并形成一个指南访问 entry；从 Back 分支打开时允许浏览器丢弃 Forward 分支，因此不以 `history.length` 数值作为唯一判据。连续切换 5 个章节不调用 `pushState`。Back 返回原图，Forward 恢复最后章节；diagram ID、node ID、页签 ID 和焦点目标精确相等，相机中心及页面/面板滚动位置误差 ≤2 px，相机 scale 误差 ≤0.001。刷新和冷深链精确恢复 diagram/focus/section。用户触发准备失败不提交地址；历史目标失败保留目标 URL；迟到结果不能覆盖最新意图。 |
| AC08 下探与共享引用 | 同时拥有指南和 detail 的节点显示两个独立动作；进入子图与指南地址/历史互不冒充。reference occurrence 作者重复指南时构建失败；两个 occurrence 打开同一 canonical 指南时复制链接完全相同；分别 Back 后返回各自 occurrence、本地图关系、相机和检查器滚动。损坏 canonical target 在构建期拒绝；旧失效链接显示错误且不复制伪链接。 |
| AC09 响应式、i18n 与无障碍 | 覆盖 1440×900、721×800、720×800、390×844、320×568，浅/深主题、`en`/`zh-CN` 及 reduced motion；两种 locale 均无缺失翻译或裸 key，作者正文逐字保持。320px 时页面宽度溢出 ≤1 px，主要控件命中区 ≥44px，指南活动时可见纵向滚动根只有页面一个。键盘可选择节点、打开指南、浏览章节、切旧页签和返回；焦点始终可见，Chrome Accessibility tree 中隐藏图和重复控件副本全部 ignored，同类 landmark 在需要区分时具备可区分名称，正文对比度 ≥4.5:1、控件边界/焦点 ≥3:1。不得仅为本项引入新的无障碍运行时依赖。 |
| AC10 连续过程与失败 | 从操作前开始记录连续帧或视频及 DOM/地址事件，覆盖进入、返回、Back/Forward、冷链、断点 resize、失败/重试、快速 A→B 和 reduced motion。已提交阅读内容之后不出现无主工作区或错误主题；用户触发失败时当前已提交的 graph 或 guide surface 保持唯一活动权限。控制台错误、未捕获异常、未处理 rejection，以及每个 Document 内的重复 DOM ID 均为 0。自动过程证据与实际截图视觉检查分开记录。 |
| AC11 离线、安全与导出 | 最终普通单图和 Atlas 在 `file://` 及本地 HTTP 完整阅读，除用户主动源码点击外自主网络请求为 0。恶意字符串不能结束 script、注入 HTML 或改变结构。指南正文不进入图/卡片/视频导出；现有 SVG、PNG、JPEG、WebP、WebM、分享卡、路径卡、影响范围卡和剪贴板能力保持。`local-only` 不产生远程 href 或绝对 repo root。 |
| AC12 确定性、生成链路与发布包 | 相同输入/revision/locale 连续生成两次 HTML 哈希相同；失败不覆盖旧产物。生成 validators、模板、示例和 deterministic ZIP 按仓库链路重建；无 node_modules 的解包产物可以实际生成指南。完整测试及相关真实浏览器测试通过；显式跳过单独列出，不能计作通过。 |
| AC13 最终 OpenPI 样本 | 复制第 6 节固定六份输入到全新目录，再为至少 `system/pi-host`、`system/capability-loading`、`execution/workflow-engine`、`workflow/run-controller` 编写经证据审读的指南：覆盖 external、repository、拥有子图和三级深链。`execution/parent-session` 继续作为 `pi-host` reference 验证 canonical 行为。使用当前分支 CLI 全新编译，保留 5 图、4 detail、4 reference；最终完整 HTML ≤1,500,000 bytes，指南总量 ≤128 KiB，payload 行 ≤8,192 bytes。交付命令、输入/源码摘要、回执、代表 PNG、视觉检查和 AC 清单全部绑定同一 HTML；旧 HTML 或旧截图不能满足。 |
| AC14 实施后消融 | 列出新增/受影响的资料 compiler、presentation model、阅读 surface、状态和辅助层。逐个删除候选并重跑 AC01–AC13 中相关原验收；全部保持才永久删除，否则恢复。最终样本、真实性清单和过程证据必须来自消融后的代码。记录每个候选、命令、结果和恢复/删除决定。 |

真实浏览器验收等待明确 `graph-ready`、`guide-ready` 和 `guide-error` 状态，不用固定 sleep 代替。静态截图不能单独证明切换连续性；自动点击不能证明新人理解效果。

## 6. 固定真实样本与生成规则

基线输入位于：

`/Users/sunhonghao/.codex/visualizations/2026/09/11/01a08e23-38ae-73e0-8b88-51a2017e6e39/compact-delivery-20260912/openpi-final-r3`

使用其中 `openpi.atlas.json`、`system.architecture.json`、`capabilities.architecture.json`、`execution.architecture.json`、`workflow.architecture.json`、`continuity.architecture.json` 作为内容与布局基线。基线 HTML SHA-256 为 `ce5a002a7c6bc3632424a4f50283fc0eb0b7cabdfc8f4c80049144f22426119e`、1,348,530 字节，只用于比较和旧能力回归。

将六份 JSON 逐字节复制到新的可写输出目录，再只在副本中添加经核验的 `sources` 标识和 `developer_guide`。记录基线输入摘要及增强后输入摘要，不能修改或覆盖基线目录。OpenPI 来源 revision 固定为 `5fe045077a7e4c86c79295beaac84ce556301093`，仓库根为 `/Volumes/Data/openpi`；证据必须从该 revision blob 读取，不能用当前 main 行号替代。无法访问固定 revision 时继续完成受控 fixture 和实现，但 AC04/AC13 保持未通过，不静默换成当前 HEAD。

真实内容至少证明：

- `pi-host` 是 external implementation；只陈述 OpenPI 能证明的包入口、运行边界或调用侧观察，不发明 Pi 内部 interface。
- `capability-loading` 是 repository module，并拥有 `capabilities` detail；指南与“进入子图”动作同时存在。
- `workflow-engine` 是 repository module，并拥有 `workflow` detail；验证指南、子图和 Back/Forward 的三级路径。
- `run-controller` 是深层 repository module；至少包含一个 interface、一个约束和一个修改/验证入口。
- `parent-session` 仍是 `pi-host` 的 reference occurrence；从 occurrence 打开指南使用 canonical 目标并能返回来源。

执行前读取工作区及 OpenPI 的适用本地指令。生成命令使用实际工作区 `archify/bin/archify.mjs deliver atlas` 和现有 showcase/source 校验选项，不使用全局旧 Skill。保留现有未提交工作；提交、推送、合并、发布和部署不属于本 goal。

## 7. 新人效果观察：单独记录

本 goal 的代码完成承诺是：资料有界、证据可追溯、交互可用，并提供通向正确 implementation/seam 和验证入口的路径。它不等于已经证明所有新人理解得更快。

有真实参与者可用时，邀请至少 3 名未参与该项目实现的开发者，各完成：

1. 说明 Agent Loop/Pi 主会话节点的职责与 implementation scope。
2. 在 120 秒内找到一个正确的实现或接入入口及对应验证位置。
3. 打开开发指南或子图后返回原节点和阅读位置，并说明一条有证据的约束。

记录匿名参与者、任务题、真实耗时、答案、失败点、使用产物哈希和版本。建议通过门槛为 9 次任务至少 8 次成功，被指南误导而相信不存在 interface 为 0 次。若要声称“比原来更快”，必须另做相同任务的基线对照。

没有参与者时交付 `not-run` 记录；这不阻止 AC01–AC14 的实现 goal 完成，但最终只能写“为新人任务设计并通过自动可用性验收，真人效果待验证”，不能宣称理解效率已经提升。代理扮演新人、作者自测、自动浏览器或测试全绿不替代真人观察。

## 8. 实施交付

最终提供一份简明报告：

- 改动范围、关键设计与未扩展项。
- AC01–AC14 状态和逐项证据。
- 最终 OpenPI HTML、增强后六份 JSON、输入/生成器摘要、回执和 PNG。
- 每条真实指南事实的证据及人工审读结果。
- 自动浏览器过程、实际视觉观察和真人效果状态，三者分开。
- 实施后消融的永久删除与恢复项。
- 未解决限制；尤其不要把源码位置核验表述为语义证明。

## 9. 本次规格消融

本节是实施前的设计删减，不替代 AC14。

- 删除第四个检查器页签、右/底抽屉、可调分栏、接口行级深链和节点徽标；节点速览、完整指南、章节链接、进入/返回和分享仍可完成，因此保持删除。
- 删除第二套源码目录和独立 sidecar；指南通过现有节点 `sources` 的稳定 ID 关联证据，源码页签仍是唯一完整索引，因此保持删除。
- 删除自由 Markdown、custom section、自动接口抽取、调用图和内嵌 IDE；固定章节和纯文本条目已覆盖首版新人任务，因此保持删除。
- 尝试删除 `implementation_scope` 后，`pi-host` 的外部 implementation 会与 OpenPI adapter 混淆，恢复保留。
- 尝试删除逐条 `source_refs` 和来源角色后，无法区分定义、注册、调用侧观察和测试覆盖，也无法执行 AC04，恢复保留。
- 尝试删除速览中的精选 interface 后，30 秒发现路径退化成再次进入长文，恢复最多 3 条的速览。
- 尝试删除主工作区阅读 surface 后，运行流程、约束和修改指南只能挤入 280px 检查器，无法满足 AC06/AC09 的可读性与单滚动根要求，恢复保留。
- 真人观察不作为代码 goal 的隐藏阻塞项；仍保留独立状态与禁止效果夸大的规则，使 Codex 可以自主完成实现，同时不把自动化冒充为真实新人效果。
