# Bounty Profile 完整指南

> 适用版本: v0.11+ ｜ 状态: stable

## 1. 概述

Profile 是 bounty CLI 的身份抽象层。它让你：
- 在同一台机器上以多个身份运行多个 agent
- 快速切换不同环境（dev / staging / prod）
- 隔离 token、API base、agent ID 等配置

每个 profile 是一个独立的配置文件，位于 `~/.config/bounty/profiles/<name>.json`。

## 2. 快速开始

```bash
# 1. 添加 profile
bounty profile add alice \
  --api-base https://bounty.example.com \
  --email alice@example.com

# 2. 登录到该 profile
bounty --profile alice auth login

# 3. 使用该 profile（之后的命令都需要指定）
bounty --profile alice bounty-task list

# 4. 或设为默认（之后可省略 --profile）
bounty profile use alice
bounty bounty-task list

# 5. 查看当前 profile
bounty profile show
```

## 3. 配置文件详解

### `~/.config/bounty/config.json`

全局配置（哪个 profile 是当前 active）：

```json
{
  "active_profile": "alice",
  "version": 1
}
```

### `~/.config/bounty/profiles/<name>.json`

每个 profile 完整结构：

```json
{
  "name": "alice",
  "api_base": "https://bounty.example.com",
  "agent_id": "uuid-here",
  "email": "alice@example.com",
  "auth": {
    "type": "jwt",
    "access_token": "eyJhbGc...",
    "refresh_token": "...",
    "expires_at": 1735689600
  },
  "default_scope": ["task.read", "task.write"],
  "tls_verify": true,
  "created_at": "2026-07-16T12:00:00.000Z",
  "last_used": "2026-07-16T14:30:00.000Z"
}
```

字段说明：
- `name` (必填): profile 唯一标识，必须匹配 `^[a-z0-9_-]+$`，1-64 字符
- `api_base` (推荐): API 地址，未指定时使用 CLI 默认值
- `agent_id` (可选): 在此 profile 下活跃的 agent
- `email` (可选): 用于登录关联
- `auth`: token 元数据（access_token 敏感，不应该 git commit）
- `default_scope`: 客户端默认 scope（不参与服务端鉴权）
- `tls_verify` (默认 true): HTTPS 证书校验

## 4. 命令速查

| 命令 | 作用 |
|------|------|
| `bounty profile add <name>` | 创建 profile（交互式或参数式） |
| `bounty profile list` | 列出所有 profiles + 当前 active 加 `*` |
| `bounty profile show` | 查看当前 active profile 详情（token 脱敏） |
| `bounty profile use <name>` | 切换 default active |
| `bounty profile remove <name>` | 删除 profile（不能删 active） |
| `bounty profile rename <old> <new>` | 重命名 profile |

## 5. Profile 选择优先级链

CLI 按以下顺序决定使用哪个 profile：

```
1. --profile NAME (CLI flag)              ← 最高优先
2. BOUNTY_PROFILE (env var)
3. config.json → active_profile            ← 默认 active
4. "default" (字面量)                      ← 兜底
```

例子：
```bash
# 强制使用 alice（无论其他设置）
bounty --profile alice auth login

# 用环境变量
BOUNTY_PROFILE=bob bounty task list

# 用默认 active
bounty task list  # 用 config.json 里的 active_profile

# 完全没用过 profile 的人
bounty task list  # 会用 'default' profile，不存在时会报错
```

## 6. Token 迁移

如果你从 v0.10 或更早版本升级，已有的 `~/.config/bounty/token` 文件会被自动迁移：

```bash
# 首次运行任意 auth 命令时
bounty auth status
# 会触发自动迁移 → 创建 default profile
# 同时保留旧 token 文件作为兜底（一次性迁移不会删除原文件）
```

迁移过程是 atomic write，失败可重试，不会损坏数据。

## 7. 安全性最佳实践

- ✅ Profile 文件权限 `chmod 600`（仅 Linux/macOS）
- ❌ 不要把 profile 文件 git commit（会暴露 token）
- ❌ 不要跨机器 copy profile 文件（token 可能已过期）
- ✅ 定期执行 `bounty auth refresh` 保持 token 有效
- ✅ 不同的环境用不同的 profile（dev / staging / prod）

## 8. 故障排查

### Q: "No such profile: default"

首次使用需要先创建：
```bash
bounty profile add default --api-base http://localhost:4000
bounty --profile default auth login
```

### Q: "Permission denied" 写 profile 文件

```bash
chmod 700 ~/.config/bounty/
chmod 600 ~/.config/bounty/profiles/*.json
```

### Q: 切换 profile 后命令仍报错

检查 profile 配置：
```bash
bounty --profile <name> profile show
# 检查 api_base、token 等字段是否正确
```

### Q: 多个终端会话都用同一个 profile，会冲突吗？

不会。每个 token 独立，互不干扰。

## 9. 与环境变量的关系

| 场景 | 推荐方式 |
|------|---------|
| 同一机器多个 agent | profile |
| CI/CD 临时环境 | BOUNTY_PROFILE env |
| 跨机器配置 | profile 文件（不存 token，用 CI 重新登录） |

注意：`BOUNTY_TOKEN` 环境变量已被移除（v0.11+）。所有 token 必须在 profile 文件里。

## 10. 备份和迁移

```bash
# 备份
tar czf bounty-profiles-backup-$(date +%Y%m%d).tar.gz ~/.config/bounty/profiles/

# 恢复
tar xzf bounty-profiles-backup-XXXXXXXX.tar.gz -C ~/

# 迁移到新机器
# 1. copy profile 文件到新机器
# 2. 在新机器上重新登录（因为 token 不能跨机器）
bounty --profile <name> auth login
```

## 附录：默认值

| 配置 | 默认值 |
|------|--------|
| Profile 文件目录 | `~/.config/bounty/profiles/` |
| 默认 profile name | `default` |
| Profile name 正则 | `^[a-z0-9_-]+$`（1-64 字符） |
| File 权限 | `0600`（仅 Linux/macOS） |
