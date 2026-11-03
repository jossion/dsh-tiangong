# @jos/company

Company modules for the Tiangong workbench, kept as a separate DSH bundle so the
public `@jos/workbench` package stays generic:

- 员工管理 — staff directory on the delivered app's SQLite (`<workspace>/web/data/app.sqlite`)
- 组织架构 — companies / departments / job levels
- 财务管理 — bank-statement CSV import and the finance dashboard, or a read-only SQLite ledger
- 应用服务 — start/stop the delivered company app's own HTTP server

## Install (local profile)

```yaml
# profile package.json
"@jos/company": "link:/path/to/dsh-workflow-jos/packages/company"

# profile dsh.profile.bundles
"@jos/company"

# profile patch override (config lives in the user layer)
- id: company
  config:
    workspace: /path/to/company-project
    dataDir: /path/to/.dsh/workbench   # shared with @jos/workbench (finance state)
    financeDb: /path/to/company-project/data/hzy.db
```

Routes are all `/company/*` and go through the same host connection fence as the
workbench routes. The panel is its own sidebar entry (公司管理); the public
workbench no longer embeds company tabs.

`node --test tests/*.test.mjs`
