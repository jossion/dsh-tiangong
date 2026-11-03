window.__ModuleLoader__.load({
  id: '@jos/company',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useRef } = React

    /** The apply-time client context: components read host services through it. */
    let hostCtx = null

    const PANEL_KEY = 'company'
    const NS = 'company'

    /**
     * Bilingual dictionaries, registered through ctx.locale so the panel
     * follows the active language instead of hard-coding one.
     */
    const DICT = {
      en: {
        panelLabel: 'Company',
        title: 'Company management',
        companyWorkspace: 'Workspace',
        companyAppPort: 'App port',
        employeeModule: 'Employees',
        orgModule: 'Organization',
        financeTab: 'Finance',
        financeTitle: 'Finance',
        financeSource: 'Source',
        financeSourceFiles: 'Statement folder',
        financeSourceSqlite: 'SQLite database',
        financeSourceSaved: 'Source updated.',
        financeSave: 'Save',
        financeCancel: 'Cancel',
        financeReload: 'Refresh',
        financeImport: 'Import statements',
        financeImporting: 'Importing…',
        financeDirPlaceholder: '~/Documents/银行流水',
        financeDbPlaceholder: '/absolute/path/app.db',
        financeDbError: 'Cannot read this database: {msg}',
        financeImportNone: 'Nothing new to import.',
        financeImportResult: 'Imported {files} file(s), {rows} rows',
        financeImportSkipped: '{n} already imported',
        financeImportErrors: '{n} failed',
        financeIncome: 'Income',
        financeExpense: 'Expense',
        financeNet: 'Net',
        financeCount: 'Transactions',
        financePeriod: 'Period',
        financePeriodMonth: 'This month',
        financePeriodLast3: 'Last 3 months',
        financePeriodYear: 'This year',
        financePeriodAll: 'All',
        financeDirection: 'Direction',
        financeAll: 'All',
        financeCategory: 'Category',
        financeSearchPlaceholder: 'Search description or payer',
        financeMonthly: 'Monthly',
        financeByCategory: 'By category',
        financeTransactions: 'Transactions',
        financeNoDetail: '(no description)',
        financeEmptyRange: 'No transaction in this filter.',
        financeNoDir: 'Folder not found: {dir}',
        financeNoFiles: 'No CSV or Excel statement in this folder.',
        financeNoData: 'No statement imported yet.',
        financeFiles: 'Files in folder',
        financeImported: 'imported',
        financePending: 'new',
        orgCompany: 'Company name',
        orgDepartments: 'Departments',
        orgJobLevels: 'Job levels',
        orgCreateDepartment: 'New department',
        orgEditDepartment: 'Edit department',
        orgCreateLevel: 'New job level',
        orgEditLevel: 'Edit job level',
        orgParent: 'Parent department',
        orgRank: 'Rank',
        orgSort: 'Sort order',
        orgNone: 'None',
        orgSave: 'Save',
        orgCompanySaved: 'Company name saved.',
        orgDeptSaved: 'Department saved.',
        orgLevelSaved: 'Job level saved.',
        orgEmpty: 'Nothing here yet.',
        orgNeedCompany: 'Set the company name before adding job levels.',
        orgCompanies: 'Companies',
        orgCreateCompany: 'New company',
        orgRenameCompany: 'Rename company',
        orgDeleteCompany: 'Delete company',
        orgDeleteConfirm: 'Delete "{name}"?',
        orgDelete: 'Delete',
        orgNoCompany: 'Create a company first, then add departments and job levels.',
        orgCompanySaved2: 'Company saved.',
        orgCompanyDeleted: 'Company deleted.',
        orgDeptDeleted: 'Department deleted.',
        orgLevelDeleted: 'Job level deleted.',
        orgChildrenFirst: 'Delete its departments and job levels first.',
        servicesLabel: 'Dependencies',
        serviceDb: 'Database',
        serviceWeb: 'App server',
        serviceReady: 'ready',
        serviceMissing: 'missing',
        serviceRunning: 'running',
        serviceStopped: 'stopped',
        serviceStart: 'Start',
        serviceStop: 'Stop',
        serviceChecking: 'checking…',
        serviceFailed: 'Service action failed',
        employeeTitle: 'Employees',
        employeeTotal: '{total} employees',
        employeeSearch: 'Search name, email, department, job title',
        employeeCreate: 'New employee',
        employeeCreateTitle: 'New employee',
        employeeEditTitle: 'Edit employee',
        employeeDeleteTitle: 'Delete employee',
        employeeDeleteConfirm: 'Delete {name}? This cannot be undone.',
        employeeEmpty: 'No employees yet. Add the first one.',
        employeeNoSearch: 'No employee matches this search.',
        employeeSaved: 'Saved employee “{name}”.',
        employeeDeleted: 'Deleted employee “{name}”.',
        employeeActive: 'Active',
        employeeInactive: 'Inactive',
        employeeAllCompanies: 'All companies',
        employeeCompanyFirst: 'Create a company in the organization module first.',
        cancel: 'Cancel',
        closeNotice: 'Dismiss',
        retry: 'Retry',
        loading: 'Loading…',
        save: 'Save',
        edit: 'Edit',
        delete: 'Delete',
        colName: 'Name',
        colEmail: 'Email',
        colPhone: 'Phone',
        colDepartment: 'Department',
        colCompany: 'Company',
        colJobTitle: 'Job title',
        colStatus: 'Status',
        colHiredAt: 'Hired',
      },
      zh: {
        panelLabel: '公司管理',
        title: '公司管理',
        companyWorkspace: '工作区',
        companyAppPort: '应用端口',
        employeeModule: '员工管理',
        orgModule: '组织架构',
        financeTab: '财务',
        financeTitle: '财务管理',
        financeSource: '数据源',
        financeSourceFiles: '流水目录',
        financeSourceSqlite: 'SQLite 数据库',
        financeSourceSaved: '数据源已更新。',
        financeSave: '保存',
        financeCancel: '取消',
        financeReload: '刷新',
        financeImport: '导入流水',
        financeImporting: '导入中…',
        financeDirPlaceholder: '~/Documents/银行流水',
        financeDbPlaceholder: '/绝对路径/数据库.db',
        financeDbError: '读不了这个数据库：{msg}',
        financeImportNone: '没有需要导入的新文件。',
        financeImportResult: '已导入 {files} 个文件，{rows} 条流水',
        financeImportSkipped: '{n} 个文件已导入过',
        financeImportErrors: '{n} 个文件失败',
        financeIncome: '收入',
        financeExpense: '支出',
        financeNet: '结余',
        financeCount: '交易笔数',
        financePeriod: '时段',
        financePeriodMonth: '本月',
        financePeriodLast3: '近 3 月',
        financePeriodYear: '今年',
        financePeriodAll: '全部',
        financeDirection: '方向',
        financeAll: '全部',
        financeCategory: '分类',
        financeSearchPlaceholder: '搜索摘要或对方',
        financeMonthly: '月度收支',
        financeByCategory: '分类构成',
        financeTransactions: '交易明细',
        financeNoDetail: '（无摘要）',
        financeEmptyRange: '这个筛选条件下没有交易。',
        financeNoDir: '目录不存在：{dir}',
        financeNoFiles: '这个目录里没有 CSV / Excel 流水文件。',
        financeNoData: '还没有导入流水数据。',
        financeFiles: '目录文件',
        financeImported: '已导入',
        financePending: '未导入',
        orgCompany: '公司名称',
        orgDepartments: '部门',
        orgJobLevels: '职级',
        orgCreateDepartment: '新建部门',
        orgEditDepartment: '编辑部门',
        orgCreateLevel: '新建职级',
        orgEditLevel: '编辑职级',
        orgParent: '上级部门',
        orgRank: '排序',
        orgSort: '排序值',
        orgNone: '无',
        orgSave: '保存',
        orgCompanySaved: '公司名称已保存。',
        orgDeptSaved: '部门已保存。',
        orgLevelSaved: '职级已保存。',
        orgEmpty: '还没有数据。',
        orgNeedCompany: '请先设置公司名称，再添加职级。',
        orgCompanies: '公司',
        orgCreateCompany: '新建公司',
        orgRenameCompany: '重命名公司',
        orgDeleteCompany: '删除公司',
        orgDeleteConfirm: '确定删除「{name}」？',
        orgDelete: '删除',
        orgNoCompany: '先创建一家公司，再添加部门和职级。',
        orgCompanySaved2: '公司已保存。',
        orgCompanyDeleted: '公司已删除。',
        orgDeptDeleted: '部门已删除。',
        orgLevelDeleted: '职级已删除。',
        orgChildrenFirst: '请先删除它下面的部门和职级。',
        servicesLabel: '依赖服务',
        serviceDb: '数据库',
        serviceWeb: '应用服务',
        serviceReady: '就绪',
        serviceMissing: '缺失',
        serviceRunning: '运行中',
        serviceStopped: '未启动',
        serviceStart: '启动',
        serviceStop: '停止',
        serviceChecking: '检测中…',
        serviceFailed: '服务操作失败',
        employeeTitle: '员工管理',
        employeeTotal: '共 {total} 位员工',
        employeeSearch: '搜索姓名、邮箱、部门、职位',
        employeeCreate: '新增员工',
        employeeCreateTitle: '新增员工',
        employeeEditTitle: '编辑员工',
        employeeDeleteTitle: '删除员工',
        employeeDeleteConfirm: '删除「{name}」？此操作不可撤销。',
        employeeEmpty: '还没有员工，先添加第一位。',
        employeeNoSearch: '没有匹配的员工。',
        employeeSaved: '已保存员工「{name}」。',
        employeeDeleted: '已删除员工「{name}」。',
        employeeActive: '在职',
        employeeInactive: '离职',
        employeeAllCompanies: '全部公司',
        employeeCompanyFirst: '请先在组织架构里创建公司。',
        cancel: '取消',
        closeNotice: '关闭提示',
        retry: '重试',
        loading: '加载中…',
        save: '保存',
        edit: '编辑',
        delete: '删除',
        colName: '姓名',
        colEmail: '邮箱',
        colPhone: '电话',
        colDepartment: '部门',
        colCompany: '公司',
        colJobTitle: '职位',
        colStatus: '状态',
        colHiredAt: '入职日期',
      },
    }

    /** Board status colours, shared by the employee and service chips. */
    const STATUS_COLOR = {
      done: 'var(--dsw-alias-state-success-primary, #2ea043)',
      active: 'var(--dsw-alias-brand-primary, #4f8cff)',
      blocked: 'var(--dsw-alias-state-error-primary, #f85149)',
      failed: 'var(--dsw-alias-state-error-primary, #f85149)',
      waiting: 'var(--dsw-alias-state-warning-primary, #d29922)',
      todo: 'var(--dsw-alias-label-secondary)',
    }

    /** Shared inline styles for the company surfaces. */
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
      row: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px', padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      statRow: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
      stat: {
        flex: '1 1 120px', background: 'var(--dsw-alias-bg-layer-1)', border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '2px',
      },
      statValue: { fontSize: '22px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)', fontVariantNumeric: 'tabular-nums' },
      statLabel: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', letterSpacing: '.4px' },
      stageMeta: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      sectionTitle: { margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      badge: {
        fontSize: '11px', padding: '2px 8px', borderRadius: '999px',
        border: '1px solid var(--dsw-alias-border-l1)', color: 'var(--dsw-alias-label-secondary)',
        whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '4px',
      },
      busy: { opacity: 0.6, cursor: 'wait' },
    }

    const COMPANY_CSS = `
.wb-btn { font: inherit; }
.wb-btn:hover { border-color: var(--dsw-alias-border-l2); }
.wb-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.wb-input:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; border-color: var(--dsw-alias-brand-primary) !important; }
.wb-employee-row:hover { background: var(--dsw-alias-bg-layer-1); }
.wb-primary:hover { filter: brightness(1.08); }
.wb-primary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
`

    /** Locale-aware translator; falls back to the bundled dictionary. */
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

    /** Measures the room the host gives the page and fills it down to the bottom. */
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

    function Empty(props) {
      return h('p', { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: '1.6' } }, props.text)
    }

    /** Secondary action button, with a fixed box so labels never stack. */
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
    const dangerButton = {
      ...subtleButton,
      color: STATUS_COLOR.blocked,
      borderColor: STATUS_COLOR.blocked,
      background: 'rgba(248,81,73,.16)',
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

    /** A modal that is announced, traps focus and restores it on close. */
    function Dialog(props) {
      const { title, children, error, busy, confirmLabel, cancelLabel, onCancel, onConfirm } = props
      const panelRef = useRef(null)
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

    // ------------------------------------------------------------------
    // Finance: bank-statement CSV -> dashboard.
    //
    // One page, one question: "where did the money go, by category and by
    // period". The period/category/direction filters live in the page as chips
    // — no settings dialog between the owner and the numbers.
    // ------------------------------------------------------------------
    const FIN_INCOME = 'var(--dsw-alias-state-success-primary, #2ea043)'
    const FIN_EXPENSE = 'var(--dsw-alias-state-error-primary, #f85149)'
    const FIN_CHIP = {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '30px', padding: '0 12px', borderRadius: '999px', cursor: 'pointer',
      border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)', font: 'inherit', fontSize: '12px',
    }
    const FIN_CHIP_ACTIVE = {
      ...FIN_CHIP,
      borderColor: 'var(--dsw-alias-brand-primary)',
      color: 'var(--dsw-alias-label-primary)',
      background: 'var(--dsw-alias-brand-primary)',
      backgroundColor: 'color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent)',
    }
    const financeMoney = value => (Number(value) || 0).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

    // `department` is derived from the linked organization department so the
    // employee record and the org tree can never disagree.
    const EMPLOYEE_FIELDS = [
      { key: 'name', label: '姓名', required: true },
      { key: 'email', label: '邮箱', required: true },
      { key: 'phone', label: '电话' },
      { key: 'job_title', label: '职位' },
    ]
    const EMPTY_EMPLOYEE = { name: '', email: '', phone: '', department: '', job_title: '', status: 'active', hired_at: '', companyId: '', departmentId: '' }

    /**
     * The dependency strip: whether the company app's database and server are
     * ready. It polls `/company/services` and can start/stop the app server.
     */
    function ServicesStrip(props) {
      const { t } = props
      const [services, setServices] = useState(null)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState(null)

      const call = useCallback(async (input, init) => {
        const response = await fetch(input, init)
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
        return body
      }, [])

      const load = useCallback(async () => {
        try {
          const body = await call('/company/services', { credentials: 'same-origin' })
          setServices(Array.isArray(body?.data) ? body.data : [])
        } catch {
          setServices([])
        }
      }, [call])

      useEffect(() => {
        load()
        const timer = setInterval(load, 5000)
        return () => clearInterval(timer)
      }, [load])

      const run = useCallback(async (serviceId, action) => {
        setBusy(`${serviceId}:${action}`)
        setError(null)
        try {
          await call('/company/services', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ serviceId, action }),
          })
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy('')
          await load()
        }
      }, [call, load])

      return h('div', {
        style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      },
        h('span', { style: { letterSpacing: '1px' } }, t('servicesLabel')),
        services === null
          ? h('span', {}, t('serviceChecking'))
          : services.map(service => {
              const label = service.id === 'db' ? t('serviceDb') : t('serviceWeb')
              const statusText = service.status === 'ready' ? t('serviceReady')
                : service.status === 'running' ? t('serviceRunning')
                : service.status === 'missing' ? t('serviceMissing')
                : t('serviceStopped')
              const color = service.status === 'running' || service.status === 'ready' ? STATUS_COLOR.done
                : service.status === 'missing' ? STATUS_COLOR.blocked
                : 'var(--dsw-alias-label-secondary)'
              return h('span', { key: service.id, style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
                h('span', { style: { ...s.badge, color } }, `${label} · ${statusText}`),
                service.controls
                  ? h('button', {
                      type: 'button', className: 'wb-btn',
                      disabled: busy !== '',
                      style: { ...(service.status === 'running' ? dangerButton : subtleButton), height: '24px', minWidth: '46px', fontSize: '11px' },
                      onClick: () => run(service.id, service.status === 'running' ? 'stop' : 'start'),
                    }, service.status === 'running' ? t('serviceStop') : t('serviceStart'))
                  : null)
            }),
        error ? h('span', { style: s.error }, `${t('serviceFailed')} ${error}`) : null)
    }

    /**
     * 员工管理, native to the panel. The company workspace owns the SQLite
     * file; the panel reads and writes that same database, so there is no
     * iframe and no second UI.
     */
    function EmployeeAdmin(props) {
      const { t } = props
      const [rows, setRows] = useState([])
      const [total, setTotal] = useState(0)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState(null)
      const [search, setSearch] = useState('')
      const [query, setQuery] = useState('')
      const [notice, setNotice] = useState(null)
      const [form, setForm] = useState(null)
      const [formError, setFormError] = useState(null)
      const [formBusy, setFormBusy] = useState(false)
      const [formFields, setFormFields] = useState({})
      const [org, setOrg] = useState({ companies: [], departments: [] })
      const [formDepartments, setFormDepartments] = useState([])
      const [companyFilter, setCompanyFilter] = useState('')
      const [target, setTarget] = useState(null)
      const [deleteBusy, setDeleteBusy] = useState(false)

      useEffect(() => {
        const timer = setTimeout(() => setQuery(search.trim()), 250)
        return () => clearTimeout(timer)
      }, [search])

      const call = useCallback(async (input, init) => {
        const response = await fetch(input, init)
        const body = await response.json().catch(() => null)
        if (!response.ok) {
          const failure = new Error(body?.error?.message ?? `HTTP ${response.status}`)
          failure.code = body?.error?.code
          failure.details = body?.error?.details ?? null
          throw failure
        }
        return body
      }, [])

      const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const params = new URLSearchParams({ limit: '50' })
          if (query !== '') params.set('search', query)
          if (companyFilter !== '') params.set('companyId', companyFilter)
          const body = await call(`/company/employees?${params.toString()}`, { credentials: 'same-origin' })
          setRows(Array.isArray(body?.data) ? body.data : [])
          setTotal(Number(body?.total ?? 0))
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setLoading(false)
        }
      }, [call, query, companyFilter])

      useEffect(() => { load() }, [load])

      const loadOrg = useCallback(async (companyId = '') => {
        try {
          const suffix = companyId === '' ? '' : `?companyId=${encodeURIComponent(companyId)}`
          const body = await call(`/company/organization${suffix}`, { credentials: 'same-origin' })
          const data = body?.data ?? {}
          setOrg({ companies: data.companies ?? [], departments: data.departments ?? [] })
          setFormDepartments(data.departments ?? [])
        } catch {
          setOrg({ companies: [], departments: [] })
          setFormDepartments([])
        }
      }, [call])

      useEffect(() => { loadOrg() }, [loadOrg])

      const save = useCallback(async () => {
        setFormBusy(true)
        setFormError(null)
        setFormFields({})
        try {
          // Send the editable contract only: the row also carries display and
          // bookkeeping fields (companyName, created_at, …) that an update must
          // not echo back to the host.
          const values = form.values
          const employee = {
            name: values.name,
            email: values.email,
            phone: values.phone,
            department: values.department,
            job_title: values.job_title,
            status: values.status,
            hired_at: values.hired_at,
            companyId: values.companyId,
            departmentId: values.departmentId,
          }
          if (employee.hired_at === '') employee.hired_at = null
          employee.companyId = employee.companyId === '' || employee.companyId === undefined ? null : Number(employee.companyId)
          employee.departmentId = employee.departmentId === '' || employee.departmentId === undefined ? null : Number(employee.departmentId)
          // Keep the app's text column in sync with the structured link. If the
          // department list has not arrived yet, keep whatever text is there
          // rather than erasing it mid-load.
          const linked = formDepartments.find(item => item.id === employee.departmentId)
          if (linked) employee.department = linked.name
          else if (employee.departmentId === null) employee.department = null
          const payload = form.mode === 'edit'
            ? { op: 'update', id: form.id, patch: employee }
            : { op: 'create', employee }
          const body = await call('/company/employees', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(payload),
          })
          setForm(null)
          setNotice(t('employeeSaved').replace('{name}', String(body?.data?.name ?? employee.name)))
          await load()
        } catch (failure) {
          setFormError(String(failure?.message ?? failure))
          const details = Array.isArray(failure?.details) ? failure.details : []
          const fields = {}
          for (const detail of details) if (detail && typeof detail.field === 'string') fields[detail.field] = detail.message
          if (Object.keys(fields).length === 0 && failure?.code === 'EMAIL_CONFLICT') fields.email = String(failure.message)
          setFormFields(fields)
        } finally {
          setFormBusy(false)
        }
      }, [call, form, load, t])

      const remove = useCallback(async () => {
        setDeleteBusy(true)
        try {
          await call('/company/employees', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ op: 'delete', id: target.id }),
          })
          setTarget(null)
          setNotice(t('employeeDeleted').replace('{name}', String(target.name)))
          await load()
        } catch (failure) {
          setTarget(null)
          setNotice(null)
          setError(String(failure?.message ?? failure))
          await load()
        } finally {
          setDeleteBusy(false)
        }
      }, [call, load, target, t])

      const openCreate = () => {
        setFormError(null)
        setFormFields({})
        loadOrg(companyFilter)
        setForm({ mode: 'create', values: { ...EMPTY_EMPLOYEE, companyId: companyFilter } })
      }
      const openEdit = row => {
        setFormError(null)
        setFormFields({})
        loadOrg(row.companyId ?? '')
        setForm({ mode: 'edit', id: row.id, values: { ...EMPTY_EMPLOYEE, ...row, hired_at: row.hired_at ?? '', companyId: row.companyId ?? '', departmentId: row.departmentId ?? '' } })
      }
      const setValue = (key, value) => setForm(current => ({ ...current, values: { ...current.values, [key]: value } }))

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
        h('div', { style: s.card },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' } },
            h('h2', { style: { ...s.sectionTitle, fontSize: '16px', margin: 0 } }, t('employeeTitle')),
            h('span', { style: s.stageMeta }, t('employeeTotal').replace('{total}', String(total)))),
          h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
            h('input', {
              type: 'search',
              className: 'wb-input',
              value: search,
              placeholder: t('employeeSearch'),
              'aria-label': t('employeeSearch'),
              style: { ...fieldStyle, maxWidth: '380px', height: '36px' },
              onInput: event => setSearch(event.target.value),
            }),
            org.companies.length > 0
              ? h('select', {
                  value: companyFilter,
                  'aria-label': t('colCompany'),
                  style: { ...fieldStyle, maxWidth: '220px', height: '36px' },
                  onChange: event => setCompanyFilter(event.target.value),
                },
                  h('option', { value: '' }, t('employeeAllCompanies')),
                  org.companies.map(item => h('option', { key: item.id, value: String(item.id) }, item.name)))
              : null,
            h('button', {
              type: 'button', className: 'wb-btn wb-primary',
              style: { ...s.button, marginLeft: 'auto', minHeight: '36px', padding: '0 16px' },
              onClick: openCreate,
            }, `＋ ${t('employeeCreate')}`)),
          error ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
            h('p', { style: s.error }, error),
            h('button', { type: 'button', className: 'wb-btn', style: { ...s.badge, cursor: 'pointer' }, onClick: load }, t('retry'))) : null,
          notice ? h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', color: 'var(--dsw-alias-state-success-primary)', fontSize: '12px' } },
            h('span', {}, notice),
            h('button', { type: 'button', className: 'wb-btn', style: { ...s.badge, cursor: 'pointer' }, onClick: () => setNotice(null) }, t('closeNotice'))) : null,
          loading
            ? h('p', { style: s.muted }, t('loading'))
            : rows.length === 0
              ? h(Empty, { text: query === '' ? t('employeeEmpty') : t('employeeNoSearch') })
              : h('div', { style: { display: 'flex', flexDirection: 'column', overflowX: 'auto' } },
                  h('div', { style: { display: 'grid', minWidth: '900px', gridTemplateColumns: '1.1fr 1.6fr 1fr 1fr 1fr 0.9fr 1fr 108px', gap: '8px', padding: '8px 4px', borderBottom: '1px solid var(--dsw-alias-border-l2)', fontSize: '11px', fontWeight: 600, letterSpacing: '.8px', textTransform: 'uppercase', color: 'var(--dsw-alias-label-secondary)' },
                  }, [t('colName'), t('colEmail'), t('colCompany'), t('colDepartment'), t('colJobTitle'), t('colStatus'), t('colHiredAt'), ''].map((label, index) => h('span', { key: `h-${index}` }, label))),
                  rows.map(row => h('div', {
                    key: row.id,
                    className: 'wb-employee-row',
                    style: { display: 'grid', gridTemplateColumns: '1.1fr 1.6fr 1fr 1fr 1fr 0.9fr 1fr 108px', gap: '8px', padding: '10px 4px', borderBottom: '1px solid var(--dsw-alias-border-l1)', fontSize: '13px', alignItems: 'center', borderRadius: '4px' },
                  },
                    h('span', { style: { color: 'var(--dsw-alias-label-primary)' } }, row.name),
                    h('span', { style: { color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.email),
                    h('span', { style: { color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, row.companyName ?? '—'),
                    h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, row.departmentName ?? row.department ?? '—'),
                    h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, row.job_title ?? '—'),
                    h('span', { style: { color: row.status === 'active' ? STATUS_COLOR.done : 'var(--dsw-alias-label-secondary)' } }, row.status === 'active' ? t('employeeActive') : t('employeeInactive')),
                    h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, row.hired_at ?? '—'),
                    h('span', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' } },
                      h('button', { type: 'button', className: 'wb-btn', style: subtleButton, onClick: () => openEdit(row) }, t('edit')),
                      h('button', { type: 'button', className: 'wb-btn', style: dangerButton, onClick: () => setTarget(row) }, t('delete'))))))),

        form
          ? h(Dialog, {
              title: form.mode === 'edit' ? t('employeeEditTitle') : t('employeeCreateTitle'),
              error: formError,
              busy: formBusy,
              confirmLabel: t('save'),
              cancelLabel: t('cancel'),
              onCancel: () => setForm(null),
              onConfirm: save,
            },
              h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' } },
                h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
                  h('span', {}, t('colCompany')),
                  h('select', {
                    value: form.values.companyId === '' ? '' : String(form.values.companyId),
                    style: fieldStyle,
                    onChange: event => {
                      const next = event.target.value
                      setValue('companyId', next)
                      setValue('departmentId', '')
                      loadOrg(next)
                    },
                  },
                    h('option', { value: '' }, '—'),
                    org.companies.map(item => h('option', { key: item.id, value: String(item.id) }, item.name)))),
                h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
                  h('span', {}, t('colDepartment')),
                  h('select', {
                    value: form.values.departmentId === '' ? '' : String(form.values.departmentId),
                    style: fieldStyle,
                    disabled: org.companies.length === 0,
                    onChange: event => setValue('departmentId', event.target.value),
                  },
                    h('option', { value: '' }, '—'),
                    formDepartments.map(item => h('option', { key: item.id, value: String(item.id) }, item.name))))),
              h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } },
                EMPLOYEE_FIELDS.map(field => h('label', { key: field.key, style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
                  h('span', {}, `${t(field.label === '姓名' ? 'colName' : field.label === '邮箱' ? 'colEmail' : field.key === 'phone' ? 'colPhone' : field.key === 'department' ? 'colDepartment' : 'colJobTitle')}${field.required ? ' *' : ''}`),
                  h('input', {
                    value: form.values[field.key] ?? '',
                    'aria-invalid': formFields[field.key] ? 'true' : undefined,
                    style: formFields[field.key] ? { ...fieldStyle, borderColor: 'var(--dsw-alias-state-error-primary)' } : fieldStyle,
                    onInput: event => setValue(field.key, event.target.value),
                  }),
                  formFields[field.key] ? h('span', { style: s.error }, formFields[field.key]) : null)),
                h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
                  h('span', {}, t('colStatus')),
                  h('select', {
                    value: form.values.status,
                    style: fieldStyle,
                    onChange: event => setValue('status', event.target.value),
                  },
                    h('option', { value: 'active' }, t('employeeActive')),
                    h('option', { value: 'inactive' }, t('employeeInactive')))),
                h('label', { style: { display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' } },
                  h('span', {}, t('colHiredAt')),
                  h('input', {
                    type: 'date',
                    value: form.values.hired_at ?? '',
                    style: fieldStyle,
                    onInput: event => setValue('hired_at', event.target.value),
                  }))))
          : null,

        target
          ? h(Dialog, {
              title: t('employeeDeleteTitle'),
              busy: deleteBusy,
              confirmLabel: t('delete'),
              cancelLabel: t('cancel'),
              onCancel: () => setTarget(null),
              onConfirm: remove,
            }, h('p', { style: s.muted }, t('employeeDeleteConfirm').replace('{name}', String(target.name))))
          : null)
    }

    /**
     * Organization structure, native to the panel.
     *
     * Several companies can live side by side; departments and job levels
     * belong to the selected company. Every row can be added, edited and
     * deleted, and the host refuses destructive deletes that would orphan
     * children instead of silently cascading.
     */
    function OrgAdmin(props) {
      const { t } = props
      // `initialData` is a render/test seam so the static harness can show a
      // populated organization without a host.
      const [data, setData] = useState(props.initialData ?? null)
      const [error, setError] = useState(null)
      const [notice, setNotice] = useState(null)
      const [busy, setBusy] = useState(false)
      const [companyForm, setCompanyForm] = useState(null)
      const [deptForm, setDeptForm] = useState(null)
      const [levelForm, setLevelForm] = useState(null)

      const call = useCallback(async (method, payload) => {
        const url = method === 'GET'
          ? `/company/organization${payload?.companyId ? `?companyId=${payload.companyId}` : ''}`
          : '/company/organization'
        const response = await fetch(url, {
          method,
          headers: { 'content-type': 'application/json' },
          credentials: 'same-origin',
          ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
        })
        const body = await response.json().catch(() => null)
        if (!response.ok) {
          const failure = new Error(body?.error?.message ?? `HTTP ${response.status}`)
          failure.details = body?.error?.details ?? null
          throw failure
        }
        return body
      }, [])

      const [companyId, setCompanyId] = useState(props.initialData?.company?.id ?? 0)
      const load = useCallback(async (wanted = 0) => {
        setError(null)
        try {
          const body = await call('GET', { companyId: wanted })
          const next = body?.data ?? null
          setData(next)
          if (next?.company) setCompanyId(next.company.id)
          else if (wanted !== 0) setCompanyId(wanted)
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        }
      }, [call])

      useEffect(() => { if (props.initialData === undefined) load(companyId) }, [])  // eslint-disable-line react-hooks/exhaustive-deps

      const run = useCallback(async (payload, successText) => {
        setBusy(true)
        setNotice(null)
        setError(null)
        try {
          const body = await call('POST', payload)
          setNotice(successText)
          const nextCompanyId = payload.companyId ?? companyId
          setCompanyForm(null)
          setDeptForm(null)
          setLevelForm(null)
          await load(nextCompanyId)
          return body
        } catch (failure) {
          setError(String(failure?.message ?? failure))
          return null
        } finally {
          setBusy(false)
        }
      }, [call, companyId, load])

      const pickCompany = id => {
        setCompanyId(id)
        setDeptForm(null)
        setLevelForm(null)
        load(id)
      }

      const removeCompany = company => {
        if (typeof window !== 'undefined' && window.confirm && !window.confirm(t('orgDeleteConfirm').replace('{name}', company.name))) return
        run({ op: 'company.delete', id: company.id }, t('orgCompanyDeleted'))
      }

      const companies = data?.companies ?? []
      const departments = data?.departments ?? []
      const levels = data?.jobLevels ?? []
      const company = data?.company ?? null
      const nameOfDept = id => (departments.find(item => item.id === id) || {}).name || t('orgNone')
      const depthOf = dept => {
        let depth = 0
        let cursor = dept.parentDepartmentId
        const guard = new Set([dept.id])
        while (cursor !== null && cursor !== undefined && !guard.has(cursor)) {
          guard.add(cursor)
          depth += 1
          cursor = (departments.find(item => item.id === cursor) || {}).parentDepartmentId ?? null
        }
        return depth
      }

      const rowStyle = { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)', fontSize: '12px' }
      const smallButton = { ...subtleButton, minHeight: '26px', height: '26px', padding: '0 10px', fontSize: '11px' }
      const dangerSmall = { ...smallButton, color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' }

      const deptRow = dept => {
        const depth = depthOf(dept)
        return h('div', { key: dept.id, style: rowStyle },
          h('span', { style: { color: 'var(--dsw-alias-label-primary)', flex: '1 1 auto', paddingLeft: `${depth * 16}px`, minWidth: '120px' } },
            depth > 0 ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)', marginRight: '4px' } }, '└') : null,
            dept.name),
          h('span', { style: s.stageMeta }, `${t('orgParent')}：${nameOfDept(dept.parentDepartmentId)} · ${t('orgSort')} ${dept.sortOrder ?? '-'}`),
          h('button', {
            type: 'button', className: 'wb-btn', style: smallButton,
            onClick: () => setDeptForm({ id: dept.id, name: dept.name, parentDepartmentId: dept.parentDepartmentId ?? '', sortOrder: dept.sortOrder ?? '' }),
          }, t('edit')),
          h('button', {
            type: 'button', className: 'wb-btn', title: t('orgDelete'), 'aria-label': `${t('orgDelete')} ${dept.name}`,
            style: { ...dangerSmall, minWidth: '28px', width: '28px', padding: 0, justifyContent: 'center' }, disabled: busy,
            onClick: () => {
              if (window.confirm(t('orgDeleteConfirm').replace('{name}', dept.name))) run({ op: 'department.delete', id: dept.id }, t('orgDeptDeleted'))
            },
          }, '✕'))
      }

      const levelRow = level => h('div', { key: level.id, style: rowStyle },
        h('span', { style: { color: 'var(--dsw-alias-label-primary)', flex: '1 1 auto', minWidth: '120px' } }, level.name),
        h('span', { style: s.stageMeta }, `${t('orgRank')} ${level.rankOrder ?? '-'}`),
        h('button', {
          type: 'button', className: 'wb-btn', style: smallButton,
          onClick: () => setLevelForm({ id: level.id, name: level.name, rankOrder: level.rankOrder ?? '' }),
        }, t('edit')),
        h('button', {
          type: 'button', className: 'wb-btn', title: t('orgDelete'), 'aria-label': `${t('orgDelete')} ${level.name}`,
          style: { ...dangerSmall, minWidth: '28px', width: '28px', padding: 0, justifyContent: 'center' }, disabled: busy,
          onClick: () => {
            if (window.confirm(t('orgDeleteConfirm').replace('{name}', level.name))) run({ op: 'joblevel.delete', id: level.id }, t('orgLevelDeleted'))
          },
        }, '✕'))

      const form = (draft, setDraft, onSave, extra) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px' } },
        h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } },
          h('input', { value: draft.name ?? '', placeholder: t('colName'), style: { ...fieldStyle, maxWidth: '220px' }, onInput: event => setDraft({ ...draft, name: event.target.value }) }),
          extra),
        h('div', { style: { display: 'flex', gap: '6px' } },
          h('button', { type: 'button', className: 'wb-btn wb-primary', disabled: busy, style: { ...s.button, minHeight: '30px', padding: '0 12px' }, onClick: () => onSave(draft) }, t('orgSave')),
          h('button', { type: 'button', className: 'wb-btn', style: subtleButton, onClick: () => setDraft(null) }, t('cancel'))))

      const selectStyle = { ...fieldStyle, minHeight: '32px', maxWidth: '260px' }

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', flex: '1 1 auto', minHeight: 0, overflowY: 'auto' } },
        error ? h('p', { style: s.error }, error) : null,
        notice ? h('p', { style: s.stageMeta }, notice) : null,

        h('div', { style: s.card },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h('h2', { style: { ...s.sectionTitle, fontSize: '16px', margin: 0 } }, t('orgCompanies')),
            companies.length > 0
              ? h('select', {
                  value: String(companyId),
                  style: selectStyle,
                  onChange: event => pickCompany(Number(event.target.value)),
                }, companies.map(item => h('option', { key: item.id, value: String(item.id) }, item.name)))
              : h('span', { style: s.stageMeta }, t('orgNoCompany')),
            h('button', {
              type: 'button', className: 'wb-btn', style: { ...subtleButton, marginLeft: 'auto' },
              onClick: () => setCompanyForm({ mode: 'create', name: '' }),
            }, `＋ ${t('orgCreateCompany')}`),
            company
              ? h('button', {
                  type: 'button', className: 'wb-btn', style: subtleButton,
                  onClick: () => setCompanyForm({ mode: 'rename', id: company.id, name: company.name }),
                }, t('orgRenameCompany'))
              : null,
            company
              ? h('button', { type: 'button', className: 'wb-btn', style: dangerSmall, onClick: () => removeCompany(company) }, t('orgDeleteCompany'))
              : null),
          companyForm === null
            ? null
            : h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
                h('input', {
                  value: companyForm.name ?? '',
                  placeholder: t('colName'),
                  style: { ...fieldStyle, maxWidth: '280px' },
                  onInput: event => setCompanyForm({ ...companyForm, name: event.target.value }),
                }),
                h('button', {
                  type: 'button', className: 'wb-btn wb-primary', disabled: busy,
                  style: { ...s.button, minHeight: '32px', padding: '0 12px' },
                  onClick: () => (companyForm.mode === 'create'
                    ? run({ op: 'company.create', name: companyForm.name }, t('orgCompanySaved2'))
                    : run({ op: 'company.rename', id: companyForm.id, name: companyForm.name }, t('orgCompanySaved2'))),
                }, t('orgSave')),
                h('button', { type: 'button', className: 'wb-btn', style: subtleButton, onClick: () => setCompanyForm(null) }, t('cancel')))),

        company === null
          ? h('div', { style: s.card }, h(Empty, { text: t('orgNoCompany') }))
          : [
              h('div', { key: 'depts', style: s.card },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                  h('h2', { style: { ...s.sectionTitle, fontSize: '16px', margin: 0 } }, t('orgDepartments')),
                  h('button', {
                    type: 'button', className: 'wb-btn', style: { ...subtleButton, marginLeft: 'auto' },
                    onClick: () => setDeptForm({ id: null, name: '', parentDepartmentId: '', sortOrder: '' }),
                  }, `＋ ${t('orgCreateDepartment')}`)),
                departments.length === 0 ? h(Empty, { text: t('orgEmpty') }) : departments.map(deptRow),
                deptForm === null
                  ? null
                  : form(deptForm, setDeptForm, draft => run({
                      op: draft.id ? 'department.update' : 'department.create',
                      id: draft.id,
                      companyId,
                      name: draft.name,
                      parentDepartmentId: draft.parentDepartmentId === '' ? null : draft.parentDepartmentId,
                      sortOrder: draft.sortOrder === '' ? null : draft.sortOrder,
                    }, t('orgDeptSaved')),
                    h('select', {
                      value: deptForm.parentDepartmentId ?? '',
                      style: { ...fieldStyle, maxWidth: '200px' },
                      onChange: event => setDeptForm({ ...deptForm, parentDepartmentId: event.target.value === '' ? '' : Number(event.target.value) }),
                    },
                      h('option', { value: '' }, `${t('orgParent')}：${t('orgNone')}`),
                      departments.filter(item => item.id !== deptForm.id).map(item => h('option', { key: item.id, value: item.id }, item.name))))),

              h('div', { key: 'levels', style: s.card },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                  h('h2', { style: { ...s.sectionTitle, fontSize: '16px', margin: 0 } }, t('orgJobLevels')),
                  h('button', {
                    type: 'button', className: 'wb-btn', style: { ...subtleButton, marginLeft: 'auto' },
                    onClick: () => setLevelForm({ id: null, name: '', rankOrder: '' }),
                  }, `＋ ${t('orgCreateLevel')}`)),
                levels.length === 0 ? h(Empty, { text: t('orgEmpty') }) : levels.map(levelRow),
                levelForm === null
                  ? null
                  : form(levelForm, setLevelForm, draft => run({
                      op: draft.id ? 'joblevel.update' : 'joblevel.create',
                      id: draft.id,
                      companyId,
                      name: draft.name,
                      rankOrder: draft.rankOrder === '' ? null : draft.rankOrder,
                    }, t('orgLevelSaved')),
                    h('input', {
                      value: levelForm.rankOrder ?? '',
                      placeholder: t('orgRank'),
                      style: { ...fieldStyle, maxWidth: '90px' },
                      onInput: event => setLevelForm({ ...levelForm, rankOrder: event.target.value }),
                    }))),
            ])
    }

    /**
     * Finance dashboard for the company workspace.
     *
     * It reads `/company/finance`; the source can be a statement folder or the
     * delivered app's SQLite database. The source editor is a plain path input
     * plus save — the host cannot rely on a native picker here.
     */
    function FinanceTab(props) {
      const { t } = props
      // `initialData` is a test seam, like `__components`: the unit harness has
      // no fetch, so the populated page is rendered from one payload instead.
      const seeded = props.initialData
      const [data, setData] = useState(seeded ?? null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(seeded === undefined)
      const [preset, setPreset] = useState('thisMonth')
      const [category, setCategory] = useState('')
      const [direction, setDirection] = useState('')
      const [search, setSearch] = useState('')
      const [query, setQuery] = useState('')
      const [editor, setEditor] = useState(null)
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState(null)

      const call = useCallback(async (input, init) => {
        const response = await fetch(input, init)
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
        return body
      }, [])

      const load = useCallback(async () => {
        setLoading(true)
        try {
          const params = new URLSearchParams({ preset })
          if (category !== '') params.set('category', category)
          if (direction !== '') params.set('direction', direction)
          if (query !== '') params.set('q', query)
          const body = await call(`/company/finance?${params.toString()}`, { credentials: 'same-origin' })
          setData(body)
          setError(null)
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setLoading(false)
        }
      }, [call, preset, category, direction, query])

      useEffect(() => { load() }, [load])
      useEffect(() => {
        const timer = setTimeout(() => setQuery(search.trim()), 250)
        return () => clearTimeout(timer)
      }, [search])

      const post = useCallback(payload => call('/company/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      }), [call])

      const saveSource = useCallback(async () => {
        setBusy('source')
        setNotice(null)
        setError(null)
        try {
          const payload = editor?.source === 'sqlite'
            ? { op: 'set-source', source: 'sqlite', dbPath: String(editor.path ?? '').trim() }
            : { op: 'set-source', source: 'files', dir: String(editor?.path ?? '').trim() }
          await post(payload)
          setEditor(null)
          setNotice(t('financeSourceSaved'))
          await load()
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy('')
        }
      }, [editor, load, post, t])

      const openEditor = useCallback(() => {
        setNotice(null)
        setError(null)
        setEditor(data === null
          ? { source: 'files', path: '' }
          : { source: data.source === 'sqlite' ? 'sqlite' : 'files', path: data.source === 'sqlite' ? (data.dbPath ?? '') : (data.dir ?? '') })
      }, [data])

      const importAll = useCallback(async () => {
        setBusy('import')
        setNotice(null)
        setError(null)
        try {
          const body = await post({ op: 'import' })
          const result = body?.result ?? {}
          const imported = Array.isArray(result.imported) ? result.imported.length : 0
          const skipped = Array.isArray(result.skipped) ? result.skipped.length : 0
          const failed = Array.isArray(result.errors) ? result.errors.length : 0
          const rows = (result.imported ?? []).reduce((sum, item) => sum + (item.rows ?? 0), 0)
          if (imported === 0 && failed === 0) {
            setNotice(t('financeImportNone'))
          } else {
            setNotice(
              t('financeImportResult').replace('{files}', String(imported)).replace('{rows}', String(rows))
              + (skipped > 0 ? ` · ${t('financeImportSkipped').replace('{n}', String(skipped))}` : '')
              + (failed > 0 ? ` · ${t('financeImportErrors').replace('{n}', String(failed))}` : ''),
            )
          }
          await load()
        } catch (failure) {
          setError(String(failure?.message ?? failure))
        } finally {
          setBusy('')
        }
      }, [load, post, t])

      if (data === null) {
        return h('div', { style: s.card },
          h(Empty, { text: error ?? t('loading') }),
          error
            ? h('button', { type: 'button', className: 'wb-btn', style: s.button, onClick: () => load() }, t('retry'))
            : null)
      }

      const source = data.source === 'sqlite' ? 'sqlite' : 'files'
      const sourcePath = source === 'sqlite' ? (data.dbPath ?? '') : (data.dir ?? '')
      const summary = data.summary ?? {}
      const totals = summary.totals ?? { income: 0, expense: 0, net: 0 }
      const months = Array.isArray(summary.byMonth) ? summary.byMonth : []
      const categories = Array.isArray(summary.byCategory) ? summary.byCategory.slice(0, 8) : []
      const transactions = Array.isArray(data.transactions) ? data.transactions : []
      const files = Array.isArray(data.files) ? data.files : []
      const categoryOptions = Array.isArray(data.categories) ? data.categories : []
      const pending = files.filter(file => file.importedAt === null).length
      const maxBar = Math.max(1, ...months.map(month => Math.max(month.income, month.expense)))
      const maxCategory = Math.max(1, ...categories.map(item => item.total))
      const hasData = (data.totalTransactions ?? 0) > 0

      const periodChips = [
        ['thisMonth', t('financePeriodMonth')],
        ['last3', t('financePeriodLast3')],
        ['thisYear', t('financePeriodYear')],
        ['all', t('financePeriodAll')],
      ]

      const statCard = (label, value, color) => h('div', { key: label, style: s.stat },
        h('span', { style: { ...s.statValue, color, fontSize: '20px' } }, value),
        h('span', { style: s.statLabel }, label))

      // The monthly chart is a column per month with an income bar and an
      // expense bar. Heights are pixels on purpose: percentage heights inside
      // a flex column depend on the browser resolving an indefinite parent
      // height, and a chart that collapses is worse than a small one.
      // Two years of books means 21+ month columns; printing every label turns
      // the axis into a smear. Label roughly one per 12 columns and keep the
      // full month in the tooltip.
      const labelEvery = months.length > 12 ? Math.ceil(months.length / 12) : 1
      const monthBar = (month, index) => h('div', {
        key: month.month,
        title: `${month.month} · ${t('financeIncome')} ¥${financeMoney(month.income)} · ${t('financeExpense')} ¥${financeMoney(month.expense)}`,
        style: {
          flex: '1 1 0', minWidth: '14px', height: '100%',
          display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: '6px',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '3px', flex: '1 1 auto', minHeight: 0 } },
          h('span', { style: { flex: 1, height: `${Math.max(2, Math.round((month.income / maxBar) * 132))}px`, background: FIN_INCOME, borderRadius: '3px 3px 0 0' } }),
          h('span', { style: { flex: 1, height: `${Math.max(2, Math.round((month.expense / maxBar) * 132))}px`, background: FIN_EXPENSE, borderRadius: '3px 3px 0 0' } })),
        h('span', {
          style: { fontSize: '10px', textAlign: 'center', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
        }, index % labelEvery === 0 ? month.month.slice(2) : ''))  // 26-01 keeps the year

      const chartLegend = h('div', {
        style: { display: 'flex', gap: '16px', fontSize: '11px', color: 'var(--dsw-alias-label-secondary)' },
      },
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
          h('i', { style: { width: '8px', height: '8px', borderRadius: '2px', background: FIN_INCOME, display: 'inline-block' } }),
          t('financeIncome')),
        h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
          h('i', { style: { width: '8px', height: '8px', borderRadius: '2px', background: FIN_EXPENSE, display: 'inline-block' } }),
          t('financeExpense')))

      const chart = months.length === 0
        ? h(Empty, { text: t('financeEmptyRange') })
        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
            h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: '10px', height: '176px' } },
              months.map((month, index) => monthBar(month, index))),
            chartLegend)

      const categoryList = categories.length === 0
        ? h(Empty, { text: t('financeEmptyRange') })
        : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '9px' } },
            categories.map(item => h('div', {
              key: item.category,
              style: { display: 'grid', gridTemplateColumns: '132px 1fr 104px', gap: '10px', alignItems: 'center' },
            },
              h('span', {
                title: item.category,
                style: { fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
              }, item.category),
              h('div', { style: { height: '8px', borderRadius: '999px', background: 'var(--dsw-alias-border-l1)', overflow: 'hidden', display: 'flex' } },
                h('span', { style: { width: `${(item.expense / maxCategory) * 100}%`, background: FIN_EXPENSE } }),
                h('span', { style: { width: `${(item.income / maxCategory) * 100}%`, background: FIN_INCOME } })),
              h('span', { style: { fontSize: '11px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-secondary)' } },
                `¥${financeMoney(item.total)}`))))

      const transactionRows = transactions.length === 0
        ? h(Empty, { text: t('financeEmptyRange') })
        : h('div', { style: { display: 'flex', flexDirection: 'column' } },
            transactions.map(transaction => h('div', {
              key: transaction.id,
              style: {
                display: 'grid', gridTemplateColumns: '86px 132px minmax(0, 1fr) 116px', gap: '10px',
                alignItems: 'baseline', padding: '7px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)',
                fontSize: '12px',
              },
            },
              h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums' } }, transaction.date),
              h('span', {
                title: transaction.category,
                style: {
                  ...s.badge, justifySelf: 'start', maxWidth: '100%',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: transaction.direction === 'income' ? FIN_INCOME : FIN_EXPENSE,
                  borderColor: transaction.direction === 'income' ? FIN_INCOME : FIN_EXPENSE,
                },
              }, transaction.category),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: '1px', minWidth: 0 } },
                h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, transaction.description || t('financeNoDetail')),
                transaction.counterparty
                  ? h('span', { style: { fontSize: '10px', color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, transaction.counterparty)
                  : null),
              h('span', {
                style: {
                  textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                  color: transaction.direction === 'income' ? FIN_INCOME : FIN_EXPENSE,
                },
              }, `${transaction.direction === 'income' ? '+' : '−'}¥${financeMoney(transaction.amount)}`))))

      const fileRows = files.length === 0
        ? h(Empty, { text: t('financeNoFiles') })
        : h('div', { style: { display: 'flex', flexDirection: 'column' } },
            files.slice(0, 12).map(file => h('div', {
              key: file.name,
              style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)', fontSize: '12px' },
            },
              h('span', { style: { flex: '1 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, file.name),
              // The format matters here: xlsx and csv are both accepted, and an
              // old .xls is listed so the import can explain itself.
              h('span', { style: { ...s.badge, fontSize: '10px', color: 'var(--dsw-alias-label-secondary)' } },
                String(file.format ?? file.name.split('.').pop() ?? '').toUpperCase()),
              h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontVariantNumeric: 'tabular-nums', width: '48px', textAlign: 'right' } },
                `${Math.max(1, Math.round(file.size / 1024))} KB`),
              file.importedAt === null
                ? h('span', { style: { ...s.badge, color: STATUS_COLOR.todo } }, t('financePending'))
                : h('span', { style: { ...s.badge, color: FIN_INCOME, borderColor: FIN_INCOME } },
                    `${t('financeImported')}${file.rows === null ? '' : ` · ${file.rows}`}`))))

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', flex: '1 1 auto', minHeight: 0, overflowY: 'auto', paddingBottom: '8px' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 } },
            h('span', { style: { ...s.title, fontSize: '18px' } }, t('financeTitle')),
            h('span', { style: { ...s.muted, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
              `${source === 'sqlite' ? t('financeSourceSqlite') : t('financeSourceFiles')} · ${sourcePath}`)),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
            h('button', {
              type: 'button', className: 'wb-btn',
              style: { ...s.badge, cursor: 'pointer', minHeight: '32px' },
              onClick: openEditor,
            }, t('financeSource')),
            h('button', {
              type: 'button', className: 'wb-btn',
              style: { ...s.badge, cursor: 'pointer', minHeight: '32px' },
              onClick: () => load(),
              disabled: loading,
            }, loading ? '…' : t('financeReload')),
            source === 'files'
              ? h('button', {
                  type: 'button', className: 'wb-btn',
                  style: { ...s.button, padding: '6px 14px' },
                  onClick: importAll,
                  disabled: busy === 'import',
                }, busy === 'import' ? t('financeImporting') : `${t('financeImport')}${pending > 0 ? ` (${pending})` : ''}`)
              : null)),

        editor === null
          ? null
          : h('div', { style: { ...s.card, gap: '10px' } },
              h('span', { style: s.label }, t('financeSource')),
              h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
                [['files', t('financeSourceFiles')], ['sqlite', t('financeSourceSqlite')]].map(([key, label]) => h('button', {
                  key,
                  type: 'button',
                  style: editor.source === key ? FIN_CHIP_ACTIVE : FIN_CHIP,
                  onClick: () => setEditor(current => ({ ...current, source: key })),
                }, label))),
              h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
                h('input', {
                  style: { ...s.textarea, minHeight: '38px', resize: 'none', flex: '1 1 320px' },
                  value: editor.path ?? '',
                  placeholder: editor.source === 'sqlite' ? t('financeDbPlaceholder') : t('financeDirPlaceholder'),
                  onChange: event => setEditor(current => ({ ...current, path: event.target.value })),
                  onKeyDown: event => { if (event.key === 'Enter') saveSource() },
                }),
                h('button', {
                  type: 'button', className: 'wb-btn',
                  style: { ...s.button, padding: '6px 14px' },
                  onClick: saveSource,
                  disabled: busy === 'source',
                }, t('financeSave')),
                h('button', {
                  type: 'button', className: 'wb-btn',
                  style: { ...s.badge, cursor: 'pointer', minHeight: '32px' },
                  onClick: () => { setEditor(null); setNotice(null) },
                }, t('financeCancel')))),


        error !== null ? h('p', { style: s.error }, error) : null,
        notice !== null ? h('p', { style: { ...s.muted, color: FIN_INCOME } }, notice) : null,

        source === 'sqlite' && data.dbExists === false
          ? h('div', { style: s.card },
              h('p', { style: s.error }, t('financeDbError').replace('{msg}', String(data.dbError ?? ''))),
              h('p', { style: s.muted }, sourcePath))
          : null,

        source === 'files' && data.dirExists === false
          ? h('div', { style: s.card },
              h('p', { style: s.error }, t('financeNoDir').replace('{dir}', data.dir)),
              h('p', { style: s.muted }, String(data.dirError ?? '')))
          : null,

        hasData
          ? h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
              statCard(t('financeIncome'), `¥${financeMoney(totals.income)}`, FIN_INCOME),
              statCard(t('financeExpense'), `¥${financeMoney(totals.expense)}`, FIN_EXPENSE),
              statCard(t('financeNet'), `¥${financeMoney(totals.net)}`, Number(totals.net) < 0 ? FIN_EXPENSE : 'var(--dsw-alias-label-primary)'),
              statCard(t('financeCount'), String(summary.count ?? 0), 'var(--dsw-alias-label-primary)'))
          : h('div', { style: s.card },
              h('p', { style: s.muted }, t('financeNoData')),
              h('p', { style: { ...s.muted, fontSize: '11px' } },
                `${t('financeFiles')}: ${files.length} · ${t('financePending')}: ${pending}`)),

        hasData
          ? h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' } },
              h('span', { style: { ...s.stageMeta, letterSpacing: '.6px' } }, t('financePeriod')),
              periodChips.map(([key, label]) => h('button', {
                key, type: 'button',
                style: preset === key ? FIN_CHIP_ACTIVE : FIN_CHIP,
                onClick: () => setPreset(key),
              }, label)),
              h('span', { style: { ...s.stageMeta, letterSpacing: '.6px', marginLeft: '8px' } }, t('financeDirection')),
              [['', t('financeAll')], ['income', t('financeIncome')], ['expense', t('financeExpense')]].map(([key, label]) => h('button', {
                key: `direction-${key}`,
                type: 'button',
                style: direction === key ? FIN_CHIP_ACTIVE : FIN_CHIP,
                onClick: () => setDirection(key),
              }, label)),
              h('select', {
                value: category,
                onChange: event => setCategory(event.target.value),
                style: {
                  minHeight: '30px', borderRadius: '999px', padding: '0 10px',
                  background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)',
                  border: '1px solid var(--dsw-alias-border-l1)', font: 'inherit', fontSize: '12px',
                },
              },
                h('option', { value: '' }, `${t('financeCategory')}: ${t('financeAll')}`),
                categoryOptions.map(name => h('option', { key: name, value: name }, name))),
              h('input', {
                value: search,
                placeholder: t('financeSearchPlaceholder'),
                onChange: event => setSearch(event.target.value),
                style: {
                  flex: '1 1 180px', minWidth: '140px', minHeight: '30px', borderRadius: '999px',
                  padding: '0 12px', background: 'var(--dsw-alias-bg-layer-1)',
                  color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l1)',
                  font: 'inherit', fontSize: '12px',
                },
              }))
          : null,

        hasData
          ? h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)', gap: '12px' } },
              h('div', { style: s.card },
                h('h2', { style: s.sectionTitle }, t('financeMonthly')),
                chart),
              h('div', { style: s.card },
                h('h2', { style: s.sectionTitle }, t('financeByCategory')),
                categoryList))
          : null,

        hasData
          ? h('div', { style: s.card },
              h('h2', { style: s.sectionTitle }, `${t('financeTransactions')} · ${summary.count ?? 0}`),
              transactionRows)
          : null,

        source === 'files'
          ? h('div', { style: s.card },
              h('h2', { style: s.sectionTitle }, `${t('financeFiles')} · ${files.length}`),
              fileRows)
          : null)
    }

    /**
     * The company page: one company, three modules — employees, organization
     * and finance. No project id is involved: the plugin is single-workspace,
     * and `/company/config` is display-only.
     */
    function CompanyPage(props) {
      const { t } = props
      // `initialTab` is a render/test seam; the tabs are otherwise local view state.
      const [tab, setTab] = useState(props.initialTab ?? 'employee')
      const [config, setConfig] = useState(props.initialConfig ?? null)

      useEffect(() => {
        if (props.initialConfig !== undefined) return undefined
        let live = true
        fetch('/company/config', { credentials: 'same-origin' })
          .then(response => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
          .then(body => { if (live) setConfig(body?.data ?? null) })
          .catch(() => { /* the config route is display-only: the modules still load */ })
        return () => { live = false }
      }, [])  // eslint-disable-line react-hooks/exhaustive-deps

      const workspace = typeof config?.workspace === 'string' ? config.workspace : ''
      const appPort = config?.appPort ?? null
      const tabs = [
        ['employee', t('employeeModule')],
        ['org', t('orgModule')],
        ['finance', t('financeTab')],
      ]

      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px', flex: '1 1 auto', minHeight: 0 } },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 } },
          h('h1', { style: s.title }, t('title')),
          h('span', { style: { ...s.muted, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            `${t('companyWorkspace')}: ${workspace || '—'}`
            + (appPort === null ? '' : ` · ${t('companyAppPort')}: ${appPort}`))),
        h('div', { role: 'tablist', style: s.tabs },
          tabs.map(([key, label]) => h('button', {
            key,
            type: 'button',
            className: 'wb-btn',
            role: 'tab',
            'aria-selected': tab === key ? 'true' : 'false',
            style: tab === key ? { ...s.tab, ...s.tabActive } : s.tab,
            onClick: () => setTab(key),
          }, label))),
        h(ServicesStrip, { t }),
        tab === 'org'
          ? h(OrgAdmin, { t })
          : tab === 'finance'
            ? h(FinanceTab, { t })
            : h(EmployeeAdmin, { t }))
    }

    /** Sidebar entry icon: a small building glyph. */
    function PanelIcon() {
      return h('svg', {
        width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none',
        stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('path', { key: 'a', d: 'M2.5 13.5h11' }),
        h('path', { key: 'b', d: 'M4 13.5V4l4-1.8 4 1.8v9.5' }),
        h('path', { key: 'c', d: 'M6.5 6.5h1M8.5 6.5h1M6.5 9h1M8.5 9h1' }))
    }

    function Panel() {
      const ctx = hostCtx
      const t = useTranslate(ctx, DICT.zh)
      const [pageRef, fillHeight] = useFillHeight(8)
      return h(
        'div',
        { ref: pageRef, style: { ...s.page, ...(fillHeight === null ? {} : { height: `${fillHeight}px` }) } },
        h('style', { key: 'company-css' }, COMPANY_CSS),
        h(
          'div',
          { style: s.inner },
          h('div', { style: { flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h(CompanyPage, { t })),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      // Test seam: the panel has no unit tests otherwise, and a stray variable
      // in a component body only surfaces as a blank slot at runtime.
      __components: { Panel, CompanyPage, EmployeeAdmin, OrgAdmin, FinanceTab, ServicesStrip, Dialog },
      apply(ctx) {
        hostCtx = ctx
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
            order: 91,
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
