# Uptime Kuma 2.3.2 部署到 Serv00 完整教程
# ⭐ **觉得有用？给个 Star 支持一下！**

## 目录
- [前期设置（端口与域名）](#前期设置端口与域名)
- [方式一：直接下载预构建压缩包（推荐）](#方式一直接下载预构建压缩包推荐)
- [方式二：通过 GitHub Actions 构建（自定义端口/版本）](#方式二通过-github-actions-构建自定义端口版本)
- [部署到 Serv00（通用步骤）](#部署到-serv00通用步骤)
- [设置后台保活（Cron Job）](#设置后台保活cron-job)
- [完成安装](#完成安装)
- [常见问题](#常见问题)

---

## 前期设置（端口与域名）

1. **创建端口**  
   Serv00 面板 → **附加功能 → Custom applications** → Add a new application  
   - Name：`uptime`  
   - Command：留空  
   - Working directory：`/home/你的用户名/domains/你的域名/uptime-kuma`  
   - Port：输入一个端口（如 `7070`），记下这个数字。

2. **配置域名反向代理**  
   Serv00 面板 → **WWW 站点**  
   - 删除旧的域名记录（可选）  
   - 点击 Add website：  
     - Domain：你的域名（如 `xxx.ct8.pl`）  
     - Website type：**Proxy**  
     - Proxy port：填入刚才的端口（如 `7070`）  
   - 保存。

---

## 方式一：直接下载预构建压缩包（推荐）

我们已为你准备好修复了 FreeBSD 兼容性的压缩包，只需修改端口即可。

### 下载与配置
```bash
# SSH 登录 Serv00，进入域名目录
cd /home/你的用户名/domains/你的域名

# 下载压缩包
wget https://github.com/oyz8/Uptime_Kuma/releases/download/serv00-v2/uptime-kuma.zip

# 解压
unzip uptime-kuma.zip -d uptime-kuma
cd uptime-kuma

# 修改端口（如果默认端口与你创建的不一致）
echo "UPTIME_KUMA_PORT=7070" > .env
echo "DATA_DIR=./data" >> .env
```

然后跳转到 **[部署到 Serv00](#部署到-serv00通用步骤)**。

---

## 方式二：通过 GitHub Actions 构建（自定义端口/版本）

如果你需要**构建时直接指定端口**，或者想使用特定版本，可使用仓库中已配置好的 Workflow。

### 步骤
1. 访问仓库 [oyz8/Uptime_Kuma](https://github.com/oyz8/Uptime_Kuma)（或你自己的 Fork）。
2. 点击 **Actions** 标签 → 选择 **“构建 Serv00 专用版 Uptime Kuma”** → **Run workflow**。
3. 输入你的 **端口号**（如 `7070`）和 **版本**（默认 `2.3.2`），点击 Run。
4. 等待构建完成，进入仓库 **Releases** 页面下载生成的 `uptime-kuma.zip`。
5. 将 zip 上传到 Serv00 域名目录，解压：
   ```bash
   cd /home/你的用户名/domains/你的域名
   unzip uptime-kuma.zip -d uptime-kuma
   ```
   （因为构建时已写入端口，无需再修改 `.env`）

---

## 部署到 Serv00（通用步骤）

```bash
cd ~/domains/你的域名/uptime-kuma

# 重建原生模块（适配 FreeBSD，必须执行！）
npm rebuild

# 前台测试（看到 Listening on 端口后 Ctrl+C 退出）
node server/server.js
```

---

## 设置后台保活（Cron Job）

1. Serv00 面板 → **Cron jobs** → Add cron job。
2. **Command**（替换域名和用户名）：
   ```bash
   pgrep -f "node server/server.js" >/dev/null || (cd /home/你的用户名/domains/你的域名/uptime-kuma && nohup node server/server.js >/dev/null 2>&1 &)
   ```
3. **Interval**：`*/5 * * * *`（每5分钟检查一次）。
4. 勾选 Enabled，保存。

---

## 完成安装

浏览器访问 `http://你的域名`，按引导创建管理员账户，即可开始添加监控。

---

## 常见问题

### 端口冲突
- 修改 Custom applications 中的端口，并同步更新反向代理端口。
- 在项目目录重新生成 `.env`：  
  `echo "UPTIME_KUMA_PORT=新端口" > .env && echo "DATA_DIR=./data" >> .env`

### `npm rebuild` 报错
- 若提示缺少 `python`/`make`/`gcc`，尝试：  
  ```bash
  pkg install python3 gmake gcc
  ```

### 网页空白/502
- 检查反向代理端口与 `.env` 中的一致。
- 直接访问 `http://服务器IP:端口` 判断服务是否正常。
- 确认 Cron 已启用，或手动运行一次 `node server/server.js`。

---

🎉 现在你已成功在 Serv00 上运行 Uptime Kuma 2.3.2，监控你的所有服务吧！
