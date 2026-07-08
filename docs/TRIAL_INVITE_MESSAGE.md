# CodeClaw Trial Invite Message

Copy and edit this message when inviting the first local trial user.

## English

```text
Hi, I am preparing a small local trial for CodeClaw, an AI developer workbench that runs on your own computer.

The goal of this first trial is not to let it freely edit your project. I mainly want to test:

1. Can you start it smoothly?
2. Is the first-run workflow understandable?
3. Does read-only preflight pick useful source/test files from a real project?
4. Do the safety gates make it clear when CodeClaw is only reading and when it would write or run commands?

Estimated time: 20-30 minutes.

Requirements:

- Windows 10 or later.
- Node.js 20 or later.
- One local project you are comfortable letting the tool inspect in read-only mode.

Trial steps:

1. Unzip/open the CodeClaw trial folder.
2. Double-click start-codeclaw.cmd.
3. Keep the launcher window open.
4. In the browser, click Demo first.
5. Then try one real project read-only preflight.
6. Do not apply a real patch during this first trial unless we explicitly decide to use a disposable copy or branch.
7. Fill docs/TRIAL_FEEDBACK_TEMPLATE.md after the session.

Important safety notes:

- The first real-project trial should be read-only.
- Do not paste API keys unless we explicitly test model configuration.
- Stop before Apply if anything feels unclear.
- Stop before writes if preflight shows blockers or the selected files look wrong.

Please tell me the first moment that feels confusing, risky, or annoying. That is the most valuable feedback.
```

## 中文短版

```text
我想请你帮我试一个 CodeClaw 本地试用版，大约 20-30 分钟。它是一个运行在你电脑上的 AI 开发工作台。

这轮先不让它随便改真实项目，主要测试：
1. 能不能顺利启动；
2. 第一次使用流程是否清楚；
3. 只读预检能不能从真实项目里选出有用的源码/测试文件；
4. 读文件、写文件、运行命令这些安全边界是否让人放心。

要求：Windows + Node.js 20+，准备一个可以只读检查的本地项目。

步骤：打开试用包 -> 双击 start-codeclaw.cmd -> 先点 Demo -> 再跑一次真实项目只读预检 -> 填反馈模板。

这轮先不要对真实项目点 Apply。任何地方觉得困惑、不放心、麻烦，都直接告诉我，这些反馈最重要。
```
