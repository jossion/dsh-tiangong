window.__ModuleLoader__.load({
  id: '@jos/workbench',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo } = React

    const PANEL_KEY = 'workbench'
    const NS = 'workbench'

    /**
     * Bilingual dictionaries, registered through ctx.locale so the panel
     * follows the active language instead of hard-coding one.
     */
    const DICT = {
      en: {
        panelLabel: 'Workbench',
        title: 'Workbench',
        tabDelivery: 'Delivery',
        tabStaff: 'Staff',
        tabFinance: 'Finance',
        briefLabel: 'What do you want to build?',
        briefHint:
          'Describe it the way you would to a colleague, and say who will use it. The planner '
          + 'designs the roles, permissions, data model, and build tasks.',
        briefPlaceholder: 'A user management system for our company. Four kinds of people use it: ...',
        submit: 'Plan this system',
        submitting: 'Planning…',
        emptyBrief: 'Describe what you want built first.',
        noComposer: 'No composer bridge available; run it from the chat instead.',
        loading: 'Loading…',
        noStaff: 'No staff records yet.',
        noLedger: 'Finance records will appear here.',
      },
      zh: {
        panelLabel: '工作台',
        title: '工作台',
        tabDelivery: '软件开发',
        tabStaff: '人员管理',
        tabFinance: '财务管理',
        briefLabel: '你想做什么系统？',
        briefHint:
          '像跟同事描述一样把需求说清楚，并说明会有哪些人使用。工作流会自动设计角色、'
          + '权限矩阵、数据模型和开发任务清单。',
        briefPlaceholder: '一个公司内部的用户管理系统。有四类人使用：管理员、部门主管、普通员工、审计员……',
        submit: '开始设计',
        submitting: '正在设计…',
        emptyBrief: '请先描述你想做的系统。',
        noComposer: '当前没有可用的对话入口，请直接在聊天中发起。',
        loading: '加载中…',
        noStaff: '还没有人员记录。',
        noLedger: '财务记录将显示在这里。',
      },
    }

    // Every colour is a host token, so the panel follows light and dark.
    const s = {
      page: {
        padding: '24px 28px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        // Fill the main column, but keep line length readable by centring a
        // measure inside it rather than pinning content to the left edge.
        width: '100%',
        boxSizing: 'border-box',
      },
      inner: {
        width: '100%',
        maxWidth: '880px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
      },
      title: { margin: 0, fontSize: '22px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      muted: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '13px', lineHeight: '1.6' },
      label: { fontSize: '14px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
      tabs: { display: 'flex', gap: '4px', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      tab: {
        appearance: 'none',
        background: 'none',
        border: 'none',
        borderBottom: '2px solid transparent',
        color: 'var(--dsw-alias-label-secondary)',
        padding: '8px 14px',
        font: 'inherit',
        fontSize: '14px',
        cursor: 'pointer',
      },
      tabActive: {
        color: 'var(--dsw-alias-label-primary)',
        borderBottomColor: 'var(--dsw-alias-brand-primary)',
        fontWeight: 500,
      },
      card: {
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '10px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      },
      textarea: {
        width: '100%',
        minHeight: '96px',
        resize: 'vertical',
        boxSizing: 'border-box',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontSize: '14px',
        lineHeight: '1.6',
      },
      button: {
        alignSelf: 'flex-start',
        padding: '8px 16px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-brand-primary)',
        // The brand fill is already the accent, so the label takes the
        // contrast surface instead of the themed text colour, which in a light
        // theme is dark and would vanish against the fill.
        color: 'var(--dsw-alias-bg-base)',
        font: 'inherit',
        fontSize: '14px',
        fontWeight: 500,
        cursor: 'pointer',
      },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px', margin: 0 },
      list: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' },
      row: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: '12px',
        padding: '10px 0',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
    }

    function PanelIcon(props) {
      const size = props && props.size ? props.size : 20
      return h(
        'svg',
        { viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': true },
        h('rect', {
          x: 8, y: 8, width: 48, height: 48, rx: 10,
          fill: 'none', stroke: 'currentColor', strokeWidth: 4,
        }),
        h('path', {
          d: 'M22 26h10M22 34h22M22 42h14',
          fill: 'none', stroke: 'currentColor', strokeWidth: 4, strokeLinecap: 'round',
        }),
      )
    }

    /** Follow the active locale and hand the component tree a `t`. */
    function useTranslate(ctx, fallback) {
      const t = ctx && ctx.locale ? ctx.locale.bind(NS) : null
      const [revision, setRevision] = useState(0)

      useEffect(() => {
        if (!ctx || !ctx.locale) return undefined
        // Registration bumps the revision, so a late dictionary still repaints.
        return ctx.locale.subscribe(() => setRevision(r => r + 1))
      }, [ctx])

      // eslint-disable-next-line react-hooks/exhaustive-deps
      return useMemo(() => (t
        ? key => {
            const value = t(key)
            // A missing key renders the key itself; fall back to bundled text.
            return value === key ? fallback[key] : value
          }
        : key => fallback[key]), [t, revision, fallback])
    }

    function Empty(props) {
      return h('p', { style: s.muted }, props.text)
    }

    function DeliveryTab(props) {
      const { t } = props
      const [brief, setBrief] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)

      const submit = useCallback(() => {
        setError(null)
        if (!brief.trim()) {
          setError(t('emptyBrief'))
          return
        }
        setBusy(true)
        try {
          const boot = window.__DSH_BOOT__
          if (boot && typeof boot.submitPrompt === 'function') {
            boot.submitPrompt(`${brief.trim()}`)
          } else {
            setError(t('noComposer'))
          }
        } finally {
          setBusy(false)
        }
      }, [brief, t])

      return h(
        'div',
        { style: s.card },
        h('label', { style: s.label, htmlFor: 'wb-brief' }, t('briefLabel')),
        h('p', { style: s.muted }, t('briefHint')),
        h('textarea', {
          id: 'wb-brief',
          style: s.textarea,
          value: brief,
          placeholder: t('briefPlaceholder'),
          onChange: e => setBrief(e.target.value),
        }),
        error ? h('p', { style: s.error }, error) : null,
        h('button', { type: 'button', style: s.button, disabled: busy, onClick: submit },
          busy ? t('submitting') : t('submit')),
      )
    }

    function StaffTab(props) {
      const { t } = props
      const [rows, setRows] = useState([])
      const [loaded, setLoaded] = useState(false)

      useEffect(() => {
        const boot = window.__DSH_BOOT__
        if (!boot || typeof boot.workbench !== 'function') {
          setLoaded(true)
          return undefined
        }
        let live = true
        boot.workbench('staff.list')
          .then(r => { if (live) setRows(r ?? []) })
          .catch(() => {})
          .finally(() => { if (live) setLoaded(true) })
        return () => { live = false }
      }, [])

      if (!loaded) return h(Empty, { text: t('loading') })
      if (!rows.length) return h(Empty, { text: t('noStaff') })
      return h(
        'div',
        { style: s.card },
        h('ul', { style: s.list }, rows.map(r =>
          h('li', { key: r.id, style: s.row },
            h('span', null, r.name ?? r.id),
            h('span', { style: s.muted }, r.role ?? '')))),
      )
    }

    function LedgerTab(props) {
      return h(Empty, { text: props.t('noLedger') })
    }

    function Panel(props) {
      const ctx = props && props.ctx
      const t = useTranslate(ctx, DICT.zh)
      const [tab, setTab] = useState('delivery')

      const tabs = [
        { id: 'delivery', label: t('tabDelivery') },
        { id: 'staff', label: t('tabStaff') },
        { id: 'ledger', label: t('tabFinance') },
      ]

      return h(
        'div',
        { style: s.page },
        h(
          'div',
          { style: s.inner },
          h('h1', { style: s.title }, t('title')),
          h(
            'div',
            { style: s.tabs, role: 'tablist' },
            tabs.map(item => h('button', {
              key: item.id,
              type: 'button',
              role: 'tab',
              'aria-selected': tab === item.id,
              style: { ...s.tab, ...(tab === item.id ? s.tabActive : null) },
              onClick: () => setTab(item.id),
            }, item.label)),
          ),
          tab === 'delivery' ? h(DeliveryTab, { t })
            : tab === 'staff' ? h(StaffTab, { t })
            : h(LedgerTab, { t }),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
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

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_KEY,
          order: 90,
          // A thunk is re-read on every projection, so the label follows the locale.
          label: () => (ctx.locale
            ? ctx.locale.bind(NS)('panelLabel')
            : DICT.zh.panelLabel),
        }, PanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_KEY,
        }, Panel))
      },
    }
  },
})