# 保险箱访问

轻量的校园保险箱密码授权网站。已导入人员使用姓名和学号登录；志愿者查看当前密码，管理者还可更新密码、导入与维护授权名单。

## 技术栈

- React 19 + TypeScript + Vite
- Cloudflare Workers + Static Assets
- Cloudflare D1
- Vitest + Cloudflare Workers test pool

## 本地开发

需要 Node.js 22+ 与 pnpm 9.15.4。

1. 执行 `pnpm install --frozen-lockfile`。
2. 将 `.dev.vars.example` 复制为 `.dev.vars`，换成仅供本地使用的测试值。
3. 执行 `pnpm run db:migrate:local`。
4. 执行 `pnpm run dev`。

`DATA_KEY` 必须是 32 字节随机数据的 Base64 表示。`BOOTSTRAP_VAULT_PASSWORD` 必须是 4–32 位数字。首位管理者只在人员表为空时初始化，后续删除不会被自动恢复。

## 验证

```text
pnpm run typecheck
pnpm run test
pnpm run build
pnpm audit --prod --audit-level=high
```

`pnpm package:local -- <new-output-directory>` 会从已构建的 `dist/` 生成不含 `.dev.vars` 的 Worker 发布目录，并写入内容摘要、CycloneDX SBOM 和构建来源。

## 部署配置

运行时需要：

- D1 绑定 `DB`
- secret `DATA_KEY`
- secret `BOOTSTRAP_ADMIN_NAME`
- secret `BOOTSTRAP_ADMIN_STUDENT_ID`
- secret `BOOTSTRAP_VAULT_PASSWORD`

`wrangler.jsonc` 中的 D1 `database_id` 在仓库初始状态为占位符。首次发布时必须先创建远程 D1、写入真实 ID、应用迁移并通过 Wrangler secret 注入上述值。不要把姓名、学号、保险箱密码或 `DATA_KEY` 写入 Git。

## 安全边界

- D1 不明文保存学号或保险箱密码。
- 会话为 12 小时的 `HttpOnly` / `SameSite=Strict` Cookie，生产环境带 `Secure`。
- 不存储电话、原始导入文件、访问日志、操作日志或历史密码。
- 始终保留至少一名管理者。
