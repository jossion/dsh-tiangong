window.__ModuleLoader__.load({
  id: '@jos/workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo, useRef } = React

    /** The apply-time client context: components read host services through it. */
    let hostCtx = null
    /** Extra context from the optional session services fiber (null until ready). */
    let serviceCtx = null

    const PANEL_KEY = 'workbench'
    const NS = 'workbench'

    /** The host's read-only projection route (see `index.js` STATE_PATH). */
    const STATE_URL = '/workbench/state'

    /**
     * Bilingual dictionaries, registered through ctx.locale so the panel
     * follows the active language instead of hard-coding one.
     */
    const DICT = {
      en: {
        panelLabel: 'Tiangong',
        title: 'Tiangong',
        tabDelivery: 'Delivery',
        tabWorkflow: 'Workflow',
        tabDecisions: 'Decisions',
        decisionsTitle: 'Decisions this shift',
        decisionsOffline: 'No data yet — the host state route is not answering.',
        boardEmpty: 'No project yet. Plan a system with workbench_plan_software and its task tree grows here.',
        boardStale: 'The host does not serve the board yet — restart DSH to load the new host code.',
        boardProgress: 'done',
        boardBlocked: 'blocked',
        boardWaiting: 'waiting',
        approve: 'Approve',
        reject: 'Reject',
        gateBlocking: 'blocks the card',
        gateAdvisory: 'advice only',
        startPreview: 'Start preview',
        stopPreview: 'Stop preview',
        previewStarting: 'Starting…',
        previewNoWorkspace: 'No workspace set for this project, so there is nothing to run yet.',
        previewFailed: 'Preview failed to start.',
        openApp: 'App',
        appStarting: 'Starting the app…',
        appStop: 'Stop app',
        appError: 'The app did not start.',
        appStopped: 'The app is stopped.',
        viewDeliverables: 'Deliverables',
        backToApp: '← App',
        servicesLabel: 'Dependencies',
        boardTasks: 'tasks',
        boardFlow: 'Team flow',
        boardCockpit: 'COCKPIT',
        boardFlowStages: 'Stages',
        boardFit: 'Fit',
        boardExpand: 'expand',
        taskEntryTitle: 'New task',
        taskEntryHint: 'Describe what should be built, or attach a requirement document. The app plans, dispatches and verifies it automatically.',
        taskEntryPlaceholder: 'A quotation system for our company. Four kinds of people use it: ...',
        taskSubmit: 'Start',
        taskPlanSubmit: 'Generate plan',
        statusPlanned: 'Ready to execute',
        execStart: 'Start execution',
        execNeedSession: 'Bind a conversation first — execution always runs inside an agent session.',
        execSent: 'Execution request sent to the bound conversation.',
        execPrompt: 'The plan for job {jobId} is ready. Execute it: call workbench_next_work to pull one card at a time, spawn a subagent per card, then report back with workbench_report_work (never report done unless the tests you ran are green). Report the result when every card is finished.',
        taskSubmitting: 'Planning…',
        taskStarted: 'Accepted — planning now. The task tree appears when the first event lands.',
        backToCards: '← Cards',
        backToProject: '← Project',
        tabTasks: 'Tasks',
        newJob: 'New task',
        jobsTitle: 'Tasks in this project',
        jobsEmpty: 'No tasks yet. Create one and it gets its own cockpit.',
        jobOpen: 'open cockpit',
        taskDoneMeta: '{items} items · {files} deliverables',
        taskOpenCockpit: 'Open cockpit →',
        taskOpenDone: 'Review result →',
        followUp: 'Change request',
        followUpHint: 'Delivered tasks stay as they are; a change is a new task linked to this one.',
        followUpPrefill: 'Change “{name}”: ',
        kindChange: 'Change',
        kindFix: 'Bug fix',
        kindFeature: 'Feature',
        kindLabel: 'Kind',
        taskFrom: 'from',
        taskFollowUps: '{n} follow-ups',
        deliverablePage: 'Delivered',
        projectHomeHint: 'What this project already produces. Open a task only to change something.',
        taskCockpit: 'Task cockpit',
        boardActivity: 'Live now',
        boardLive: 'LIVE',
        activityEmpty: 'Nothing is running right now.',
        activitySince: 'for',
        enterDev: 'Develop',
        pauseRun: 'Pause',
        resumeRun: 'Resume',
        cancelRun: 'Stop',
        cancelConfirm: 'Stop this project? Running tasks keep their completed work; the queue closes for good.',
        statusPaused: 'paused',
        statusCancelled: 'stopped',
        statusRunning: 'running',
        deliverableTitle: 'Deliverables',
        previewTitle: 'App preview',
        previewEmpty: 'No runnable build yet. Enter development and let the workflow produce one.',
        noArtifacts: 'No artefacts yet.',
        overviewHint: 'This is the project as it stands. Open development only when you want to change it.',
        overviewDone: 'Every task is done. Open development only if you want to change something.',
        backToOverview: '← Overview',
        createCard: 'Create',
        createDialogTitle: 'Create an app',
        createNamePlaceholder: 'e.g. Company operations',
        createHint: 'The app gets its own workspace and a dedicated delivery session. Submit a requirement and the automatic loop takes over.',
        createCancel: 'Cancel',
        createConfirm: 'Create app',
        uploadChoose: 'Attach requirement doc',
        uploadRemove: 'Remove',
        uploadHint: 'Accept .md / .markdown / .txt up to 512 KiB. You can also paste the requirement.',
        uploadTooBig: 'The document is larger than 512 KiB. Split it or paste the requirement.',
        uploadUnsupported: 'Only .md / .markdown / .txt documents are supported for now.',
        uploadReadFailed: 'Could not read the document.',
        autoPlanning: 'auto · planning',
        autoRunning: 'auto · dispatching',
        autoWaiting: 'needs you',
        tokensUsed: 'tokens',
        cardEmpty: 'No cards yet. Create the first one.',
        cardSubtitle: 'click to open',
        laneBusy: 'working',
        convoButton: 'Conversation',
        convoOpen: 'Hide conversation',
        convoClosed: 'Show conversation',
        panelsToggle: 'Panels',
        panelsHide: 'Hide panels',
        panelsNeedRoom: 'Widen the window to show the side panels.',
        convoTitle: 'Task conversation',
        convoNone: 'No conversation bound to this task yet.',
        convoNew: 'New conversation',
        convoBind: 'Bind existing',
        convoUnbind: 'Unbind',
        convoInDsh: 'Open in DSH',
        convoSend: 'Send',
        convoSending: 'Sending…',
        attachImage: 'Image',
        attachHint: 'Paste or drop an image',
        attachTooBig: 'Each image must be under 8 MB.',
        attachLimit: 'Up to 4 images per message.',
        attachOnlyImages: 'Only images can be attached here.',
        attachNoChannel: 'This host cannot carry images; the picture was not sent.',
        convoEmpty: 'No messages yet.',
        convoPlaceholder: 'Tell the agent what to do next…',
        convoLoading: 'Loading conversation…',
        convoUnavailable: 'This host build does not expose the session API.',
        convoBound: 'bound',
        convoPick: 'Pick a conversation',
        convoUntitled: 'Untitled conversation',
        convoWorkspace: 'DSH workspace',
        convoWorkspaceId: 'workspace',
        convoResolving: 'Resolving workspace…',
        convoNeedWorkspace: 'Set a workspace first: conversations live inside one.',
        convoRefresh: 'Refresh',
        workspaceButton: 'Workspace',
        workspaceTitle: 'Task workspace',
        workspaceHint: 'Where the agent works for this task. An absolute directory.',
        workspaceSave: 'Save',
        workspaceSaved: 'Workspace saved.',
        workspaceExisting: 'DSH workspaces',
        workspaceEmpty: 'No workspace yet — create one; it will appear in the DSH sidebar.',
        workspaceNew: 'New workspace',
        workspaceName: 'Name (optional)',
        workspacePath: '/absolute/path/to/project',
        workspaceCreate: 'Create and use',
        workspacePickOne: 'Pick a workspace first.',
        deliverableCount: 'artefacts',
        cardHint: 'Each card is one project. Open it for the pipeline, the team and the decisions.',
        cardEnterApp: 'Open app',
        cardNoApp: 'No app yet',
        boardZoomHint: 'Wheel or +/− to zoom · drag the canvas to pan · drag a card to move it · drag a lane chip to move the column',
        boardRelayout: 'Re-layout',
        boardRoot: 'Lead',
        boardSub: 'Specialist',
        boardDone: 'done',
        boardRunning: 'running',
        boardQueued: 'queued',
        boardFailed: 'failed',
        boardAgents: 'agents',
        boardGates: 'waiting on you',
        boardNoGates: 'Nothing is waiting on a person.',
        boardNoAgents: 'No one is assigned yet.',
        boardNoTasks: 'No tasks yet. Use “New task” to plan one.',
        stageBrief: 'Brief',
        stageRoles: 'Roles',
        stageDesign: 'Design',
        stageBuild: 'Build',
        stageVerify: 'Verify',
        stageReport: 'Report',
        statForks: 'forks',
        statDecisions: 'decisions',
        statHeld: 'held for you',
        statSpent: 'spent',
        laneCode: 'Code',
        laneFrontier: 'AI',
        laneHuman: 'You',
        laneHintCode: 'exact rule, no model',
        laneHintFrontier: 'back to frontier',
        laneHintHuman: 'irreversible, never auto',
        streamTitle: 'Decision stream',
        waitingTitle: 'Held for you',
        waitingEmpty: 'Nothing is waiting on a person.',
        recentEmpty: 'No decisions recorded yet. Plan a system to produce some.',
        briefLabel: 'What do you want to build?',
        briefPlaceholder: 'A user management system for our company. Four kinds of people use it: ...',
        submit: 'Plan this system',
        submitting: 'Planning…',
        emptyBrief: 'Describe what you want built first.',
        noComposer: 'No composer bridge available; run it from the chat instead.',
        loading: 'Loading…',
        padding: '24px 28px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        width: '100%',
        boxSizing: 'border-box',
        minWidth: '320px',
        margin: '0 auto',
        appearance: 'none',
        background: 'none',
        border: 'none',
        borderBottom: '2px solid transparent',
        color: 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: '14px',
        cursor: 'pointer',
        borderBottomColor: 'var(--dsw-alias-brand-primary)',
        borderRadius: '10px',
        minHeight: '96px',
        resize: 'vertical',
        lineHeight: '1.6',
        alignSelf: 'flex-start',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        flex: '1 1 120px',
        fontVariantNumeric: 'tabular-nums',
        height: '10px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        position: 'relative',
        textAlign: 'right',
        d: 'M22 26h10M22 34h22M22 42h14',
        done: 'var(--dsw-alias-state-success-primary, #2ea043)',
        active: 'var(--dsw-alias-brand-primary, #4f8cff)',
        blocked: 'var(--dsw-alias-state-error-primary, #f85149)',
        failed: 'var(--dsw-alias-state-error-primary, #f85149)',
        waiting: 'var(--dsw-alias-state-warning-primary, #d29922)',
        todo: 'var(--dsw-alias-label-secondary)',
        backend: 'var(--dsw-alias-brand-primary, #4f8cff)',
        frontend: '#a371f7',
        qa: 'var(--dsw-alias-state-warning-primary, #d29922)',
        workbench: 'var(--dsw-alias-label-secondary, #8b949e)',
        status: 'todo',
        cancel: 'Cancel',
        closeNotice: 'Dismiss',
        retry: 'Retry',
        save: 'Save',
        edit: 'Edit',
        delete: 'Delete',
      },
      zh: {
        panelLabel: '天工',
        title: '天工',
        tabDelivery: '软件开发',
        tabWorkflow: '工作流',
        tabDecisions: '决策',
        decisionsTitle: '本轮决策',
        decisionsOffline: '还没有数据——host 的状态路由没有响应。',
        boardEmpty: '还没有项目。用 workbench_plan_software 规划一个系统，这里会长出任务树。',
        boardStale: 'host 还没提供看板数据——重启 DSH 加载新的 host 代码后就会出现。',
        boardProgress: '完成',
        boardBlocked: '阻塞',
        boardWaiting: '待你决定',
        approve: '批准',
        reject: '驳回',
        gateBlocking: '会卡住这张卡',
        gateAdvisory: '仅建议，不阻塞',
        startPreview: '启动预览',
        stopPreview: '停止预览',
        previewStarting: '正在启动…',
        previewNoWorkspace: '这个项目还没设置工作区，没有可以启动的东西。',
        previewFailed: '预览启动失败。',
        openApp: '应用',
        appStarting: '正在启动应用…',
        appStop: '关闭应用',
        appError: '应用没有启动起来。',
        appStopped: '应用已关闭。',
        viewDeliverables: '交付物',
        backToApp: '← 应用',
        servicesLabel: '依赖服务',
        boardTasks: '任务',
        boardFlow: '团队分工',
        boardCockpit: '驾驶舱',
        boardFlowStages: '阶段',
        boardFit: '复位',
        boardExpand: '展开剩余',
        taskEntryTitle: '新建任务',
        taskEntryHint: '写一句需求，或附一份需求文档。应用会自动规划、派发并验证。',
        taskEntryPlaceholder: '一个公司内部的报价单系统。四类人使用：销售、销售主管、财务、管理员……',
        taskSubmit: '开工',
        taskPlanSubmit: '生成计划',
        statusPlanned: '待执行',
        execStart: '开始执行',
        execNeedSession: '先绑定对话——执行必须发生在某个 agent 会话里。',
        execSent: '已把执行请求发给绑定的对话。',
        execPrompt: '任务 {jobId} 的计划已就绪，请开始执行：用 workbench_next_work 逐张取卡，每张卡派一个子 agent 完成，完成后用 workbench_report_work 如实上报（测试没绿不要报 done）。全部完成后汇报结果。',
        taskSubmitting: '规划中…',
        taskStarted: '已受理——正在规划，任务树会在第一条事件落账后出现。',
        backToCards: '← 卡片',
        backToProject: '← 项目',
        tabTasks: '任务',
        newJob: '新建任务',
        jobsTitle: '项目里的任务',
        jobsEmpty: '还没有任务。新建一个，它会有自己的驾驶舱。',
        jobOpen: '打开驾驶舱',
        taskDoneMeta: '{items} 个工作项 · {files} 个交付物',
        taskOpenCockpit: '打开驾驶舱 →',
        taskOpenDone: '查看结果 →',
        followUp: '修改/修复',
        followUpHint: '已完成任务不回改；改动会作为新任务创建，并关联到这个任务。',
        followUpPrefill: '修改「{name}」：',
        kindChange: '修改',
        kindFix: '修复 bug',
        kindFeature: '新增功能',
        kindLabel: '类型',
        taskFrom: '来自',
        taskFollowUps: '{n} 个后续任务',
        deliverablePage: '交付',
        projectHomeHint: '这个项目现在能产出什么。只有要改动时才进任务。',
        taskCockpit: '任务驾驶舱',
        boardActivity: '正在工作',
        boardLive: '进行中',
        activityEmpty: '现在没有任务在跑。',
        activitySince: '已跑',
        enterDev: '进入开发',
        pauseRun: '暂停',
        resumeRun: '继续',
        cancelRun: '终止',
        cancelConfirm: '确定终止这个项目？已完成的卡会保留，队列将不再派发新任务。',
        statusPaused: '已暂停',
        statusCancelled: '已终止',
        statusRunning: '进行中',
        deliverableTitle: '交付物',
        previewTitle: '应用预览',
        previewEmpty: '还没有可运行的产物。',
        noArtifacts: '还没有产物。',
        overviewHint: '这是项目现在的样子。只有要改它的时候，才进开发。',
        overviewDone: '所有任务都完成了。要改动时再进开发。',
        backToOverview: '← 概览',
        createCard: '创建',
        createDialogTitle: '创建应用',
        createNamePlaceholder: '例如：公司管理',
        createHint: '创建后自动分配工作区和专属交付会话；提交需求就进入自动闭环。',
        createCancel: '取消',
        createConfirm: '创建应用',
        uploadChoose: '选择需求文档',
        uploadRemove: '移除',
        uploadHint: '支持 .md / .markdown / .txt，≤512 KiB；也可以直接粘贴需求。',
        uploadTooBig: '文档超过 512 KiB，请拆分或改贴文本。',
        uploadUnsupported: '暂时只支持 .md / .markdown / .txt 文档。',
        uploadReadFailed: '文档读取失败。',
        autoPlanning: '自动·规划中',
        autoRunning: '自动·执行中',
        autoWaiting: '等你决定',
        tokensUsed: 'tokens',
        cardEmpty: '还没有卡片，先创建一张。',
        cardSubtitle: '点击进入',
        laneBusy: '工作中',
        convoButton: '对话',
        convoOpen: '收起对话',
        convoClosed: '展开对话',
        panelsToggle: '面板',
        panelsHide: '收起面板',
        panelsNeedRoom: '窗口再宽一些才能显示两侧面板。',
        convoTitle: '任务对话',
        convoNone: '这个任务还没有绑定对话。',
        convoNew: '新建对话',
        convoBind: '绑定已有对话',
        convoUnbind: '解绑',
        convoInDsh: '在 DSH 打开',
        convoSend: '发送',
        convoSending: '发送中…',
        attachImage: '图片',
        attachHint: '粘贴或拖入图片',
        attachTooBig: '单张图片不能超过 8MB。',
        attachLimit: '一条消息最多 4 张图片。',
        attachOnlyImages: '这里只能添加图片。',
        attachNoChannel: '当前宿主通道不支持图片，图片没有发送。',
        convoEmpty: '还没有消息。',
        convoPlaceholder: '告诉 agent 下一步做什么…',
        convoLoading: '正在加载对话…',
        convoUnavailable: '当前宿主版本没有暴露会话接口。',
        convoBound: '已绑定',
        convoPick: '选择会话',
        convoUntitled: '未命名会话',
        convoWorkspace: 'DSH 工作区',
        convoWorkspaceId: '工作区',
        convoResolving: '正在解析工作区…',
        convoNeedWorkspace: '先设置工作区：对话是挂在某个工作区下的。',
        convoRefresh: '刷新',
        workspaceButton: '工作区',
        workspaceTitle: '任务工作区',
        workspaceHint: 'agent 在这个任务里干活的目录，必须是绝对路径。',
        workspaceSave: '保存',
        workspaceSaved: '工作区已保存。',
        workspaceExisting: 'DSH 已有工作区',
        workspaceEmpty: '还没有工作区——新建一个，它会出现在 DSH 左侧栏。',
        workspaceNew: '新建工作区',
        workspaceName: '名称（可选）',
        workspacePath: '/项目/绝对路径',
        workspaceCreate: '创建并使用',
        workspacePickOne: '先选择一个工作区。',
        deliverableCount: '个交付文件',
        cardHint: '每张卡是一个项目；点进去看流水线、团队和决策。',
        cardEnterApp: '打开应用',
        cardNoApp: '还没交付应用',
        boardZoomHint: '滚轮或 +/− 缩放 · 拖画布平移 · 拖卡片移动单卡 · 拖泳道标签整组移动',
        boardRelayout: '重排',
        boardRoot: '主代理',
        boardSub: '子代理',
        boardDone: '已完成',
        boardRunning: '进行中',
        boardQueued: '待开始',
        boardFailed: '失败',
        boardAgents: '协作方',
        boardGates: '等你决定',
        boardNoGates: '没有需要你决定的事项。',
        boardNoAgents: '还没有分配协作方。',
        boardNoTasks: '还没有任务。点右上「新建任务」规划一次。',
        stageBrief: '需求解析',
        stageRoles: '角色权限',
        stageDesign: '数据与 API',
        stageBuild: '实现',
        stageVerify: '测试验证',
        stageReport: '交付报告',
        statForks: '决策种类',
        statDecisions: '决策数',
        statHeld: '等你决定',
        statSpent: '花费',
        laneCode: '代码',
        laneFrontier: 'AI',
        laneHuman: '你',
        laneHintCode: '精确规则，不调模型',
        laneHintFrontier: '交回前沿模型',
        laneHintHuman: '不可逆，永不自动',
        streamTitle: '决策流',
        waitingTitle: '等你决定',
        waitingEmpty: '没有东西在等人。',
        recentEmpty: '还没有记录到决策。先规划一个系统试试。',
        briefLabel: '你想做什么系统？',
        briefPlaceholder: '一个公司内部的用户管理系统。有四类人使用：管理员、部门主管、普通员工、审计员……',
        submit: '开始设计',
        submitting: '正在设计…',
        emptyBrief: '请先描述你想做的系统。',
        noComposer: '当前没有可用的对话入口，请直接在聊天中发起。',
        loading: '加载中…',
        padding: '24px 28px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        width: '100%',
        boxSizing: 'border-box',
        minWidth: '320px',
        margin: '0 auto',
        appearance: 'none',
        background: 'none',
        border: 'none',
        borderBottom: '2px solid transparent',
        color: 'var(--dsw-alias-label-secondary)',
        font: 'inherit',
        fontSize: '14px',
        cursor: 'pointer',
        borderBottomColor: 'var(--dsw-alias-brand-primary)',
        borderRadius: '10px',
        minHeight: '96px',
        resize: 'vertical',
        lineHeight: '1.6',
        alignSelf: 'flex-start',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        flex: '1 1 120px',
        fontVariantNumeric: 'tabular-nums',
        height: '10px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        position: 'relative',
        textAlign: 'right',
        d: 'M22 26h10M22 34h22M22 42h14',
        done: 'var(--dsw-alias-state-success-primary, #2ea043)',
        active: 'var(--dsw-alias-brand-primary, #4f8cff)',
        blocked: 'var(--dsw-alias-state-error-primary, #f85149)',
        failed: 'var(--dsw-alias-state-error-primary, #f85149)',
        waiting: 'var(--dsw-alias-state-warning-primary, #d29922)',
        todo: 'var(--dsw-alias-label-secondary)',
        backend: 'var(--dsw-alias-brand-primary, #4f8cff)',
        frontend: '#a371f7',
        qa: 'var(--dsw-alias-state-warning-primary, #d29922)',
        workbench: 'var(--dsw-alias-label-secondary, #8b949e)',
        status: 'todo',
        cancel: '取消',
        closeNotice: '关闭提示',
        retry: '重试',
        save: '保存',
        edit: '编辑',
        delete: '删除',
      },
    }
    // #endregion team-graph

    /** Board status colours. A status is not a lane, so it gets its own map. */
    const STATUS_COLOR = {
      done: 'var(--dsw-alias-state-success-primary, #2ea043)',
      active: 'var(--dsw-alias-brand-primary, #4f8cff)',
      blocked: 'var(--dsw-alias-state-error-primary, #f85149)',
      failed: 'var(--dsw-alias-state-error-primary, #f85149)',
      waiting: 'var(--dsw-alias-state-warning-primary, #d29922)',
      todo: 'var(--dsw-alias-label-secondary)',
    }

    const TEAM_OWNERS = ['workbench', 'backend', 'frontend', 'qa']
    const TEAM_COLORS = {
      backend: 'var(--dsw-alias-brand-primary, #4f8cff)',
      frontend: '#a371f7',
      qa: 'var(--dsw-alias-state-warning-primary, #d29922)',
      workbench: 'var(--dsw-alias-label-secondary, #8b949e)',
    }
    const TEAM_FALLBACK_COLOR = 'var(--dsw-alias-label-secondary, #8b949e)'

    const GRAPH_CSS = `
@keyframes wb-flow { to { stroke-dashoffset: -36; } }
@keyframes wb-glow { 50% { opacity: .45; } }
/* The dashed flow is part of the board's look: it always drifts, slowly.
   A running card's edge moves faster and brighter, so "working" still reads
   differently from "finished".

   fill: none is load-bearing, not tidiness: an open path is filled with black
   by default, and the implicit closing chord turned every edge into a dark
   ribbon that ran beside the dashed line instead of along it. */
.wb-edge { fill: none; stroke-dasharray: 6 6; animation: wb-flow 3.2s linear infinite; }
.wb-edge-blocked { stroke-dasharray: 2 4; animation-duration: 6s; opacity: .45; }
.wb-edge-active { stroke-dasharray: 8 4; animation-duration: 1.1s; }
.wb-card-active { animation: wb-glow 1.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .wb-edge-active, .wb-card-active { animation: none; }
}
`

    /** Shared inline styles for the workbench surfaces. */
    const s = {
      page: { padding: '24px 0 8px', display: 'flex', flexDirection: 'column', gap: '20px', width: '100%', boxSizing: 'border-box', minHeight: 0, overflow: 'hidden' },
      inner: { width: '90%', minWidth: '320px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '16px', flex: '1 1 auto', minHeight: 0 },
      title: { margin: 0, fontSize: '22px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      muted: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '13px', lineHeight: '1.6' },
      label: { fontSize: '14px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
      tabs: { display: 'flex', gap: '4px', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      tab: {
        appearance: 'none', background: 'none', border: 'none', borderBottom: '2px solid transparent',
        color: 'var(--dsw-alias-label-secondary)', padding: '8px 14px', font: 'inherit', fontSize: '14px', cursor: 'pointer',
      },
      tabActive: { color: 'var(--dsw-alias-label-primary)', borderBottomColor: 'var(--dsw-alias-brand-primary)', fontWeight: 500 },
      card: {
        background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '10px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px',
      },
      textarea: {
        width: '100%', minHeight: '96px', resize: 'vertical', boxSizing: 'border-box', padding: '10px 12px',
        borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)',
        font: 'inherit', fontSize: '14px', lineHeight: '1.6',
      },
      button: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        alignSelf: 'flex-start', padding: '8px 16px', borderRadius: '8px',
        border: '1px solid var(--dsw-alias-brand-primary)', background: 'var(--dsw-alias-brand-primary)',
        color: '#ffffff', font: 'inherit', fontSize: '13px', fontWeight: 600, letterSpacing: '.2px',
        whiteSpace: 'nowrap', cursor: 'pointer',
      },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px', margin: 0 },
      list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
      row: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      treeRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', fontSize: '12px' },
      statRow: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
      stat: {
        flex: '1 1 120px', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '2px',
      },
      statValue: { fontSize: '22px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontVariantNumeric: 'tabular-nums' },
      statLabel: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', letterSpacing: '.4px' },
      stageMeta: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      stageName: { fontSize: '12px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      sectionTitle: { margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      meter: { height: '4px', borderRadius: '999px', background: 'var(--dsw-alias-border-l1)', overflow: 'hidden' },
      meterFill: { display: 'block', height: '100%', background: 'var(--dsw-alias-brand-primary)' },
      badge: {
        fontSize: '11px', padding: '2px 8px', borderRadius: '999px',
        border: '1px solid var(--dsw-alias-border-l1)', color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '4px',
      },
      busy: { opacity: 0.6, cursor: 'wait' },
      dot: { width: '7px', height: '7px', borderRadius: '50%', display: 'inline-block', flex: '0 0 auto' },
    }

    const WB_CSS = `
.wb-btn { font: inherit; }
.wb-btn:hover { border-color: var(--dsw-alias-border-l2); }
.wb-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.wb-card:hover { transform: translateY(-2px); border-color: var(--dsw-alias-border-l2); }
.wb-card:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.wb-card { transition: transform .12s ease, border-color .12s ease; }
.wb-session-row:hover { border-color: var(--dsw-alias-brand-primary) !important; }
.wb-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; border-color: var(--dsw-alias-brand-primary) !important; }
.wb-primary:hover { filter: brightness(1.08); }
.wb-primary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .wb-card, .wb-card:hover { transition: none; transform: none; }
  .wb-edge, .wb-card-active { animation: none !important; }
}
`

    /** Locale-aware translator; falls back to the given dictionary. */
    function useTranslate(ctx, fallback) {
      return useCallback(key => {
        try {
          if (ctx && ctx.locale) return ctx.locale.bind(NS)(key)
        } catch {
          /* fall through */
        }
        return fallback[key] ?? key
      }, [ctx, fallback])
    }

    /**
     * One polling loop for the whole panel. The board and the summary are two
     * projections of the same log, so they are fetched together and refreshed
     * faster while something is actually running.
     */
    function useWorkbench() {
      const [payload, setPayload] = useState(null)
      const [failed, setFailed] = useState(false)
      const [tick, setTick] = useState(0)
      const busy = useRef(false)
      const [reloadKey, setReloadKey] = useState(0)
      useEffect(() => {
        let live = true
        let timer = null
        const load = () => {
          fetch(STATE_URL, { credentials: 'same-origin' })
            .then(response => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
            .then(body => {
              if (!live) return
              setPayload(body)
              setFailed(false)
              const projects = body?.board?.projects ?? []
              busy.current = Boolean(body?.planning)
                || projects.some(project => (project.jobs || []).some(job => (job.running || 0) > 0))
            })
            .catch(() => { if (live) setFailed(true) })
            .finally(() => { if (live) timer = setTimeout(load, busy.current ? 1200 : 3000) })
        }
        load()
        return () => {
          live = false
          if (timer !== null) clearTimeout(timer)
        }
      }, [tick, reloadKey])
      const reload = useCallback(() => setReloadKey(value => value + 1), [])
      return { payload, failed, reload }
    }

    /**
     * The bridge to DSH conversations.
     *
     * The panel never owns a session: it asks the host services to list, create,
     * read and send. Everything is feature-detected, because the host API has
     * moved between releases and a missing capability must say so, not crash.
     */
    function createSessionBridge(ctx) {
      // ctx may be a function so the bridge keeps working when the optional
      // service fiber arrives after the panel mounted.
      const current = () => (typeof ctx === 'function' ? ctx() : ctx)
      const service = name => {
        const ctx = current()
        if (ctx && ctx[name] !== undefined) return ctx[name]
        try {
          return ctx && typeof ctx.get === 'function' ? ctx.get(name) : undefined
        } catch {
          return undefined
        }
      }
      const sessions = () => service('sessions')

      const messageOf = entry => {
        const event = entry && entry.event
        if (!event || typeof event !== 'object') return null
        const type = event.type
        if (type !== 'user/message' && type !== 'assistant/message') return null
        const data = type === 'assistant/message' ? event.data?.message ?? event.data : event.data
        const blocks = data?.content ?? data?.blocks
        if (!Array.isArray(blocks)) return null
        const text = blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n').trim()
        if (text === '') return null
        return { role: type === 'user/message' ? 'user' : 'assistant', text }
      }

      return {
        available() {
          const api = sessions()
          return Boolean(api && (typeof api.using === 'function' || typeof api.create === 'function'))
        },
        async workspaceList() {
          const workspaces = service('workspaces')
          const snapshot = typeof workspaces?.list?.getSnapshot === 'function' ? workspaces.list.getSnapshot() : null
          const items = Array.isArray(snapshot?.items) ? snapshot.items : []
          return items.map(item => ({
            id: String(item.workspaceId ?? item.id ?? ''),
            title: String(item.title ?? ''),
            path: String(item.path ?? ''),
          })).filter(item => item.id !== '')
        },
        async createWorkspace({ path, title }) {
          const workspaces = service('workspaces')
          if (!workspaces || typeof workspaces.create !== 'function') throw new Error('宿主不支持新建工作区')
          const created = await workspaces.create({ path, ...(title ? { title } : {}) })
          const id = created?.workspaceId ?? created?.id
          if (!id) throw new Error('宿主没有返回 workspaceId')
          return { id: String(id), path: String(created.path ?? path), title: String(created.title ?? title ?? '') }
        },
        async resolveWorkspace(cwd) {
          const workspaces = service('workspaces')
          if (!workspaces || typeof workspaces.create !== 'function') throw new Error('宿主不支持注册工作区')
          const trim = value => String(value ?? '').replace(/\/+$/, '')
          const existing = (await this.workspaceList()).find(item => trim(item.path) === trim(cwd))
          if (existing) return existing.id
          const created = await workspaces.create({ path: cwd })
          const id = created?.workspaceId ?? created?.id ?? null
          if (!id) throw new Error('宿主没有返回 workspaceId')
          return String(id)
        },
        async list(workspaceId) {
          const api = sessions()
          // DSH exposes the session snapshot as `sessions.list.getSnapshot()`.
          const source = api && api.list
          const snapshot = typeof source?.getSnapshot === 'function'
            ? source.getSnapshot()
            : typeof api?.getSnapshot === 'function' ? api.getSnapshot() : api?.snapshot
          const rows = snapshot && snapshot.byId ? Object.values(snapshot.byId) : []
          // Sessions carry their workspace when the host tags them; older
          // snapshots do not, in which case we say so instead of guessing.
          const tagged = rows.filter(row => row && typeof row.workspaceId === 'string' && row.workspaceId !== '')
          const pool = workspaceId && tagged.length > 0 ? tagged.filter(row => row.workspaceId === workspaceId) : rows
          const seen = new Set()
          return pool
            .filter(row => row && typeof row.id === 'string')
            .map(row => ({
              id: row.id,
              title: String(row.title || row.displayTitle || row.name || '').trim(),
              updatedAt: Number(row.updatedAt ?? row.updated ?? row.createdAt ?? 0),
            }))
            .filter(row => row.id !== '' && !seen.has(row.id) && seen.add(row.id))
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, 40)
        },
        async open(id) {
          const ui = service('uiWorkspace')
          if (ui && typeof ui.openSession === 'function') return ui.openSession(id)
          const api = sessions()
          if (api && typeof api.open === 'function') return api.open(id)
          throw new Error('宿主不支持跳转会话')
        },
        async create(cwd) {
          const api = sessions()
          if (!api || typeof api.create !== 'function') throw new Error('宿主不支持新建会话')
          const workspaceId = cwd ? await this.resolveWorkspace(cwd) : null
          return api.create(workspaceId ? { workspaceId } : {})
        },
        async transcript(id) {
          const api = sessions()
          if (!api || typeof api.using !== 'function') return []
          return api.using(id, { source: 'workbench' }, async ref => {
            const binding = await ref.ready
            const entries = binding?.eventSource?.getSnapshot?.()?.entries ?? []
            return entries.map(messageOf).filter(Boolean).slice(-40)
          })
        },
        async send(id, text, images = []) {
          const api = sessions()
          if (!api || typeof api.using !== 'function') throw new Error('宿主不支持发送消息')
          const check = result => {
            if (result && (result.kind === 'error' || result.ok === false)) {
              throw new Error(result.text || result.error?.message || '发送被拒绝')
            }
          }
          const pending = Array.isArray(images) ? images : []
          return api.using(id, { source: 'workbench' }, async ref => {
            const binding = await ref.ready
            const conversation = service('conversation')
            const session = binding?.session

            if (conversation && typeof conversation.sendSession === 'function') {
              // DSH's contract: the third argument is a list of DRAFT attachment
              // ids. createDrafts() registers the browser files and returns them,
              // so the bytes travel through the host's own admission path.
              let attachmentIds = []
              if (pending.length > 0) {
                if (typeof conversation.createDrafts !== 'function') throw new Error('当前宿主版本不支持图片附件')
                const files = []
                for (const image of pending) {
                  const response = await fetch(image.dataUrl)
                  const blob = await response.blob()
                  files.push(new File([blob], image.name || 'image.png', { type: image.mediaType || blob.type || 'image/png' }))
                }
                attachmentIds = conversation.createDrafts(id, files).map(draft => draft.id)
              }
              check(await conversation.sendSession(session, text, attachmentIds, 'queue'))
              return true
            }
            if (session && typeof session.prompt === 'function') {
              if (pending.length > 0) {
                // Older hosts only accept text through prompt(); say so instead of
                // silently dropping the picture.
                throw new Error('当前宿主版本的会话通道不接受图片附件')
              }
              check(await session.prompt([{ type: 'text', text }], 'queue'))
              return true
            }
            throw new Error('会话没有可用的发送通道')
          })
        },
      }
    }

    /**
     * Measures the room the host gives the panel and returns the height that
     * fills it down to `inset` px above the window bottom. This is what keeps
     * the conversation column's bottom edge aligned with the DSH sidebar.
     */
    function useFillHeight(inset = 8) {
      const ref = useRef(null)
      const [height, setHeight] = useState(null)
      useEffect(() => {
        const measure = () => {
          const node = ref.current
          if (node === null) return
          const top = node.getBoundingClientRect().top
          const viewport = typeof window !== 'undefined' ? window.innerHeight : 0
          if (top <= 0 || viewport <= 0) return
          setHeight(Math.max(320, Math.round(viewport - top - inset)))
        }
        measure()
        window.addEventListener('resize', measure)
        const timer = setInterval(measure, 2000)
        return () => {
          window.removeEventListener('resize', measure)
          clearInterval(timer)
        }
      }, [inset])
      return [ref, height]
    }

    /** Tracks the rendered width of a container (layout decisions, not pixels). */
    function useElementWidth() {
      const ref = useRef(null)
      const [width, setWidth] = useState(0)
      useEffect(() => {
        const node = ref.current
        if (node === null) return undefined
        const measure = () => setWidth(node.getBoundingClientRect().width)
        measure()
        if (typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(measure)
        observer.observe(node)
        return () => observer.disconnect()
      }, [])
      return [ref, width]
    }

    /** Sidebar entry icon: a small board glyph. */
    function PanelIcon() {
      return h('svg', {
        width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('rect', { key: 'r', x: '2', y: '2.5', width: '12', height: '11', rx: '1.5' }),
        h('path', { key: 'v', d: 'M6.5 2.5v11' }),
        h('path', { key: 'h', d: 'M6.5 8h7.5' }))
    }

    function Empty(props) {
      return h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: '1.6' } }, props.text)
    }

    const LANE_COLOR = {
      code: 'var(--dsw-alias-state-success-primary)',
      frontier: 'var(--dsw-alias-brand-primary)',
      human: 'var(--dsw-alias-state-warning-primary)',
    }

    /** The decision stream: what the workflow decided, and how sure it was. */
    function DecisionsSection(props) {
      const { t, summary, events, compact = false } = props
      const raw = Array.isArray(events) ? events : []
      const recent = Array.isArray(summary?.recent) && summary.recent.length > 0
        ? summary.recent
        : raw.filter(event => typeof event.decision === 'string').slice().reverse()
      if (recent.length === 0) return h(Empty, { text: t('decisionsOffline') })
      const lanes = summary?.lanes?.counts ?? {}
      const rows = (compact ? recent.slice(0, 8) : recent.slice(0, 14)).map((event, index) => h('div', {
        key: event.id ?? `${event.decision}-${index}`,
        style: { display: 'flex', gap: '8px', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)', fontSize: '11px' },
      },
        h('span', { style: { color: LANE_COLOR[event.lane] ?? 'var(--dsw-alias-label-secondary)', flex: '0 0 auto' } }, String(event.lane ?? 'code')),
        h('span', { style: { color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, String(event.decision ?? '')),
        event.confidence === undefined || event.confidence === null
          ? null
          : h('span', { style: { ...s.stageMeta, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' } }, Number(event.confidence).toFixed(2))))
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
        compact
          ? null
          : h('div', { style: { display: 'flex', gap: '10px', ...s.stageMeta } },
              h('span', {}, `${t('laneCode')} ${lanes.code ?? 0}`),
              h('span', {}, `${t('laneFrontier')} ${lanes.frontier ?? 0}`),
              h('span', {}, `${t('laneHuman')} ${lanes.human ?? 0}`)),
        rows)
    }

    function StatusDot(props) {
      return h('span', {
        style: { width: '7px', height: '7px', borderRadius: '50%', display: 'inline-block', flex: '0 0 auto', background: STATUS_COLOR[props.status] || STATUS_COLOR.todo },
      })
    }

    /** Every executable card in the tree, leaves only. */
    function collectWork(task, out) {
      if (task.children && task.children.length > 0) {
        for (const child of task.children) collectWork(child, out)
        return
      }
      out.push(task)
    }

    const LANE_LIMIT = 5

    /**
     * Lay a project's cards out as lead + one column per owner.
     *
     * The layout is pure data: the canvas can drag cards anywhere afterwards,
     * and the tidy arrangement is what "re-layout" returns to.
     */
    function teamGraph(project, { expanded = {} } = {}) {
      const roots = Array.isArray(project.roots) ? project.roots : []
      const work = []
      for (const root of roots) collectWork(root, work)

      const owners = []
      for (const owner of TEAM_OWNERS) {
        if (work.some(task => (task.owner || 'workbench') === owner)) owners.push(owner)
      }
      for (const task of work) {
        const owner = task.owner || 'workbench'
        if (!owners.includes(owner)) owners.push(owner)
      }

      const CARD_W = 196
      const CARD_H = 58
      const GAP_Y = 14
      const LANE_GAP = 252
      const cards = []
      const lanes = []
      const left = 32
      const laneTop = 168

      owners.forEach((owner, index) => {
        const tasks = work
          .filter(task => (task.owner || 'workbench') === owner)
          .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id)))
        const shown = expanded[owner] ? tasks : tasks.slice(0, LANE_LIMIT)
        const x = left + index * LANE_GAP
        lanes.push({ owner, x, tasks: shown.length })
        shown.forEach((task, row) => {
          cards.push({
            id: task.id,
            title: task.title || task.id,
            owner,
            role: task.role ?? null,
            x,
            y: laneTop + row * (CARD_H + GAP_Y),
            w: CARD_W,
            h: CARD_H,
            status: task.status ?? 'todo',
            blocked: Array.isArray(task.openBlockers) ? task.openBlockers.length : 0,
            decisions: task.decisions ?? 0,
            note: task.lastNote ?? null,
            color: TEAM_COLORS[owner] || TEAM_FALLBACK_COLOR,
            expandable: false,
            overflow: false,
          })
        })
        if (tasks.length > shown.length) {
          cards.push({
            id: `${owner}:more`,
            title: `+${tasks.length - shown.length} more`,
            owner,
            role: null,
            x,
            y: laneTop + shown.length * (CARD_H + GAP_Y),
            w: CARD_W,
            h: CARD_H,
            status: 'todo',
            blocked: 0,
            decisions: 0,
            note: null,
            color: TEAM_COLORS[owner] || TEAM_FALLBACK_COLOR,
            expandable: true,
            overflow: true,
          })
        }
      })

      const rootTasks = work
      const total = rootTasks.length
      const done = rootTasks.filter(task => task.status === 'done').length
      const root = {
        x: left,
        y: 24,
        w: 200,
        h: 68,
        title: project.title || project.id,
        done,
        total,
      }

      const width = Math.max(360, left + owners.length * LANE_GAP + 40)
      const height = Math.max(320, laneTop + Math.max(1, ...lanes.map(lane => lane.tasks)) * (CARD_H + GAP_Y) + 60)
      return { cards, root, width, height }
    }

    /**
     * The lead-and-specialists card flow, as a zoomable canvas.
     *
     * The interaction is copied from the Harness task tree rather than
     * invented: wheel or +/− to zoom, drag to pan, one control to fit. A tree
     * that a project outgrows is a tree nobody reads, so expansion per lane
     * matters as much as the drawing.
     */
    /** Free positions live in the browser, not the ledger: layout is a view. */
    function readPositions(key) {
      try {
        const raw = window.localStorage.getItem(key)
        return raw ? JSON.parse(raw) : {}
      } catch {
        return {}
      }
    }

    function writePositions(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        /* a blocked storage must not break the board */
      }
    }

    const SNAP = 8

    function readPanelStore(key) {
      try {
        const raw = window.localStorage.getItem(key)
        return raw ? JSON.parse(raw) : null
      } catch {
        return null
      }
    }

    function writePanelStore(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        /* storage is optional */
      }
    }

    /**
     * A docked instrument panel. Unlike the old floating HUD, rails cannot
     * overlap: each panel is a block in a fixed column, so the canvas keeps a
     * predictable area and the eye can scan a column top to bottom.
     */
    function RailPanel(props) {
      const { t, projectId, panelId, title, node, accent = 'var(--dsw-alias-brand-primary)', summary = '', defaultCollapsed = false } = props
      const storageKey = `workbench:rail:${projectId}:${panelId}`
      const stored = readPanelStore(storageKey)
      const [collapsed, setCollapsed] = useState(stored ? stored.collapsed === true : defaultCollapsed)
      const toggle = () => {
        setCollapsed(current => {
          const next = !current
          writePanelStore(storageKey, { x: 0, y: 0, collapsed: next })
          return next
        })
      }
      return h('div', {
        style: {
          display: 'flex', flexDirection: 'column', flex: '0 0 auto', minHeight: 0,
          background: 'var(--dsw-alias-bg-layer-1)',
          border: '1px solid var(--dsw-alias-border-l1)',
          borderRadius: '8px', overflow: 'hidden',
        },
      },
        h('div', {
          role: 'button',
          tabIndex: 0,
          onClick: toggle,
          style: {
            display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 8px',
            cursor: 'pointer', userSelect: 'none', borderBottom: `1px solid ${accent}`,
            background: 'linear-gradient(180deg, rgba(47,57,72,.4), rgba(21,26,35,.1))',
          },
        },
          h('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: accent, boxShadow: `0 0 8px ${accent}`, flex: '0 0 auto' } }),
          h('span', { style: { fontSize: '10px', letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, title),
          summary ? h('span', { style: { marginLeft: 'auto', fontSize: '10px', color: 'var(--dsw-alias-label-secondary)', flex: '0 0 auto' } }, summary) : null,
          h('span', { style: { ...s.stageMeta, flex: '0 0 auto' } }, collapsed ? '▸' : '▾')),
        collapsed ? null : h('div', { style: { padding: '8px 10px', overflowY: 'auto', maxHeight: '240px', display: 'flex', flexDirection: 'column', gap: '6px' } }, node))
    }

    /**
     * A HUD panel floating above the canvas.
     *
     * Panels are screen-space: zooming the graph must not shrink the numbers
     * you are reading. Position and collapsed state are view state, kept per
     * project+browser, never in the ledger.
     */
    function FloatingPanel(props) {
      const { t, projectId, panelId, title, node, defaultPos, width = 280, defaultCollapsed = false, accent = 'var(--dsw-alias-brand-primary)', summary = '', bounds = { w: 0, h: 0 } } = props
      const storageKey = `workbench:panel:${projectId}:${panelId}`
      const stored = readPanelStore(storageKey)
      // Only a user drag pins a panel. Until then it follows the dock position,
      // which is why opening the conversation column (narrower canvas) moves
      // the right-hand panels instead of leaving them off-screen.
      const [manualPos, setManualPos] = useState(stored && typeof stored.x === 'number' ? { x: stored.x, y: stored.y } : null)
      const pos = manualPos ?? defaultPos
      const [collapsed, setCollapsed] = useState(stored ? stored.collapsed === true : defaultCollapsed)
      const drag = useRef(null)
      const moved = useRef(false)

      const persist = (nextPos, nextCollapsed) => writePanelStore(storageKey, {
        x: nextPos.x,
        y: nextPos.y,
        collapsed: nextCollapsed,
      })

      // Keep a pinned panel inside the canvas when the surface narrows.
      useEffect(() => {
        if (manualPos === null || !bounds.w) return
        const maxX = Math.max(0, bounds.w - width - 8)
        if (manualPos.x > maxX) {
          setManualPos({ x: maxX, y: manualPos.y })
          persist({ x: maxX, y: manualPos.y }, collapsed)
        }
      }, [bounds.w, width, manualPos, collapsed])

      const onHeaderDown = event => {
        if (event.button !== 0) return
        event.stopPropagation()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        moved.current = false
        drag.current = { x: event.clientX, y: event.clientY, ox: pos.x, oy: pos.y }
      }
      const onHeaderMove = event => {
        const start = drag.current
        if (start === null) return
        if (Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) > 4) moved.current = true
        const next = { x: Math.max(0, start.ox + (event.clientX - start.x)), y: Math.max(0, start.oy + (event.clientY - start.y)) }
        setManualPos(next)
        drag.current = { ...start, next }
      }
      const onHeaderUp = event => {
        const start = drag.current
        drag.current = null
        event.currentTarget.releasePointerCapture?.(event.pointerId)
        // A click on the header toggles the panel; a drag moves it. Without the
        // movement threshold every attempt to open a panel would also nudge it.
        if (start !== null && moved.current === false) {
          const next = !collapsed
          setCollapsed(next)
          persist(pos, next)
          return
        }
        if (start !== null && start.next) persist(start.next, collapsed)
      }

      return h('div', {
        // Stopping propagation keeps the canvas pan and card drags out of the
        // panel: a click on a number must never move the graph underneath.
        onPointerDown: event => event.stopPropagation(),
        style: {
          position: 'absolute',
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          width: `${width}px`,
          maxHeight: '70%',
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(180deg, var(--dsw-alias-bg-layer-1), rgba(13,16,23,.92))',
          border: '1px solid var(--dsw-alias-border-l2)',
          borderRadius: '6px',
          boxShadow: '0 8px 28px rgba(0,0,0,.38), inset 0 0 0 1px rgba(255,255,255,.02)',
          overflow: 'hidden',
          zIndex: 6,
          backdropFilter: 'blur(6px)',
        },
      },
        // Four corner brackets: the cheapest way to read as instrument chrome.
        [[0, 0], [1, 0], [0, 1], [1, 1]].map(([cx, cy], index) => h('span', {
          key: `corner-${index}`,
          'aria-hidden': true,
          style: {
            position: 'absolute',
            width: '9px',
            height: '9px',
            pointerEvents: 'none',
            [cy ? 'bottom' : 'top']: '-1px',
            [cx ? 'right' : 'left']: '-1px',
            [`border${cy ? 'Bottom' : 'Top'}`]: `1px solid ${accent}`,
            [`border${cx ? 'Right' : 'Left'}`]: `1px solid ${accent}`,
            opacity: 0.75,
          },
        })),
        h('div', {
          onPointerDown: onHeaderDown,
          onPointerMove: onHeaderMove,
          onPointerUp: onHeaderUp,
          onPointerLeave: onHeaderUp,
          style: {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 10px',
            cursor: 'grab',
            background: 'linear-gradient(180deg, rgba(47,57,72,.55), rgba(21,26,35,.2))',
            borderBottom: `1px solid ${accent}`,
            userSelect: 'none',
            touchAction: 'none',
          },
        },
          h('span', {
            style: { width: '6px', height: '6px', borderRadius: '50%', background: accent, boxShadow: `0 0 8px ${accent}`, flex: '0 0 auto' },
          }),
          h('span', {
            style: {
              fontSize: '10px', letterSpacing: '1.4px', textTransform: 'uppercase',
              color: 'var(--dsw-alias-label-primary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            },
          }, title),
          summary
            ? h('span', {
                style: {
                  fontSize: '10px', color: 'var(--dsw-alias-label-secondary)', flex: '1 1 auto',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'right',
                },
              }, summary)
            : null,
          h('span', {
            style: { fontSize: '9px', color: 'var(--dsw-alias-label-secondary)', flex: '0 0 auto' },
          }, collapsed ? '展开' : '收起'),
          h('button', {
            type: 'button',
            className: 'wb-btn',
            title: collapsed ? 'expand' : 'collapse',
            onClick: () => {
              const next = !collapsed
              setCollapsed(next)
              persist(pos, next)
            },
            style: { background: 'none', border: 'none', color: 'var(--dsw-alias-label-secondary)', cursor: 'pointer', fontSize: '12px', padding: '0 2px' },
          }, collapsed ? '▸' : '▾')),
        collapsed ? null : h('div', { style: { padding: '10px 12px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' } }, node))
    }


    /**
     * The team canvas.
     *
     * Cards are floating DOM nodes over an SVG that draws only the edges: a
     * node you can drag needs real hit testing and real text selection, which
     * SVG text cannot give. Positions are view state (localStorage), never
     * ledger state — the log records facts, not where a card sits.
     */
    function TeamGraphCard(props) {
      // `project` owns identity (the saved layout key); `scope` owns the cards.
      // Reading roots off the project put every job's cards in one cockpit, so
      // one job's graph showed another job's labels again.
      const { t, project, scope = project, panels = [], fill = false } = props
      const [expanded, setExpanded] = useState({})
      const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
      const [positions, setPositions] = useState({})
      const [size, setSize] = useState({ w: 0, h: 0 })
      // Bump when the tidy layout changes: saved drags from an older layout
      // would otherwise land on top of the new default positions.
      const LAYOUT_VERSION = 2
      // One saved layout per job: two jobs in the same project have disjoint
      // task ids but share the "+N more" lane cards, so the key has to carry
      // the job id or dragging one job's overflow card moves the other's.
      const storageKey = `workbench:positions:v${LAYOUT_VERSION}:${project.id}:${scope.id ?? ''}`
      const viewportRef = useRef(null)
      const dragRef = useRef(null)
      const layout = teamGraph(scope, { expanded })

      useEffect(() => {
        setPositions(readPositions(storageKey))
      }, [storageKey])

      const cardAt = card => positions[card.id] || { x: card.x, y: card.y }
      const cards = layout.cards
      const root = layout.root

      // The canvas grows with whatever was dragged outside the tidy layout.
      let maxX = root.x + root.w
      let maxY = root.y + root.h
      for (const card of cards) {
        const at = cardAt(card)
        maxX = Math.max(maxX, at.x + card.w)
        maxY = Math.max(maxY, at.y + card.h)
      }
      const world = { width: Math.max(layout.width, maxX + 24), height: Math.max(layout.height, maxY + 24) }

      const clamp = value => Math.min(3, Math.max(0.35, value))
      const fit = useCallback(() => {
        const node = viewportRef.current
        if (node === null) return
        const rect = node.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return
        setSize({ w: rect.width, h: rect.height })
        // With the conversation column open the canvas is narrower: insetting
        // for the panels would push the scene underneath them and hide cards.
        const roomForPanels = panels.length > 0 && rect.width >= 1100
        const insetLeft = roomForPanels ? 300 : 20
        const insetRight = roomForPanels ? 340 : 20
        const available = Math.max(160, rect.width - insetLeft - insetRight)
        const scale = Math.min(1, Math.max(0.3, (available - 24) / world.width))
        setView({
          scale,
          x: Math.max(8, insetLeft + (available - world.width * scale) / 2),
          y: 12,
        })
      }, [world.width, world.height, panels.length])

      useEffect(() => {
        fit()
        const node = viewportRef.current
        if (node === null || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(() => fit())
        observer.observe(node)
        return () => observer.disconnect()
      }, [fit])

      useEffect(() => {
        const node = viewportRef.current
        if (node === null) return undefined
        const onWheel = event => {
          if (event.deltaY === 0) return
          event.preventDefault()
          setView(current => {
            const scale = clamp(current.scale * (event.deltaY > 0 ? 0.9 : 1.1))
            const cx = world.width / 2
            const cy = world.height / 2
            return { scale, x: current.x + cx * (current.scale - scale), y: current.y + cy * (current.scale - scale) }
          })
        }
        node.addEventListener('wheel', onWheel, { passive: false })
        return () => node.removeEventListener('wheel', onWheel)
      }, [world.width, world.height])

      /** Screen delta → world delta. Dragging must feel 1:1 at any zoom. */
      const worldDelta = (dx, dy) => ({ x: dx / view.scale, y: dy / view.scale })
      const snap = value => Math.round(value / SNAP) * SNAP

      const beginDrag = (event, payload) => {
        if (event.button !== 0) return
        event.stopPropagation()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        const rect = viewportRef.current?.getBoundingClientRect()
        dragRef.current = {
          ...payload,
          startX: event.clientX,
          startY: event.clientY,
          worldX: rect ? (event.clientX - rect.left - view.x) / view.scale : 0,
          worldY: rect ? (event.clientY - rect.top - view.y) / view.scale : 0,
        }
      }

      const onPointerDown = event => {
        if (event.button !== 0 || dragRef.current !== null) return
        dragRef.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, ox: view.x, oy: view.y }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }

      const onPointerMove = event => {
        const drag = dragRef.current
        if (drag === null) return
        if (drag.kind === 'pan') {
          setView(current => ({ ...current, x: drag.ox + (event.clientX - drag.startX), y: drag.oy + (event.clientY - drag.startY) }))
          return
        }
        const { x: dx, y: dy } = worldDelta(event.clientX - drag.startX, event.clientY - drag.startY)
        if (drag.kind === 'card') {
          setPositions(current => ({ ...current, [drag.id]: { x: snap(drag.origin.x + dx), y: snap(drag.origin.y + dy) } }))
          return
        }
        if (drag.kind === 'lane') {
          setPositions(current => {
            const next = { ...current }
            for (const [id, origin] of Object.entries(drag.origins)) {
              next[id] = { x: snap(origin.x + dx), y: snap(origin.y + dy) }
            }
            return next
          })
        }
      }

      const endDrag = event => {
        if (dragRef.current === null) return
        if (dragRef.current.kind !== 'pan') writePositions(storageKey, positions)
        dragRef.current = null
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }

      const resetPositions = () => {
        setPositions({})
        writePositions(storageKey, {})
        fit()
      }

      const toggleLane = owner => setExpanded(current => ({ ...current, [owner]: !current[owner] }))

      const statusText = status => {
        if (status === 'done') return t('boardDone')
        if (status === 'active') return t('boardRunning')
        if (status === 'failed') return t('boardFailed')
        return t('boardQueued')
      }
      const shorten = (text, limit) => {
        const value = String(text ?? '')
        return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
      }
      const touchTarget = {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '32px',
        minHeight: '32px',
        boxSizing: 'border-box',
        lineHeight: 1,
        touchAction: 'manipulation',
      }
      const zoomButton = { ...s.badge, ...touchTarget, cursor: 'pointer', padding: '7px 12px', fontSize: '12px' }
      const cardStyle = color => ({
        position: 'absolute',
        boxSizing: 'border-box',
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        padding: '8px 10px',
        cursor: 'grab',
        userSelect: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        overflow: 'hidden',
        boxShadow: '0 2px 10px rgba(0,0,0,.18)',
        borderLeft: `3px solid ${color}`,
      })

      const lanes = new Map()
      for (const card of cards) {
        const list = lanes.get(card.owner) || []
        list.push(card)
        lanes.set(card.owner, list)
      }

      return h(
        'div',
        {
          style: {
            ...s.card,
            gap: '8px',
            boxSizing: 'border-box',
            // Embedded in the project page the canvas fills the page column and
            // the page owns the height; standalone it keeps its 80% width.
            ...(fill
              ? { width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }
              : { width: '80%', minWidth: '320px', alignSelf: 'center' }),
          },
        },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
          h('h2', { style: { ...s.sectionTitle, margin: 0, letterSpacing: '1.4px' } }, t('boardFlow')),
          h('span', { style: { ...s.stageMeta, letterSpacing: '1px' } }, t('boardCockpit'))),
        h('style', { key: 'graph-css' }, GRAPH_CSS),
        h('div', {
          ref: viewportRef,
          onPointerDown,
          onPointerMove,
          onPointerUp: endDrag,
          onPointerLeave: endDrag,
          style: {
            position: 'relative',
            height: fill ? '100%' : '420px',
            overflow: 'hidden',
            touchAction: 'none',
            cursor: dragRef.current && dragRef.current.kind === 'pan' ? 'grabbing' : 'grab',
            backgroundColor: 'var(--dsw-alias-bg-base)',
            // The grid belongs to the viewport: it always fills the frame, and
            // its offset/size follow the view so the dots pan and zoom with the
            // content instead of stopping where the graph ends.
            backgroundImage:
              'radial-gradient(circle, var(--dsw-alias-border-l2) 1px, transparent 1px),'
              + 'radial-gradient(ellipse at 50% 0%, rgba(79,140,255,.12), transparent 62%)',
            backgroundSize: `${16 * view.scale}px ${16 * view.scale}px, 100% 100%`,
            backgroundPosition: `${view.x}px ${view.y}px, 0 0`,
            borderRadius: '8px',
            border: '1px solid var(--dsw-alias-border-l1)',
          },
        },
          h('div', {
            style: {
              position: 'absolute',
              left: 0,
              top: 0,
              width: `${world.width}px`,
              height: `${world.height}px`,
              transformOrigin: '0 0',
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            },
          },
            // edges first, nodes above them
            h('svg', {
              viewBox: `0 0 ${world.width} ${world.height}`,
              width: world.width,
              height: world.height,
              style: { position: 'absolute', left: 0, top: 0, display: 'block', pointerEvents: 'none' },
            },
              h('defs', { key: 'defs' }, null),
              h('g', { key: 'edges' }, cards.map(card => {
                const at = cardAt(card)
                const fromX = root.x + root.w / 2
                const fromY = root.y + root.h
                const toX = at.x
                const toY = at.y + card.h / 2
                const blocked = card.blocked > 0
                return h('path', {
                  key: `e-${card.id}`,
                  d: `M ${fromX} ${fromY} C ${fromX} ${fromY + 40}, ${toX - 40} ${toY}, ${toX - 4} ${toY}`,
                  className: ['wb-edge', card.status === 'active' ? 'wb-edge-active' : '', blocked ? 'wb-edge-blocked' : ''].filter(Boolean).join(' '),
                  // Also as an attribute, so an edge stays a line even if the
                  // stylesheet is not applied (SSR, a host that strips <style>).
                  fill: 'none',
                  stroke: card.color,
                  strokeWidth: card.status === 'active' ? 2 : 1.1,
                  opacity: card.status === 'active' ? 1 : blocked ? 0.4 : 0.6,
                })
              }))),

            // the lead card: the one node that anchors the picture
            h('div', {
              style: {
                ...cardStyle('var(--dsw-alias-brand-primary)'),
                left: `${root.x}px`,
                top: `${root.y}px`,
                width: `${root.w}px`,
                height: `${root.h}px`,
                justifyContent: 'center',
                border: '1px solid var(--dsw-alias-brand-primary)',
                boxShadow: '0 0 18px rgba(79,140,255,.28)',
                cursor: 'default',
              },
            },
              h('span', { style: { ...s.stageMeta, letterSpacing: '1px' } }, t('boardRoot')),
              h('span', { style: { fontSize: '14px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' } }, shorten(root.title, 22)),
              h('span', { style: s.stageMeta }, `${root.done}/${root.total}`)),

            // lane grips: drag the whole column, relative offsets preserved
            [...lanes.entries()].map(([owner, laneCards]) => {
              const minX = Math.min(...laneCards.map(card => cardAt(card).x))
              const minY = Math.min(...laneCards.map(card => cardAt(card).y))
              const busyLane = laneCards.some(card => card.status === 'active')
              const origins = Object.fromEntries(laneCards.map(card => [card.id, cardAt(card)]))
              return h('div', {
                key: `lane-${owner}`,
                role: 'button',
                tabIndex: 0,
                title: `${owner} · drag`,
                onPointerDown: event => beginDrag(event, { kind: 'lane', origins }),
                style: {
                  position: 'absolute',
                  left: `${minX}px`,
                  top: `${Math.max(0, minY - 34)}px`,
                  fontSize: '10px',
                  letterSpacing: '.5px',
                  color: busyLane ? TEAM_COLORS[owner] || TEAM_FALLBACK_COLOR : 'var(--dsw-alias-label-secondary)',
                  background: busyLane ? 'rgba(79,140,255,.12)' : 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))',
                  border: `1px solid ${busyLane ? TEAM_COLORS[owner] || TEAM_FALLBACK_COLOR : 'var(--dsw-alias-border-l1)'}`,
                  borderRadius: '999px',
                  padding: '2px 8px',
                  cursor: 'grab',
                  whiteSpace: 'nowrap',
                  boxShadow: busyLane ? `0 0 10px ${TEAM_COLORS[owner] || TEAM_FALLBACK_COLOR}55` : 'none',
                },
              }, busyLane ? `⋮⋮ ${owner} · ${t('laneBusy')}` : `⋮⋮ ${owner}`)
            }),

            cards.map(card => {
              const at = cardAt(card)
              return h('div', {
                key: card.id,
                className: card.status === 'active' ? 'wb-card-active' : undefined,
                onPointerDown: event => beginDrag(event, { kind: 'card', id: card.id, origin: at }),
                onClick: card.expandable ? () => toggleLane(card.owner) : undefined,
                style: {
                  ...cardStyle(card.color),
                  left: `${at.x}px`,
                  top: `${at.y}px`,
                  width: `${card.w}px`,
                  height: `${card.h}px`,
                  borderColor: card.status === 'active' ? card.color : 'var(--dsw-alias-border-l1)',
                  cursor: card.expandable ? 'pointer' : 'grab',
                  opacity: card.overflow ? 0.72 : 1,
                },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                  h('span', { style: { width: '7px', height: '7px', borderRadius: '50%', flex: '0 0 auto', background: STATUS_COLOR[card.status] || STATUS_COLOR.todo } }),
                  h('span', { style: { fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, shorten(card.title, 19))),
                h('span', { style: { ...s.stageMeta, fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  card.status === 'active' && card.note
                    ? `${card.note}`
                    : card.expandable
                      ? `${card.owner} · ${t('boardExpand')}`
                      : `${card.owner} · ${statusText(card.status)}${card.blocked ? ` · ⛔${card.blocked}` : ''}`))
            })),

            // HUD panels last: they sit above nodes and keep their screen size
            // while the scene zooms underneath.
            // Cockpit control cluster: bottom-right, over the canvas.
            h('div', {
              style: {
                position: 'absolute', right: '12px', bottom: '12px', display: 'flex', gap: '6px', alignItems: 'center',
                background: 'rgba(13,16,23,.72)', backdropFilter: 'blur(6px)',
                border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '999px', padding: '4px 8px',
                zIndex: 7,
              },
            },
              h('button', { type: 'button', className: 'wb-btn', style: zoomButton, title: 'zoom out', onClick: () => setView(v => ({ ...v, scale: clamp(v.scale * 0.9) })) }, '−'),
              h('span', { style: { ...s.stageMeta, minWidth: '34px', textAlign: 'center' } }, `${Math.round(view.scale * 100)}%`),
              h('button', { type: 'button', className: 'wb-btn', style: zoomButton, title: 'zoom in', onClick: () => setView(v => ({ ...v, scale: clamp(v.scale * 1.1) })) }, '+'),
              h('button', { type: 'button', className: 'wb-btn', style: zoomButton, title: 'fit', onClick: fit }, t('boardFit')),
              h('button', { type: 'button', className: 'wb-btn', style: zoomButton, title: 'relayout', onClick: resetPositions }, t('boardRelayout'))),

            panels.map(panel => {
              const width = panel.width || 280
              // Before the first measurement (and in non-browser renderers)
              // fall back to the window width, so a right-docked panel never
              // starts stacked on top of the left column.
              const canvasWidth = size.w > 0
                ? size.w
                : Math.max(320, (typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1200) * 0.8 - 40)
              return h(FloatingPanel, {
                key: panel.id,
                t,
                projectId: project.id,
                panelId: panel.id,
                defaultCollapsed: panel.defaultCollapsed === true,
                title: panel.title,
                node: panel.node,
                accent: panel.accent,
                summary: panel.summary,
                width,
                bounds: { w: canvasWidth, h: size.h },
                // Docking is computed from the measured viewport, so a narrow
                // window still puts the right-hand column inside the canvas.
                defaultPos: {
                  x: panel.dock === 'right' ? Math.max(12, canvasWidth - width - 12) : 12,
                  y: panel.y ?? 12,
                },
              })
            })),

      )
    }

    /** The project as a user meets it: what it delivers, and where its tasks are. */
    function ProjectHome(props) {
      const { t, project, onBack, onOpenTasks, onNewTask, backLabel } = props
      const artifacts = Array.isArray(project.artifacts) ? project.artifacts : []
      const jobs = Array.isArray(project.jobs) ? project.jobs : []
      const progress = project.progress || { done: 0, total: 0 }
      // The project line can say "paused" while one of its jobs was resumed:
      // the aggregate is the honest answer for the project chip.
      const statuses = jobs.map(job => job.status)
      const aggregate = project.status === 'cancelled' ? t('statusCancelled')
        : statuses.some(status => status === 'started') ? t('statusRunning')
        : statuses.some(status => status === 'paused') ? t('statusPaused')
        : statuses.length > 0 && statuses.every(status => status === 'done') ? t('boardDone')
        : project.status === 'paused' ? t('statusPaused')
        : t('statusRunning')
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h('button', {
            type: 'button', className: 'wb-btn',
            style: { ...s.badge, cursor: 'pointer', padding: '6px 12px', minHeight: '32px', display: 'inline-flex', alignItems: 'center' },
            onClick: onBack,
          }, backLabel ?? t('backToCards')),
          h('span', { style: { ...s.title, fontSize: '18px' } }, project.title || project.id),
          h('span', { style: s.badge }, t('deliverablePage')),
          h('span', { style: s.badge }, aggregate),
          h('span', { style: s.badge }, `${progress.done}/${progress.total}`),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '6px' } },
            h('button', {
              type: 'button', className: 'wb-btn',
              style: { ...s.badge, cursor: 'pointer', padding: '6px 14px', minHeight: '32px', display: 'inline-flex', alignItems: 'center' },
              onClick: onOpenTasks,
            }, `${t('tabTasks')} · ${jobs.length}`),
            h('button', {
              type: 'button', className: 'wb-btn',
              style: { ...s.button, padding: '6px 14px' },
              onClick: onNewTask,
            }, `＋ ${t('newJob')}`))),

        h('p', { style: s.muted }, t('projectHomeHint')),

        h('div', { style: s.card },
          h('h2', { style: s.sectionTitle }, t('deliverableTitle')),
          artifacts.length === 0
            ? h(Empty, { text: t('noArtifacts') })
            : h('ul', { style: s.list }, artifacts.map(path => h('li', { key: path, style: s.row },
                h('span', { style: { fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, path))))))
    }

    /**
     * Secondary action button. Sized explicitly (never inherit a dot's box),
     * with nowrap text so a two-character label cannot stack vertically.
     */
    const subtleButton = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '4px',
      flex: '0 0 auto',
      minWidth: '52px',
      height: '28px',
      padding: '0 10px',
      borderRadius: '6px',
      background: 'var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1))',
      border: '1px solid var(--dsw-alias-border-l2)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: '12px',
      fontWeight: 500,
      lineHeight: '1',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
    }
    const fieldStyle = {
      width: '100%',
      boxSizing: 'border-box',
      padding: '8px 10px',
      borderRadius: '8px',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: '13px',
    }

    /** Jobs as cards: one planning run each, each with its own cockpit. */
    function TaskList(props) {
      const { t, project, onBack, onOpenJob, onNewTask } = props
      const jobs = Array.isArray(project.jobs) ? project.jobs : []
      const titleOf = id => (jobs.find(job => job.id === id) || {}).title || id
      const childCount = id => jobs.filter(job => job.parentJobId === id).length
      const statusOf = (job) => job.status === 'paused' ? t('statusPaused')
        : job.status === 'cancelled' ? t('statusCancelled')
        : job.status === 'done' ? t('boardDone')
        : ((job.running || 0) === 0 && (job.progress ? job.progress.done < job.progress.total : true)) ? t('statusPlanned')
        : t('statusRunning')
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h('button', {
            type: 'button', className: 'wb-btn',
            style: { ...s.badge, cursor: 'pointer', padding: '6px 12px', minHeight: '32px', display: 'inline-flex', alignItems: 'center' },
            onClick: onBack,
          }, t('backToProject')),
          h('span', { style: { ...s.title, fontSize: '18px' } }, `${project.title || project.id} · ${t('jobsTitle')}`),
          h('button', {
            type: 'button', className: 'wb-btn',
            style: { ...s.button, marginLeft: 'auto', padding: '6px 14px' },
            onClick: onNewTask,
          }, `＋ ${t('newJob')}`)),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' } },
          jobs.length === 0
            ? h(Empty, { text: t('jobsEmpty') })
            : jobs.map(job => {
                const progress = job.progress || { done: 0, total: 0 }
                const done = job.status === 'done'
                const cancelled = job.status === 'cancelled'
                const paused = job.status === 'paused'
                const artifacts = Array.isArray(job.artifacts) ? job.artifacts : []
                // Completed is a state, not a percentage: lead with the result
                // instead of repeating "14/14 完成 · 已完成".
                const accent = done ? STATUS_COLOR.done : cancelled ? STATUS_COLOR.blocked : paused ? STATUS_COLOR.waiting : 'var(--dsw-alias-brand-primary)'
                return h('button', {
                  key: job.id,
                  type: 'button',
                  className: 'wb-card wb-btn',
                  onClick: () => onOpenJob(job.id),
                  style: {
                    ...s.card,
                    textAlign: 'left', cursor: 'pointer', gap: '8px',
                    minHeight: '108px', justifyContent: 'space-between',
                    borderLeft: `3px solid ${accent}`,
                  },
                },
                  h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                    h('span', {
                      style: {
                        width: '18px', height: '18px', borderRadius: '50%', flex: '0 0 auto',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '11px', fontWeight: 700,
                        color: done ? '#0d1017' : accent,
                        background: done ? accent : 'transparent',
                        border: `1px solid ${accent}`,
                      },
                    }, done ? '✓' : cancelled ? '✕' : paused ? '❚❚' : '●'),
                    h('span', {
                      style: {
                        ...s.stageName, fontSize: '14px', overflow: 'hidden', whiteSpace: 'normal',
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      },
                    }, job.title || job.id),
                    h('span', {
                      style: {
                        marginLeft: 'auto', flex: '0 0 auto', fontSize: '10px', letterSpacing: '.6px',
                        color: accent, textTransform: 'uppercase',
                      },
                    }, statusOf(job))),
                  job.requirement && !done
                    ? h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
                        h('span', {
                          style: { ...s.badge, color: accent === STATUS_COLOR.done ? accent : 'var(--dsw-alias-brand-primary)', borderColor: accent === STATUS_COLOR.done ? accent : 'var(--dsw-alias-brand-primary)' },
                        }, job.planBy ? t('autoRunning') : t('autoPlanning')),
                        (job.gates || []).length
                          ? h('span', { style: { ...s.badge, color: STATUS_COLOR.waiting, borderColor: STATUS_COLOR.waiting } }, t('autoWaiting'))
                          : null)
                    : null,
                  (job.parentJobId || childCount(job.id) > 0)
                    ? h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
                        job.parentJobId ? h('span', { style: s.badge }, `${t('taskFrom')} ${titleOf(job.parentJobId)}`) : null,
                        childCount(job.id) > 0 ? h('span', { style: s.badge }, t('taskFollowUps').replace('{n}', String(childCount(job.id)))) : null)
                    : null,
                  h('span', { style: { ...s.stageMeta, fontSize: '11px' } }, done
                    ? t('taskDoneMeta').replace('{items}', String(job.totals?.done ?? progress.done)).replace('{files}', String(artifacts.length))
                    : `${progress.done}/${progress.total} ${t('boardProgress')}${job.totals && job.totals.blocked ? ` · ${job.totals.blocked} ${t('boardBlocked')}` : ''}${(job.gates || []).length ? ` · ${job.gates.length} ${t('boardWaiting')}` : ''}`),
                  done
                    ? null
                    : h('div', { style: s.meter },
                        h('span', { style: { ...s.meterFill, background: accent, width: `${progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100)}%` } })),
                  (() => {
                    const tokens = (Number(job.tokens?.inputTokens) || 0) + (Number(job.tokens?.outputTokens) || 0)
                    if (tokens <= 0) return null
                    const cost = Number(job.costUsd) || 0
                    return h('span', { style: { ...s.stageMeta, fontSize: '11px' } },
                      `${tokens} ${t('tokensUsed')}${cost > 0 ? ` · $${cost.toFixed(4)}` : ''}`)
                  })(),
                  h('span', { style: { ...s.stageMeta, color: done ? accent : 'var(--dsw-alias-label-secondary)' } }, done ? t('taskOpenDone') : t('taskOpenCockpit')))
              })))
    }

    /**
     * The task's conversation, inside the cockpit.
     *
     * Design: a drawer rather than a second page, because the point of binding
     * a conversation to a task is that you can watch the board and the chat at
     * the same time. Sending and reading go through the host's session API; the
     * panel never owns the transcript.
     */
    function JobConversation(props) {
      const { t, job, bridge, onConfig, onClose, onNeedWorkspace, overlay = false } = props
      const [messages, setMessages] = useState([])
      const [loading, setLoading] = useState(Boolean(job.sessionId))
      const [error, setError] = useState(null)
      const [draft, setDraft] = useState('')
      const [busy, setBusy] = useState(false)
      const [sessions, setSessions] = useState(null)
      const [picking, setPicking] = useState(false)
      const [workspaceBusy, setWorkspaceBusy] = useState(false)
      const [images, setImages] = useState([])
      const [attachError, setAttachError] = useState(null)
      const transcriptRef = useRef(null)
      const fileRef = useRef(null)

      const addFiles = useCallback(async files => {
        setAttachError(null)
        const picked = Array.from(files || []).filter(file => file && String(file.type).startsWith('image/'))
        if (picked.length === 0) {
          if (files && files.length > 0) setAttachError(t('attachOnlyImages'))
          return
        }
        const tooBig = picked.find(file => file.size > 8 * 1024 * 1024)
        if (tooBig) { setAttachError(t('attachTooBig')); return }
        const converted = []
        for (const file of picked) {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(reader.error)
            reader.readAsDataURL(file)
          })
          converted.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            name: file.name || 'image.png',
            mediaType: file.type,
            size: file.size,
            dataUrl,
          })
        }
        setImages(current => {
          const next = [...current, ...converted]
          if (next.length > 4) { setAttachError(t('attachLimit')); return next.slice(0, 4) }
          return next
        })
      }, [t])

      const workspace = job.workspace || null
      const workspaceId = job.workspaceId || null

      // Workspace first: a conversation belongs to a DSH workspace, so the id
      // is resolved (and stored) before any session is listed or created.
      useEffect(() => {
        if (!workspace || workspaceId || !bridge || !bridge.available()) return undefined
        let live = true
        setWorkspaceBusy(true)
        bridge.resolveWorkspace(workspace)
          .then(id => { if (live && id) return onConfig({ workspaceId: id }) })
          .catch(failure => { if (live) setError(String(failure?.message ?? failure)) })
          .finally(() => { if (live) setWorkspaceBusy(false) })
        return () => { live = false }
      }, [workspace, workspaceId, bridge, onConfig])

      const load = useCallback(async () => {
        if (!job.sessionId || !bridge) { setLoading(false); return }
        setLoading(true)
        setError(null)
        try {
          setMessages(await bridge.transcript(job.sessionId))
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setLoading(false)
        }
      }, [bridge, job.sessionId])

      useEffect(() => { load() }, [load])
      useEffect(() => {
        if (!job.sessionId) return undefined
        const timer = setInterval(load, 3000)
        return () => clearInterval(timer)
      }, [job.sessionId, load])

      // Follow the tail: a transcript that opens at the top of an old message
      // is the wrong place to be when you are watching work happen.
      useEffect(() => {
        const node = transcriptRef.current
        if (node === null) return
        node.scrollTop = node.scrollHeight
      }, [messages.length, job.sessionId])

      const startNew = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const created = await bridge.create(workspace)
          const id = typeof created === 'string' ? created : created?.id ?? created?.sessionId
          if (!id) throw new Error('宿主没有返回 sessionId')
          await onConfig({ sessionId: id })
          setMessages([])
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy(false)
        }
      }, [bridge, workspace, onConfig])

      const pick = useCallback(async () => {
        setPicking(true)
        setError(null)
        try {
          setSessions(await bridge.list(workspaceId))
        } catch (failure) {
          setError(String(failure?.message ?? failure))
          setSessions([])
        }
      }, [bridge, workspaceId])

      const bind = useCallback(async id => {
        setPicking(false)
        await onConfig({ sessionId: id })
      }, [onConfig])

      const send = useCallback(async () => {
        const text = draft.trim()
        if ((text === '' && images.length === 0) || !job.sessionId) return
        setBusy(true)
        setError(null)
        try {
          await bridge.send(job.sessionId, text, images)
          setDraft('')
          setImages([])
          await load()
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy(false)
        }
      }, [bridge, draft, images, job.sessionId, load])

      const header = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
        h('span', { style: { ...s.sectionTitle, fontSize: '12px', letterSpacing: '1px' } }, t('convoTitle')),
        job.sessionId ? h('span', { style: { ...s.badge, color: STATUS_COLOR.done } }, t('convoBound')) : null,
        h('button', {
          type: 'button', className: 'wb-btn',
          title: t('cancel'),
          style: { ...subtleButton, marginLeft: 'auto', minWidth: '24px', width: '24px', height: '24px', padding: 0, fontSize: '14px', lineHeight: '1' },
          onClick: onClose,
        }, '×'))

      const workspaceLine = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', borderBottom: '1px solid var(--dsw-alias-border-l1)', paddingBottom: '6px' } },
        h('span', { style: s.stageMeta }, t('convoWorkspace')),
        h('span', { style: { display: 'block', maxWidth: '100%', fontSize: '11px', color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
          workspace || t('convoNeedWorkspace')),
        workspaceId
          ? h('span', { style: s.stageMeta }, `${t('convoWorkspaceId')} ${workspaceId.slice(0, 12)}`)
          : workspaceBusy
            ? h('span', { style: s.stageMeta }, t('convoResolving'))
            : null)

      let body = null
      if (!bridge || !bridge.available()) {
        body = h(Empty, { text: t('convoUnavailable') })
      } else if (!workspace) {
        body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          h(Empty, { text: t('convoNeedWorkspace') }),
          h('button', { type: 'button', className: 'wb-btn', style: { ...s.button, padding: '6px 12px', alignSelf: 'flex-start' }, onClick: onNeedWorkspace }, t('workspaceButton')))
      } else if (!workspaceId) {
        body = h(Empty, { text: t('convoResolving') })
      } else if (picking) {
        const rows = sessions === null
          ? [h(Empty, { key: 'loading', text: t('loading') })]
          : sessions.length === 0
            ? [h(Empty, { key: 'none', text: t('convoNone') })]
            : sessions.map(item => h('div', {
                key: item.id,
                role: 'button',
                tabIndex: 0,
                className: 'wb-session-row',
                style: {
                  display: 'flex', alignItems: 'baseline', gap: '8px',
                  padding: '6px 8px', borderRadius: '6px',
                  background: 'var(--dsw-alias-bg-layer-1)',
                  border: '1px solid var(--dsw-alias-border-l1)',
                  cursor: 'pointer', textAlign: 'left', fontSize: '12px', lineHeight: '1.5',
                },
                onClick: () => bind(item.id),
              },
                h('span', { style: { color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto' } },
                  item.title === '' ? `${t('convoUntitled')} ${item.id.slice(0, 8)}` : item.title),
                h('span', { style: { ...s.stageMeta, flex: '0 0 auto' } }, item.id.slice(0, 6))))
        body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          h('span', { style: s.stageMeta }, t('convoPick')),
          h('div', { style: { display: 'flex', gap: '6px' } },
            h('button', { type: 'button', className: 'wb-btn', style: { ...s.badge, cursor: 'pointer' }, onClick: pick }, t('convoRefresh')),
            h('button', { type: 'button', className: 'wb-btn', style: { ...s.badge, cursor: 'pointer' }, onClick: () => setPicking(false) }, t('cancel'))),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '220px', overflowY: 'auto' } }, rows))
      } else if (!job.sessionId) {
        body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          h(Empty, { text: t('convoNone') }),
          h('div', { style: { display: 'flex', gap: '6px' } },
            h('button', { type: 'button', className: 'wb-btn', disabled: busy, style: { ...s.button, padding: '6px 12px' }, onClick: startNew }, busy ? t('convoSending') : t('convoNew')),
            h('button', { type: 'button', className: 'wb-btn', style: { ...s.badge, cursor: 'pointer' }, onClick: pick }, t('convoBind'))))
      } else {
        body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 auto', minHeight: 0 } },
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
            h('button', { type: 'button', className: 'wb-btn', style: { ...subtleButton, height: '26px', fontSize: '11px' }, onClick: () => bridge.open(job.sessionId).catch(failure => setError(String(failure?.message ?? failure))) }, t('convoInDsh')),
            h('button', { type: 'button', className: 'wb-btn', style: { ...subtleButton, height: '26px', fontSize: '11px' }, onClick: pick }, t('convoBind')),
            h('button', { type: 'button', className: 'wb-btn', style: { ...subtleButton, height: '26px', fontSize: '11px' }, onClick: () => onConfig({ sessionId: null }) }, t('convoUnbind'))),
          h('div', { ref: transcriptRef, style: { flex: '1 1 auto', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', minHeight: '0px', scrollBehavior: 'smooth' } },
            loading && messages.length === 0
              ? h(Empty, { text: t('convoLoading') })
              : messages.length === 0
                ? h(Empty, { text: t('convoEmpty') })
                : messages.map((message, index) => h('div', {
                    key: `${index}-${message.role}`,
                    style: {
                      fontSize: '11px', lineHeight: '1.6', padding: '6px 8px', borderRadius: '8px',
                      background: message.role === 'user' ? 'rgba(79,140,255,.14)' : 'var(--dsw-alias-bg-layer-1)',
                      border: '1px solid var(--dsw-alias-border-l1)',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    },
                  }, message.text))),
          attachError ? h('p', { style: s.error }, attachError) : null,
          images.length > 0
            ? h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
                images.map(image => h('div', {
                  key: image.id,
                  style: {
                    position: 'relative', width: '52px', height: '52px', borderRadius: '6px',
                    border: '1px solid var(--dsw-alias-border-l2)', overflow: 'hidden',
                    background: 'var(--dsw-alias-bg-base)',
                  },
                },
                  h('img', { src: image.dataUrl, alt: image.name, style: { width: '100%', height: '100%', objectFit: 'cover' } }),
                  h('button', {
                    type: 'button', className: 'wb-btn',
                    title: t('cancel'),
                    style: {
                      position: 'absolute', top: '2px', right: '2px', width: '16px', height: '16px',
                      borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
                      background: 'rgba(0,0,0,.65)', color: '#fff', fontSize: '11px', lineHeight: '16px',
                    },
                    onClick: () => setImages(current => current.filter(item => item.id !== image.id)),
                  }, '×'))))
            : null,
          h('div', { style: { display: 'flex', gap: '6px' } },
            h('input', { ref: fileRef, type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' }, onChange: event => addFiles(event.target.files) }),
            h('button', {
              type: 'button', className: 'wb-btn', title: t('attachHint'),
              style: { ...subtleButton, height: '32px', minWidth: '34px' },
              onClick: () => fileRef.current && fileRef.current.click(),
            }, '🖼'),
            h('input', {
              value: draft, placeholder: t('convoPlaceholder'), style: { ...fieldStyle, flex: '1 1 auto', height: '32px' },
              onInput: event => setDraft(event.target.value),
              onKeyDown: event => { if (event.key === 'Enter' && !event.shiftKey) send() },
              onPaste: event => {
                const items = event.clipboardData && event.clipboardData.items ? Array.from(event.clipboardData.items) : []
                const files = items.filter(item => item.kind === 'file' && String(item.type).startsWith('image/')).map(item => item.getAsFile()).filter(Boolean)
                if (files.length > 0) { event.preventDefault(); addFiles(files) }
              },
              onDrop: event => {
                const files = event.dataTransfer && event.dataTransfer.files ? Array.from(event.dataTransfer.files) : []
                if (files.some(file => String(file.type).startsWith('image/'))) { event.preventDefault(); addFiles(files) }
              },
            }),
            h('button', { type: 'button', className: 'wb-btn', disabled: busy, style: { ...s.button, padding: '6px 12px' }, onClick: send }, busy ? t('convoSending') : t('convoSend'))))
      }

      return h('div', {
        style: overlay
          ? {
              position: 'absolute', top: '44px', right: '8px', bottom: '8px', width: '380px',
              display: 'flex', flexDirection: 'column', gap: '8px',
              background: 'linear-gradient(180deg, rgba(20,25,34,.98), rgba(13,16,23,.98))',
              border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px',
              boxShadow: '0 12px 40px rgba(0,0,0,.5)', zIndex: 20, padding: '10px',
            }
          : {
              display: 'flex', flexDirection: 'column', gap: '8px',
              width: '100%', height: '100%', boxSizing: 'border-box',
              background: 'var(--dsw-alias-bg-layer-1)',
              border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '10px',
              padding: '10px', overflow: 'hidden',
            },
      },
        header,
        workspaceLine,
        error ? h('p', { style: s.error }, error) : null,
        body)
    }

    function JobWorkspaceDialog(props) {
      const { t, job, bridge, onCancel, onSave } = props
      const [list, setList] = useState(null)
      const [selected, setSelected] = useState(job.workspaceId ?? null)
      const [creating, setCreating] = useState(false)
      const [name, setName] = useState('')
      const [path, setPath] = useState(job.workspace ?? '')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)

      const load = useCallback(async () => {
        if (!bridge || typeof bridge.workspaceList !== 'function') { setList([]); return }
        try {
          setList(await bridge.workspaceList())
        } catch (failure) {
          setError(String(failure?.message ?? failure))
          setList([])
        }
      }, [bridge])
      useEffect(() => { load() }, [load])

      const save = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const entry = (list ?? []).find(item => item.id === selected)
          if (!entry) throw new Error(t('workspacePickOne'))
          await onSave({ id: entry.id, path: entry.path })
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy(false)
        }
      }, [list, selected, onSave, t])

      const create = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
          const created = await bridge.createWorkspace({ path: path.trim(), title: name.trim() })
          await load()
          setSelected(created.id)
          setCreating(false)
          setName('')
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy(false)
        }
      }, [bridge, name, path, load])

      return h(Dialog, {
        title: t('workspaceTitle'),
        error,
        busy,
        confirmLabel: t('workspaceSave'),
        cancelLabel: t('cancel'),
        onCancel,
        onConfirm: save,
      },
        h('p', { style: s.muted }, t('workspaceHint')),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' } },
          h('span', { style: { ...s.stageMeta, letterSpacing: '.8px' } }, t('workspaceExisting')),
          list === null
            ? h(Empty, { text: t('loading') })
            : list.length === 0
              ? h(Empty, { text: t('workspaceEmpty') })
              : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '200px', overflowY: 'auto' } },
                  list.map(item => {
                    const active = selected === item.id
                    return h('div', {
                      key: item.id,
                      role: 'radio',
                      'aria-checked': active ? 'true' : 'false',
                      tabIndex: 0,
                      style: {
                        display: 'flex', alignItems: 'baseline', gap: '8px', padding: '7px 10px',
                        borderRadius: '6px', cursor: 'pointer', fontSize: '12px', lineHeight: '1.5',
                        border: `1px solid ${active ? 'var(--dsw-alias-brand-primary)' : 'var(--dsw-alias-border-l1)'}`,
                        background: active ? 'rgba(79,140,255,.14)' : 'var(--dsw-alias-bg-layer-1)',
                      },
                      onClick: () => setSelected(item.id),
                    },
                      h('span', { style: { color: 'var(--dsw-alias-label-primary)', flex: '0 0 auto' } }, active ? '●' : '○'),
                      h('span', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, item.title || item.id),
                      h('span', { style: { ...s.stageMeta, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' } }, item.path))
                  }))),
        creating
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' } },
              h('span', { style: { ...s.stageMeta, letterSpacing: '.8px' } }, t('workspaceNew')),
              h('input', { value: name, placeholder: t('workspaceName'), style: fieldStyle, onInput: event => setName(event.target.value) }),
              h('input', { value: path, placeholder: t('workspacePath'), style: fieldStyle, onInput: event => setPath(event.target.value) }),
              h('div', { style: { display: 'flex', gap: '6px' } },
                h('button', { type: 'button', className: 'wb-btn wb-primary', disabled: busy, style: { ...s.button, minHeight: '32px', padding: '0 14px' }, onClick: create }, t('workspaceCreate')),
                h('button', { type: 'button', className: 'wb-btn', style: subtleButton, onClick: () => setCreating(false) }, t('cancel'))))
          : h('button', { type: 'button', className: 'wb-btn', style: { ...subtleButton, alignSelf: 'flex-start', marginTop: '4px' }, onClick: () => setCreating(true) }, `＋ ${t('workspaceNew')}`))
    }

    /**
     * One project, as a canvas workspace.
     *
     * The canvas is the page; every other section floats above it as a HUD
     * panel. Priority order (left to right, top to bottom): what needs a
     * person, then progress, then the detail you only read occasionally.
     */
    function ProjectDetail(props) {
      const { t, project, job, summary: rawSummary, events: rawEvents, onBack, backLabel, onControl, onDecide, bridge, onJobConfig } = props
      // The cockpit belongs to one job; a legacy project without jobs renders
      // with the project itself as the scope.
      const scope = job || project
      const [dialogOpen, setDialogOpen] = useState(false)
      const [brief, setBrief] = useState('')
      const [busy, setBusy] = useState(false)
      const [draftError, setDraftError] = useState(null)
      const [started, setStarted] = useState(false)
      const [followUp, setFollowUp] = useState(null)
      const [kind, setKind] = useState('change')
      const [controlling, setControlling] = useState(false)
      const chatPrefKey = `workbench:chat:${project.id}`
      const chatPref = readPanelStore(chatPrefKey)
      const [execNotice, setExecNotice] = useState(null)
      const [execBusy, setExecBusy] = useState(false)
      const [convoOpen, setConvoOpen] = useState(chatPref ? chatPref.open === true : Boolean(job && job.sessionId))
      const setChatOpen = next => {
        setConvoOpen(next)
        writePanelStore(chatPrefKey, { x: 0, y: 0, open: next })
      }
      const [workspaceOpen, setWorkspaceOpen] = useState(false)
      const [layoutRef, layoutWidth] = useElementWidth()
      const railsKey = `workbench:rails:${project.id}`
      const storedRails = readPanelStore(railsKey)
      const [railsOpen, setRailsOpen] = useState(!(storedRails && storedRails.collapsed === true))
      const toggleRails = () => {
        setRailsOpen(current => {
          const next = !current
          writePanelStore(railsKey, { x: 0, y: 0, collapsed: !next })
          return next
        })
      }
      // Wide: two fixed columns. Narrow: the same panels become one drawer the
      // user explicitly opened — never a silent no-op and never covering by default.
      const railsColumns = layoutWidth === 0 || layoutWidth >= 1200
      const showRails = railsOpen && railsColumns
      // The split only makes sense when the surface is wide; below this the
      // conversation goes back to being a drawer.
      // Responsive plan (wireframing: desktop side-by-side, narrow stacked).
      // The panel is usually narrower than the window, so the side column must
      // appear well before 1024px — otherwise a normal desktop window silently
      // drops the conversation.
      const chatSide = layoutWidth === 0 || layoutWidth >= 760
      const knownSession = useRef(job ? job.sessionId : null)
      useEffect(() => {
        const next = job ? job.sessionId : null
        // A newly bound conversation should reveal itself once, then respect
        // the user's own open/closed choice.
        if (next && next !== knownSession.current) setConvoOpen(true)
        knownSession.current = next
      }, [job])

      const startTask = useCallback(async () => {
        setDraftError(null)
        if (!brief.trim()) {
          setDraftError(t('emptyBrief'))
          return
        }
        setBusy(true)
        try {
          const response = await fetch('/workbench/start', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              requirement: brief.trim(),
              projectId: project.id,
              ...(followUp ? { parentJobId: followUp.id, kind } : {}),
            }),
          })
          const body = await response.json().catch(() => null)
          if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
          setStarted(true)
          setBrief('')
          setDialogOpen(false)
        } catch (error) {
          setDraftError(String(error?.message ?? error))
        } finally {
          setBusy(false)
        }
      }, [brief, followUp, kind, project.id, t])
      const startExecution = useCallback(async () => {
        setExecNotice(null)
        const parentJob = job && job.parentJobId ? (project.jobs || []).find(item => item.id === job.parentJobId) : null
        const sessionId = (job && job.sessionId) || (parentJob && parentJob.sessionId) || null
        if (!bridge || typeof bridge.available !== 'function' || !bridge.available()) {
          setExecNotice(t('execNeedSession'))
          return
        }
        if (sessionId === null) {
          setExecNotice(t('execNeedSession'))
          setChatOpen(true)
          return
        }
        setExecBusy(true)
        try {
          await bridge.send(sessionId, t('execPrompt').replace('{jobId}', job.id))
          setExecNotice(t('execSent'))
        } catch (failure) {
          setExecNotice(String(failure?.message ?? failure))
        } finally {
          setExecBusy(false)
        }
      }, [bridge, job, project.jobs, t])


      const summary = rawSummary || {}
      const recentEvents = (Array.isArray(rawEvents) ? rawEvents : [])
        .filter(event => event.jobId === undefined || job === undefined || event.jobId === null || event.jobId === job.id)
      const totals = scope.totals || {}
      const progress = scope.progress || { done: 0, total: 0, ratio: 0 }
      const stages = Array.isArray(scope.stages) ? scope.stages : []
      const agents = Array.isArray(scope.agents) ? scope.agents : []
      const gates = Array.isArray(scope.gates) ? scope.gates : []
      const roots = Array.isArray(scope.roots) ? scope.roots : []
      const artifacts = Array.isArray(scope.artifacts) ? scope.artifacts : (Array.isArray(project.artifacts) ? project.artifacts : [])
      const scopeStatus = scope.status || project.status
      const running = scope.running || 0
      const activity = Array.isArray(scope.activity) ? scope.activity : []
      const ago = ts => {
        const at = Date.parse(ts ?? '')
        if (!Number.isFinite(at)) return ''
        const seconds = Math.max(0, Math.round((Date.now() - at) / 1000))
        if (seconds < 60) return `${seconds}s`
        const minutes = Math.round(seconds / 60)
        return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`
      }
      const activityNode = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
          h('span', {
            style: {
              width: '7px', height: '7px', borderRadius: '50%', background: STATUS_COLOR.done,
              boxShadow: `0 0 8px ${STATUS_COLOR.done}`,
              animation: running > 0 ? 'wb-glow 1.4s ease-in-out infinite' : 'none',
            },
          }),
          h('span', { style: { ...s.stageMeta, letterSpacing: '1.2px' } }, t('boardLive')),
          h('span', { style: s.stageMeta }, running > 0 ? `${running}` : t('activityEmpty'))),
        running === 0
          ? null
          : activity.map(item => h('div', {
              key: item.taskId,
              style: { display: 'flex', flexDirection: 'column', gap: '2px', borderLeft: '2px solid var(--dsw-alias-state-success-primary)', paddingLeft: '8px' },
            },
            h('div', { style: { display: 'flex', gap: '6px', alignItems: 'baseline' } },
              h('span', { style: { fontSize: '11px', color: 'var(--dsw-alias-label-primary)' } }, item.title || item.taskId),
              h('span', { style: { ...s.stageMeta, marginLeft: 'auto' } }, ago(item.lastActiveAt))),
            h('span', { style: { ...s.stageMeta, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              item.note || `${item.owner || 'agent'}`))))
      const statusChip = scopeStatus === 'paused' ? t('statusPaused')
        : scopeStatus === 'cancelled' ? t('statusCancelled')
        : scopeStatus === 'done' ? t('boardDone')
        : scopeStatus === 'failed' ? t('boardFailed')
        : t('statusRunning')
      const stageLabel = key => {
        const text = String(key || '')
        return t(`stage${text.charAt(0).toUpperCase()}${text.slice(1)}`)
      }
      const meter = (done, total) => h('div', { style: s.meter },
        h('span', { style: { ...s.meterFill, width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` } }))

      const renderTask = (task, depth) => {
        const children = Array.isArray(task.children) ? task.children : []
        return [
          h('div', { key: task.id, style: { ...s.treeRow, paddingLeft: `${depth * 12}px` } },
            h(StatusDot, { status: task.status }),
            h('span', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '11px' } }, task.title || task.id),
            task.blocked ? h('span', { style: { ...s.badge, color: STATUS_COLOR.blocked } }, `⛔${task.blocked}`) : null),
          ...children.flatMap(child => renderTask(child, depth + 1)),
        ]
      }

      const progressNode = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
        activityNode,
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '6px' } },
          h('div', { style: s.stat }, h('span', { style: { ...s.statValue, fontSize: '18px' } }, `${progress.done}/${progress.total}`), h('span', { style: s.statLabel }, t('boardProgress'))),
          h('div', { style: s.stat }, h('span', { style: { ...s.statValue, fontSize: '18px' } }, String(totals.tasks ?? 0)), h('span', { style: s.statLabel }, t('boardTasks'))),
          h('div', { style: s.stat }, h('span', { style: { ...s.statValue, fontSize: '18px', color: totals.blocked ? STATUS_COLOR.blocked : undefined } }, String(totals.blocked ?? 0)), h('span', { style: s.statLabel }, t('boardBlocked'))),
          h('div', { style: s.stat }, h('span', { style: { ...s.statValue, fontSize: '18px', color: gates.length ? STATUS_COLOR.waiting : undefined } }, String(gates.length)), h('span', { style: s.statLabel }, t('boardWaiting')))),
        meter(progress.done, progress.total))

      const stagesNode = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        stages.map(stage => {
          const counts = stage.counts || {}
          return h('div', { key: stage.key, style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', fontSize: '11px' } },
              h('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, stageLabel(stage.key)),
              h('span', { style: s.stageMeta }, `${counts.done ?? 0}/${counts.tasks ?? 0}${counts.blocked ? ` · ⛔${counts.blocked}` : ''}`)),
            meter(counts.done ?? 0, counts.tasks ?? 0))
        }))

      const tasksNode = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        agents.length === 0 ? h(Empty, { text: t('boardNoAgents') }) : h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
          agents.map(agent => h('span', { key: agent.owner, style: s.badge }, `${agent.owner} ${agent.counts?.tasks ?? 0}`))),
        h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: '6px', maxHeight: '220px', overflow: 'auto' } },
          roots.length === 0 ? h(Empty, { text: t('boardNoTasks') }) : roots.flatMap(task => renderTask(task, 0))))

      const gatesNode = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        gates.length === 0
          ? h(Empty, { text: t('boardNoGates') })
          : gates.map((gate, index) => h('div', {
              key: gate.id || `${gate.taskId}-${index}`,
              style: { border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', padding: '8px', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '6px' },
            },
              h('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, String((gate.questions && gate.questions[0]) || gate.title || gate.taskId || '—')),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' } },
                h('span', { style: { ...s.stageMeta, color: STATUS_COLOR.waiting } }, [gate.action || gate.decision || '', gate.owner || ''].filter(Boolean).join(' · ')),
                h('span', { style: gate.blocking ? { ...s.badge, color: STATUS_COLOR.blocked } : s.badge },
                  gate.blocking ? t('gateBlocking') : t('gateAdvisory'))),
              h('div', { style: { display: 'flex', gap: '6px' } },
                h('button', {
                  type: 'button', className: 'wb-btn',
                  style: { ...s.badge, cursor: 'pointer', padding: '4px 12px', minHeight: '28px', color: STATUS_COLOR.done, borderColor: STATUS_COLOR.done },
                  onClick: () => onDecide?.(gate, 'approve'),
                }, t('approve')),
                h('button', {
                  type: 'button', className: 'wb-btn',
                  style: { ...s.badge, cursor: 'pointer', padding: '4px 12px', minHeight: '28px', color: STATUS_COLOR.blocked, borderColor: STATUS_COLOR.blocked },
                  onClick: () => onDecide?.(gate, 'reject'),
                }, t('reject'))))))

      const shortPath = path => {
        const parts = String(path).split('/')
        return parts.length <= 2 ? path : `…/${parts.slice(-2).join('/')}`
      }
      const deliverablesNode = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h('span', { style: s.stageMeta }, `${artifacts.length} ${t('deliverableCount')}`),
        artifacts.length === 0
          ? h(Empty, { text: t('noArtifacts') })
          : h('ul', { style: s.list }, artifacts.slice(0, 12).map(path => h('li', { key: path, style: s.row },
              h('span', { style: { fontSize: '10px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, shortPath(path))))))

      // Only two panels start open: what needs a person, and where the project
      // stands. The rest are one click away, so the canvas itself stays visible.
      // Collapsed panels are not empty panels: the header carries a count so a
      // glance at the row still answers "how much is in there".
      const doneStages = stages.filter(stage => (stage.counts?.tasks ?? 0) > 0 && stage.counts.done === stage.counts.tasks).length
      // Rails: left = what is happening, right = what needs a person / output.
      const leftPanels = [
        { id: 'progress', title: t('boardProgress'), node: progressNode, accent: 'var(--dsw-alias-state-success-primary)', summary: `${progress.done}/${progress.total}` },
        { id: 'stages', title: t('boardFlowStages'), node: stagesNode, accent: 'var(--dsw-alias-brand-primary)', defaultCollapsed: true, summary: `${doneStages}/${stages.length}` },
        { id: 'tasks', title: t('boardTasks'), node: tasksNode, accent: 'var(--dsw-alias-label-secondary)', defaultCollapsed: true, summary: `${totals.tasks ?? 0} · ${agents.length}` },
      ]
      const rightPanels = [
        { id: 'gates', title: t('boardGates'), node: gatesNode, accent: 'var(--dsw-alias-state-warning-primary)', summary: `${gates.length}` },
        { id: 'decisions', title: t('streamTitle'), node: h(DecisionsSection, { t, summary, events: recentEvents, compact: true }), accent: 'var(--dsw-alias-brand-primary)', defaultCollapsed: true, summary: `${summary.decisions ?? 0}` },
        { id: 'deliverables', title: t('deliverableTitle'), node: deliverablesNode, accent: 'var(--dsw-alias-label-secondary)', defaultCollapsed: true, summary: `${artifacts.length}` },
      ]

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', position: 'relative', flex: '1 1 auto', minHeight: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h('button', {
            type: 'button', className: 'wb-btn',
            style: { ...s.badge, cursor: 'pointer', padding: '6px 12px', minHeight: '32px', display: 'inline-flex', alignItems: 'center' },
            onClick: onBack,
          }, backLabel || t('backToCards')),
          h('span', { style: { ...s.title, fontSize: '18px' } },
            job ? `${project.title || project.id} · ${job.title || job.id}` : (project.title || project.id)),
          h('span', {
            style: {
              ...s.badge,
              color: scopeStatus === 'paused' ? STATUS_COLOR.waiting : scopeStatus === 'cancelled' ? STATUS_COLOR.blocked : 'var(--dsw-alias-label-secondary)',
            },
          }, statusChip),
          running > 0
            ? h('span', {
                style: { ...s.badge, color: STATUS_COLOR.done, borderColor: STATUS_COLOR.done, animation: 'wb-glow 1.4s ease-in-out infinite' },
              }, `● ${t('boardLive')} ${running}`)
            : null,
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center' } },
            h('button', {
              type: 'button', className: 'wb-btn',
              style: {
                ...subtleButton, minHeight: '32px',
                ...(railsOpen ? { color: 'var(--dsw-alias-label-primary)', borderColor: 'var(--dsw-alias-brand-primary)' } : { color: 'var(--dsw-alias-label-secondary)' }),
              },
              onClick: toggleRails,
            }, `▤ ${railsOpen ? t('panelsHide') : t('panelsToggle')}`),
            job && scopeStatus !== 'done' && progress.done < progress.total
              ? h('button', {
                  type: 'button', className: 'wb-btn wb-primary',
                  disabled: execBusy,
                  style: { ...s.button, padding: '6px 14px' },
                  onClick: startExecution,
                }, execBusy ? t('convoSending') : `▶ ${t('execStart')}`)
              : null,
            job
              ? h('button', {
                  type: 'button', className: 'wb-btn',
                  style: { ...s.badge, cursor: 'pointer', padding: '6px 12px', minHeight: '32px', display: 'inline-flex', alignItems: 'center', ...(job.sessionId ? { color: STATUS_COLOR.done, borderColor: STATUS_COLOR.done } : {}) },
                  onClick: () => setChatOpen(!convoOpen),
                }, `💬 ${convoOpen ? t('convoOpen') : t('convoClosed')}`)
              : null,
            job
              ? h('button', {
                  type: 'button', className: 'wb-btn',
                  style: { ...s.badge, cursor: 'pointer', padding: '6px 12px', minHeight: '32px', display: 'inline-flex', alignItems: 'center' },
                  onClick: () => setWorkspaceOpen(true),
                }, `📁 ${t('workspaceButton')}`)
              : null,
            scopeStatus === 'paused'
              ? h('button', {
                  type: 'button', className: 'wb-btn',
                  style: { ...s.badge, cursor: 'pointer', padding: '6px 12px', minHeight: '32px', display: 'inline-flex', alignItems: 'center' },
                  onClick: async () => { setControlling(true); try { await onControl?.('resume') } finally { setControlling(false) } },
                  disabled: controlling,
                }, t('resumeRun'))
              : h('button', {
                  type: 'button', className: 'wb-btn',
                  style: { ...s.badge, cursor: 'pointer', padding: '6px 12px', minHeight: '32px', display: 'inline-flex', alignItems: 'center' },
                  onClick: async () => { setControlling(true); try { await onControl?.('pause') } finally { setControlling(false) } },
                  disabled: controlling || scopeStatus === 'cancelled',
                }, t('pauseRun')),
            h('button', {
              type: 'button', className: 'wb-btn',
              style: { ...s.badge, cursor: 'pointer', padding: '6px 12px', minHeight: '32px', display: 'inline-flex', alignItems: 'center', color: STATUS_COLOR.blocked },
              onClick: async () => {
                if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('cancelConfirm'))) return
                setControlling(true)
                try { await onControl?.('cancel') } finally { setControlling(false) }
              },
              disabled: controlling || scopeStatus === 'cancelled',
            }, t('cancelRun')),
            job && scopeStatus === 'done'
              ? h('button', {
                  type: 'button', className: 'wb-btn wb-primary',
                  style: { ...s.button, padding: '6px 14px' },
                  onClick: () => {
                    setDraftError(null)
                    setFollowUp(job)
                    setKind('change')
                    setBrief(t('followUpPrefill').replace('{name}', job.title || job.id))
                    setDialogOpen(true)
                  },
                }, `＋ ${t('followUp')}`)
              : h('button', {
                  type: 'button', className: 'wb-btn',
                  style: { ...s.button, padding: '6px 14px' },
                  onClick: () => { setDraftError(null); setFollowUp(null); setBrief(''); setDialogOpen(true) },
                }, `＋ ${t('taskEntryTitle')}`))),
        started ? h('p', { style: s.muted }, t('taskStarted')) : null,
        execNotice ? h('p', { style: { ...s.stageMeta, color: 'var(--dsw-alias-label-secondary)' } }, execNotice) : null,

        // Responsive split: side column when there is width, bottom dock when
        // there is not. Never an overlay — covering the cockpit was the bug.
        h('div', {
          ref: layoutRef,
          style: {
            flex: '1 1 auto', minHeight: '360px', display: 'flex', gap: '10px',
            flexDirection: chatSide ? 'row' : 'column', alignItems: 'stretch',
            position: 'relative',
          },
        },
          h('div', { style: { flex: '1 1 auto', minWidth: 0, minHeight: 0, display: 'flex', gap: '8px' } },
            showRails
              ? h('div', { style: { flex: '0 0 248px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', minHeight: 0 } },
                  leftPanels.map(panel => h(RailPanel, { key: panel.id, t, projectId: project.id, ...panel })))
              : null,
            h('div', { style: { flex: '1 1 auto', minWidth: 0, display: 'flex' } },
              h(TeamGraphCard, { t, project, scope, panels: [], fill: true })),
            showRails
              ? h('div', { style: { flex: '0 0 300px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px', overflowY: 'auto', minHeight: 0 } },
                  rightPanels.map(panel => h(RailPanel, { key: panel.id, t, projectId: project.id, ...panel })))
              : null),
          railsOpen && !railsColumns
            ? h('div', {
                style: {
                  position: 'absolute', top: 0, right: 0, bottom: 0, width: '340px', maxWidth: '92%',
                  display: 'flex', flexDirection: 'column', gap: '8px', zIndex: 12,
                  background: 'linear-gradient(180deg, rgba(20,25,34,.98), rgba(13,16,23,.98))',
                  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px',
                  boxShadow: '0 12px 40px rgba(0,0,0,.45)', padding: '8px', overflowY: 'auto',
                },
              },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', paddingBottom: '4px' } },
                  h('span', { style: { ...s.sectionTitle, fontSize: '12px', letterSpacing: '1px' } }, t('panelsToggle')),
                  h('button', {
                    type: 'button', className: 'wb-btn',
                    style: { ...subtleButton, marginLeft: 'auto', minWidth: '24px', width: '24px', height: '24px', padding: 0 },
                    onClick: toggleRails,
                  }, '×')),
                [...leftPanels, ...rightPanels].map(panel => h(RailPanel, { key: `drawer-${panel.id}`, t, projectId: project.id, ...panel })))
            : null,
          convoOpen && job && bridge
            ? h('div', {
                style: chatSide
                  ? { flex: '0 0 360px', minWidth: '280px', display: 'flex' }
                  : { flex: '0 0 46%', minHeight: '200px', display: 'flex', minWidth: 0 },
              },
                h(JobConversation, {
                  t,
                  job,
                  bridge,
                  onConfig: patch => onJobConfig?.(patch),
                  onClose: () => setChatOpen(false),
                  onNeedWorkspace: () => setWorkspaceOpen(true),
                }))
            : null),

        dialogOpen
          ? h(TaskDialog, {
              t,
              brief,
              error: draftError,
              busy,
              followUp,
              kind,
              onKind: setKind,
              onChange: value => setBrief(value),
              onCancel: () => { setDialogOpen(false); setFollowUp(null) },
              onConfirm: startTask,
            })
          : null,

        workspaceOpen && job
          ? h(JobWorkspaceDialog, {
              t,
              job,
              bridge,
              onCancel: () => setWorkspaceOpen(false),
              onSave: async entry => {
                await onJobConfig?.({ workspace: entry.path, workspaceId: entry.id })
                setWorkspaceOpen(false)
              },
            })
          : null,
      )
    }

    function ProjectCard(props) {
      const { t, project, onOpen } = props
      // A card is an app launcher, not a task dashboard: no counts, no meter.
      const ready = Boolean(project.workspace)
      return h('button', {
        type: 'button',
        className: 'wb-card wb-btn',
        onClick: onOpen,
        style: {
          ...s.card,
          textAlign: 'left',
          cursor: 'pointer',
          gap: '8px',
          minHeight: '96px',
          justifyContent: 'space-between',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('span', {
            style: {
              width: '8px', height: '8px', borderRadius: '50%',
              background: ready ? STATUS_COLOR.done : 'var(--dsw-alias-label-secondary)',
              boxShadow: ready ? `0 0 8px ${STATUS_COLOR.done}` : 'none',
              flex: '0 0 auto',
            },
          }),
          h('span', { style: { ...s.stageName, fontSize: '15px' } }, project.title || project.id)),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('span', { style: { ...s.stageMeta } }, ready ? t('cardEnterApp') : t('cardNoApp')),
          h('span', { style: { ...s.stageMeta, marginLeft: 'auto' } }, '→')))
    }

    function Dialog(props) {
      const { title, children, error, busy, confirmLabel, cancelLabel, onCancel, onConfirm } = props
      const panelRef = useRef(null)
      // A modal owes the user three things: it is announced, focus stays inside
      // it, and focus returns to the control that opened it.
      useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const previous = document.activeElement
        const panel = panelRef.current
        const focusables = () => panel === null
          ? []
          : [...panel.querySelectorAll('button, input, textarea, select, a[href]')]
            .filter(el => el.disabled !== true && el.offsetParent !== null)
        const first = focusables()[0]
        if (first !== undefined && typeof first.focus === 'function') first.focus()
        const onKey = event => {
          if (event.key === 'Escape') {
            event.preventDefault?.()
            onCancel()
            return
          }
          if (event.key !== 'Tab') return
          const items = focusables()
          if (items.length === 0) return
          const index = items.indexOf(document.activeElement)
          if (event.shiftKey && index <= 0) {
            event.preventDefault?.()
            items[items.length - 1].focus()
          } else if (event.shiftKey === false && (index === items.length - 1 || index === -1)) {
            event.preventDefault?.()
            items[0].focus()
          }
        }
        window.addEventListener('keydown', onKey)
        const body = document.body
        const previousOverflow = body.style.overflow
        body.style.overflow = 'hidden'
        return () => {
          window.removeEventListener('keydown', onKey)
          body.style.overflow = previousOverflow
          if (previous !== null && typeof previous.focus === 'function') previous.focus()
        }
      }, [onCancel])
      return h('div', {
        style: {
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
        },
        onClick: onCancel,
      },
        h('div', {
          ref: panelRef,
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': title,
          tabIndex: -1,
          style: { ...s.card, width: '420px', maxWidth: '88vw' },
          onClick: event => event.stopPropagation(),
        },
          h('h2', { style: s.sectionTitle }, title),
          children,
          error ? h('p', { style: s.error }, error) : null,
          h('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } },
            h('button', { type: 'button', className: 'wb-btn', style: { ...s.badge, cursor: 'pointer', padding: '6px 14px', minHeight: '32px', display: 'inline-flex', alignItems: 'center' }, onClick: onCancel }, cancelLabel),
            h('button', {
              type: 'button',
              className: 'wb-btn',
              style: { ...s.button, opacity: busy ? 0.6 : 1 },
              disabled: busy,
              onClick: onConfirm,
            }, confirmLabel))))
    }

    function CreateCardDialog(props) {
      const { t } = props
      return h(Dialog, {
        title: t('createDialogTitle'),
        error: props.error,
        busy: props.busy,
        confirmLabel: t('createConfirm'),
        cancelLabel: t('createCancel'),
        onCancel: props.onCancel,
        onConfirm: props.onConfirm,
      },
        h('input', {
          style: { ...s.textarea, minHeight: '40px', padding: '8px 12px' },
          value: props.name,
          placeholder: t('createNamePlaceholder'),
          onChange: event => props.onChange(event.target.value),
          onKeyDown: event => { if (event.key === 'Enter') props.onConfirm() },
          autoFocus: true,
        }),
        h('p', { style: { ...s.muted, margin: 0, fontSize: '12px' } }, t('createHint')))
    }

    /** The task entry, as a dialog instead of a permanently open textarea. */
    function TaskDialog(props) {
      const { t, followUp = null, kind = 'change', onKind } = props
      const kinds = [
        { id: 'change', label: t('kindChange') },
        { id: 'fix', label: t('kindFix') },
        { id: 'feature', label: t('kindFeature') },
      ]
      return h(Dialog, {
        title: followUp ? t('followUp') : t('taskEntryTitle'),
        error: props.error,
        busy: props.busy,
        confirmLabel: props.busy ? t('taskSubmitting') : (followUp ? t('taskPlanSubmit') : t('taskSubmit')),
        cancelLabel: t('createCancel'),
        onCancel: props.onCancel,
        onConfirm: props.onConfirm,
      },
        h('p', { style: { ...s.muted, margin: 0 } }, followUp
          ? t('followUpHint').replace('{name}', followUp.title || followUp.id)
          : t('taskEntryHint')),
        followUp
          ? h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
              h('span', { style: s.stageMeta }, t('kindLabel')),
              kinds.map(item => h('button', {
                key: item.id,
                type: 'button',
                className: 'wb-btn',
                style: kind === item.id ? { ...s.button, padding: '4px 12px', fontSize: '12px' } : { ...subtleButton, height: '28px' },
                onClick: () => onKind?.(item.id),
              }, item.label)))
          : null,
        h('textarea', {
          style: s.textarea,
          value: props.brief,
          placeholder: t('taskEntryPlaceholder'),
          onChange: event => props.onChange(event.target.value),
          disabled: props.busy,
          autoFocus: true,
        }),
        typeof props.onPickFile === 'function'
          ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
              h('label', {
                className: 'wb-btn',
                style: { ...s.badge, cursor: props.busy ? 'default' : 'pointer', padding: '6px 12px', minHeight: '32px', display: 'inline-flex', alignItems: 'center' },
              },
                t('uploadChoose'),
                h('input', {
                  type: 'file',
                  accept: '.md,.markdown,.txt',
                  disabled: props.busy,
                  style: { display: 'none' },
                  onChange: event => {
                    props.onPickFile(event.target.files?.[0] ?? null)
                    event.target.value = ''
                  },
                })),
              props.file
                ? h('span', { style: s.stageMeta }, `${props.file.name} · ${Math.max(1, Math.round(props.file.size / 1024))} KiB`)
                : null,
              props.file
                ? h('button', {
                    type: 'button',
                    className: 'wb-btn',
                    style: { ...s.badge, cursor: 'pointer', padding: '4px 10px' },
                    onClick: () => props.onClearFile?.(),
                  }, t('uploadRemove'))
                : null)
          : null,
        typeof props.onPickFile === 'function'
          ? h('p', { style: { ...s.muted, margin: 0, fontSize: '11px' } }, props.fileError || t('uploadHint'))
          : null)
    }

    /**
     * Navigation: project cards -> one project's deliverables -> its tasks ->
     * the cockpit of one task. Four surfaces, one mental model.
     */
    function WorkflowTab(props) {
      const { t } = props
      const props_ = props
      const { payload, failed, reload } = useWorkbench()
      const [selected, setSelected] = useState(null)
      const [tasksOpen, setTasksOpen] = useState(false)
      const [showHome, setShowHome] = useState(false)
      const [jobId, setJobId] = useState(null)
      const [dialogOpen, setDialogOpen] = useState(false)
      const [cardName, setCardName] = useState('')
      const [createError, setCreateError] = useState(null)
      const [creating, setCreating] = useState(false)
      const [jobDialogOpen, setJobDialogOpen] = useState(false)
      const [jobBrief, setJobBrief] = useState('')
      const [jobBusy, setJobBusy] = useState(false)
      const [jobError, setJobError] = useState(null)
      // A requirement document is read in the browser and sent as base64; the
      // host decodes and stores it with the requirement.
      const [jobFile, setJobFile] = useState(null)
      const [jobFileError, setJobFileError] = useState(null)

      const bridge = useMemo(() => createSessionBridge(() => serviceCtx || hostCtx), [])
      const projects = payload && payload.board && Array.isArray(payload.board.projects)
        ? payload.board.projects
        : []
      const project = selected === null ? null : projects.find(item => item.id === selected) || null
      const job = project && jobId !== null
        ? (project.jobs || []).find(item => item.id === jobId) || null
        : null

      const controlProject = useCallback(async (action, scopedJobId) => {
        if (project === null) return
        try {
          await fetch('/workbench/control', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(scopedJobId ? { projectId: project.id, jobId: scopedJobId, action } : { projectId: project.id, action }),
          })
        } finally {
          reload()
        }
      }, [project, reload])

      const saveJobConfig = useCallback(async patch => {
        if (project === null || job === null) return
        const response = await fetch('/workbench/job-config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ projectId: project.id, jobId: job.id, ...patch }),
        })
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
        reload()
      }, [project, job, reload])

      const decideGate = useCallback(async (gate, decision) => {
        try {
          await fetch('/workbench/decide', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              taskId: gate.taskId,
              action: gate.action || gate.decision || gate.id,
              decision,
            }),
          })
        } finally {
          reload()
        }
      }, [reload])

      const createCard = useCallback(async () => {
        setCreateError(null)
        if (!cardName.trim()) {
          setCreateError(t('emptyBrief'))
          return
        }
        setCreating(true)
        try {
          const response = await fetch('/workbench/projects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ name: cardName.trim() }),
          })
          const body = await response.json().catch(() => null)
          if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
          setDialogOpen(false)
          setCardName('')
          setSelected(body.projectId)
          setTasksOpen(false)
          setJobId(null)
          reload()
        } catch (error) {
          setCreateError(String(error?.message ?? error))
        } finally {
          setCreating(false)
        }
      }, [cardName, reload, t])

      const pickJobFile = useCallback(file => {
        setJobError(null)
        setJobFileError(null)
        if (!file) return
        const name = String(file.name || 'requirement')
        const extension = (name.split('.').pop() || '').toLowerCase()
        if (!['md', 'markdown', 'txt'].includes(extension)) {
          setJobFileError(t('uploadUnsupported'))
          return
        }
        if (file.size > 512 * 1024) {
          setJobFileError(t('uploadTooBig'))
          return
        }
        if (typeof FileReader !== 'function') {
          setJobFileError(t('uploadReadFailed'))
          return
        }
        const reader = new FileReader()
        reader.onerror = () => setJobFileError(t('uploadReadFailed'))
        reader.onload = () => {
          const result = String(reader.result || '')
          const comma = result.indexOf(',')
          const base64 = comma >= 0 ? result.slice(comma + 1) : result
          setJobFile({ name, size: file.size, base64 })
        }
        reader.readAsDataURL(file)
      }, [t])

      const createJob = useCallback(async () => {
        setJobError(null)
        const text = jobBrief.trim()
        if (text === '' && jobFile === null) {
          setJobError(t('emptyBrief'))
          return
        }
        const file = jobFile
        if (file !== null) setJobBusy(true)
        else setJobBusy(true)
        try {
          // New requirements go through the closed-loop intake: the host opens
          // a job, binds a delivery session and wakes the planning agent.
          const response = await fetch('/workbench/requirements', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
              projectId: project.id,
              ...(text === '' ? {} : { text }),
              ...(file === null ? {} : { file: { name: file.name, base64: file.base64 } }),
            }),
          })
          const body = await response.json().catch(() => null)
          if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
          setJobDialogOpen(false)
          setJobBrief('')
          setJobFile(null)
          setJobFileError(null)
          setTasksOpen(true)
          reload()
        } catch (error) {
          setJobError(String(error?.message ?? error))
        } finally {
          setJobBusy(false)
        }
      }, [jobBrief, jobFile, project, reload, t])

      if (payload === null) {
        return h('div', { style: s.card }, h(Empty, { text: failed ? t('decisionsOffline') : t('loading') }))
      }

      const openJobDialog = () => {
        setJobError(null)
        setJobFile(null)
        setJobFileError(null)
        setJobDialogOpen(true)
      }
      const dialog = jobDialogOpen
        ? h(TaskDialog, {
            t,
            brief: jobBrief,
            error: jobError,
            busy: jobBusy,
            file: jobFile,
            fileError: jobFileError,
            onPickFile: pickJobFile,
            onClearFile: () => { setJobFile(null); setJobFileError(null) },
            onChange: value => setJobBrief(value),
            onCancel: () => setJobDialogOpen(false),
            onConfirm: createJob,
          })
        : null

      if (project !== null) {
        if (job !== null) {
          return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', flex: '1 1 auto', minHeight: 0 } },
            h(ProjectDetail, {
              t,
              project,
              job,
              summary: payload.summary,
              events: payload.events,
              backLabel: t('tabTasks'),
              onBack: () => { setJobId(null); setTasksOpen(true) },
              onControl: action => controlProject(action, job.id),
              onDecide: decideGate,
              bridge,
              onJobConfig: saveJobConfig,
            }),
            dialog)
        }
        if (showHome) {
          return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', flex: '1 1 auto', minHeight: 0 } },
            h(ProjectHome, {
              t,
              project,
              backLabel: t('backToApp'),
              onBack: () => { setShowHome(false) },
              onOpenTasks: () => { setShowHome(false); setTasksOpen(true) },
              onNewTask: openJobDialog,
              onRefresh: reload,
            }),
            dialog)
        }
        if (tasksOpen) {
          return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', flex: '1 1 auto', minHeight: 0 } },
            h(TaskList, {
              t,
              project,
              onBack: () => setTasksOpen(false),
              onOpenJob: id => { setJobId(id); setTasksOpen(false) },
              onNewTask: openJobDialog,
            }),
            dialog)
        }
        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', flex: '1 1 auto', minHeight: 0 } },
          h(ProjectHome, {
            t,
            project,
            onBack: () => setSelected(null),
            onOpenTasks: () => setTasksOpen(true),
            onNewTask: openJobDialog,
            onRefresh: reload,
          }),
          dialog)
      }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px', flex: '1 1 auto', minHeight: 0 } },
        h('p', { style: s.muted }, projects.length === 0 ? t('cardEmpty') : t('cardHint')),
        h('div', {
          style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' },
        },
          h('button', {
            type: 'button',
            className: 'wb-card wb-btn',
            onClick: () => { setCreateError(null); setDialogOpen(true) },
            style: {
              ...s.card,
              cursor: 'pointer',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '104px',
              borderStyle: 'dashed',
              color: 'var(--dsw-alias-label-secondary)',
              fontSize: '14px',
            },
          }, `＋ ${t('createCard')}`),
          projects.map(item => h(ProjectCard, {
            key: item.id,
            t,
            project: item,
            onOpen: () => { setSelected(item.id); setTasksOpen(false); setShowHome(false); setJobId(null) },
          }))),
        dialogOpen
          ? h(CreateCardDialog, {
              t,
              name: cardName,
              error: createError,
              busy: creating,
              onChange: value => setCardName(value),
              onCancel: () => setDialogOpen(false),
              onConfirm: createCard,
            })
          : null,
      )
    }

    function Panel(props) {
      const ctx = hostCtx
      const t = useTranslate(ctx, DICT.zh)
      // The conversation/cockpit bottom should sit on the same baseline as the
      // DSH sidebar, so the page is measured, not derived from a magic number.
      const [pageRef, fillHeight] = useFillHeight(8)

      // No top-level tab bar. The panel is the projects board; modules that
      // belong to one delivered company app live in their own plugin, not as
      // sibling tabs here.
      return h(
        'div',
        { ref: pageRef, style: { ...s.page, ...(fillHeight === null ? {} : { height: `${fillHeight}px` }) } },
        h('style', { key: 'wb-css' }, WB_CSS),
        h(
          'div',
          { style: s.inner },
          h('h1', { style: s.title }, t('title')),
          h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h(WorkflowTab, { t, ctx })),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      // Test seam: the panel has no unit tests otherwise, and a stray variable
      // in a component body only surfaces as a blank slot at runtime.
      __components: { Panel, WorkflowTab, ProjectHome, TaskList, ProjectDetail, ProjectCard, Dialog, TaskDialog, CreateCardDialog, TeamGraphCard, FloatingPanel, RailPanel, JobConversation, JobWorkspaceDialog, createSessionBridge, teamGraph },
      apply(ctx) {
        hostCtx = ctx
        // Session services are optional: the panel and its sidebar entry must
        // exist even if the host build has no sessions/conversation/workspaces.
        // Never let this throw: a broken optional dependency must not stop the
        // plugin (or the other client plugins applied after it) from loading.
        try {
          if (typeof ctx.inject === 'function') {
            ctx.inject(['sessions', 'conversation', 'workspaces'], serviceContext => {
              serviceCtx = serviceContext
              return () => {
                if (serviceCtx === serviceContext) serviceCtx = null
              }
            })
          } else {
            serviceCtx = ctx
          }
        } catch {
          /* optional session services unavailable in this host */
        }
        // Dictionaries first, so the panel's first paint already has text.
        ctx.effect(() => {
          if (!ctx.locale) return () => {}
          const disposers = []
          for (const [id, dict] of Object.entries(DICT)) {
            try {
              disposers.push(ctx.locale.register(NS, id, dict))
            } catch {
              // A namespace has a single owner; keep whatever already holds it.
            }
          }
          return () => {
            for (const dispose of disposers) {
              try {
                dispose()
              } catch {
                /* already withdrawn */
              }
            }
          }
        })

        try {
          ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_KEY,
            order: 90,
            // A thunk is re-read on every projection, so the label follows the locale.
            label: () => (ctx.locale
              ? ctx.locale.bind(NS)('panelLabel')
              : DICT.zh.panelLabel),
          }, PanelIcon))
        } catch {
          /* an older host without the sidebar slot: the panel still opens via main */
        }

        try {
          ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main',
            key: PANEL_KEY,
          }, Panel))
        } catch {
          /* main slot unavailable */
        }
      },
    }
  },
})