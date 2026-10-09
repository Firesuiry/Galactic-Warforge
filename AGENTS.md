# AGENTS.md - 智能体架构与行为准则

本文件定义了本项目中 AI 智能体（Agents）的核心逻辑、角色职责以及在处理代码变更时的执行策略。

## 1. 核心设计哲学：激进式演进 (Radical Evolution)

本项目的最高准则为：**追求最优雅的实现。**

在增加新功能或优化现有逻辑时，Agent 必须遵循以下行为准则：
* **废弃兼容性：** 禁止为了兼容旧接口而编写冗余的适配层（Adapters）或包装函数（Wrappers）。
* **直接重构：** 如果现有接口阻碍了新功能的优雅实现，Agent 应当直接修改旧接口的定义及其所有调用点。
* **代码纯净：** 宁可修改 10 处调用代码，也不允许在核心逻辑中引入一次“权宜之计”（Hacks）。

# 2. 维护一个完善的API文档

如果你修改或新增了server项目中的api的行为，你需要在修改完成后更新docs中的服务端api文档。
如果你修改或新增了client-cli项目中的cli指令，你需要在修改完成后更新docs中的客户端cli文档。
两份文档里的命令一览由 `python3 scripts/gen_command_docs.py` 生成，`python3 scripts/command_coverage.py --check` 会检查是否过期。

# 3. 尽量降低代码耦合，实现简单直接
模块间避免直接依赖；不绕圈子，不做过度的错误处理。

# 4. 实现完成后要进行测试 测试通过才算完成 测试完成后把修改合并到主分支提交到远程

测试要在临时文件生成含逐步骤操作截图的md版本测试报告文件 供用户审阅
测试文档放到tmp临时文件夹中

# 5. 回复用户
1. 用中文
2. 要简洁

# 6. 一些操作路径 需要注意的地方 用户的要求 需要的记忆 请简洁得记录到项目下的note.md 比较长的放到docs/guide下 在note里引用

# 其他
client-web测试时要用过浏览器去看 是否能显示操作 比如建筑建造 兵力调配等功能是否正常 还有是否能显示当前的局势

apply_patch 功能可能不正常，试一次如果失败请换方式写文件

# 开发环境
go安装在/mnt/wsl/data/home/firesuiry/sdk/go1.25.0/bin（受限环境测试加 GOCACHE=/tmp/gw-go-cache GOTOOLCHAIN=local）

# 6. 可以根据需要开子智能体 尤其在复杂任务上 通过子智能体承担实现和测试工作 节约主智能体的上下文

# 7. 上传视频到 B 站
用 biliup 命令行投稿（安装与用法见 `.agents/skills/biliup/SKILL.md`；登录 cookie 存于 develop_tools/biliup/cookies.json，不提交）

# 通知用户的方式 

请在任务完工时通过下面的接口通知用户 只有主代理在最终完工时通知 子代理不要通知
有问题需要用户协助也可以通知用户 尽量你自己干

请求方式：POST

请求URL：https://wxpusher.zjiecode.com/api/send/message/simple-push

请求格式：Content-Type:application/json

请求内容：

//JSON不支持注释，发送的时候，需要删除注释。
{
    //推送内容，必传
    "content":"<h1>极简推送</h1><br/><p style=\"color:red;\">欢迎你使用WxPusher，推荐使用HTML发送</p>",
    //消息摘要；接口侧最长100，可以不传，不传默认截取 content 前面内容。各端通知/卡片实际展示可能更短（如部分场景约20字）。
    "summary":"消息摘要",
    //内容类型 1表示文字  2表示html(只发送body标签内部的数据即可，不包括body标签，推荐使用这种) 3表示markdown 
    "contentType":2,
    //发送SPT，WXPUSH_SPT_TOKEN 定义在E:\smart下的.env
    "spt":"WXPUSH_SPT_TOKEN",
    //原文链接，可选参数
    "url":"https://wxpusher.zjiecode.com",
}
