# 保险箱访问

轻量的静态保险箱密码查看网站。已配置人员使用姓名和学号解锁当前密码；管理者可在浏览器中编辑名单与密码、下载新版配置，再通过 GitHub Pages 发布。

## 技术栈

- React 19 + TypeScript + Vite
- Web Crypto API
- GitHub Pages + GitHub Actions
- Vitest + Playwright Core

## 本地开发

需要 Node.js 22+ 与 pnpm 9.15.4。

```text
pnpm install --frozen-lockfile
pnpm run dev
```

浏览器从 `public/site-config.json` 读取当前配置。站点没有服务端、数据库、运行时 secret 或后台进程。

## 验证与构建

```text
pnpm run typecheck
pnpm run test
pnpm audit --prod --audit-level=high
VITE_BASE_PATH=/safe-access-portal/ pnpm run build
```

Windows PowerShell 可用：

```powershell
$env:VITE_BASE_PATH='/safe-access-portal/'
pnpm run build
```

`pnpm package:local -- <new-output-directory>` 会从已验证的 `dist/` 生成静态发布包，并写入摘要、SBOM 与构建来源。

## 管理者发布配置

1. 登录管理中心，完成导入、角色调整、删除或密码修改。
2. 选择“下载站点配置”，得到固定文件名 `site-config.json`。
3. 在 GitHub 仓库的 `public/` 目录上传并覆盖同名文件，提交变更。
4. 等待 `Deploy GitHub Pages` 工作流成功。
5. 重新打开网站并登录，核对管理中心的配置版本。

网页中的编辑只存在于当前标签页；下载和上传前不会影响其他设备。刷新或退出会清除尚未下载的草稿。

## 初始配置生成

一次性初始生成器从仓库外的排班表与人员信息表提取每日首末班人员。敏感输入通过临时环境变量提供，脚本只写出加密/派生配置：

```text
SEED_ADMIN_NAME=<name>
SEED_ADMIN_STUDENT_ID=<student-id>
SEED_VAULT_PASSWORD=<vault-password>
pnpm config:generate -- <schedule.xlsx> <information.xlsx> public/site-config.json
```

原始工作簿、联系电话、姓名、学号和保险箱密码明文不得提交到本仓库。

## 安全边界

- 发布配置不直接包含明文姓名、学号、电话或保险箱密码。
- 志愿者只能解锁保险箱密码；管理者另可解锁完整名单。
- 每次导出都会轮换内容密钥，并为当前人员重新封装。
- 解锁内容只保存在页面内存；刷新、关闭标签页或退出后清除。
- 这是纯客户端方案，不具备服务端强制鉴权。公开文件可被离线分析，姓名和学号也可能被猜测；不得把界面角色限制描述为不可绕过的安全边界。
