# SQL Server 本地代理服务器部署说明

## 概述
本项目将腾讯云函数替换为本地Node.js代理服务器,实现在任何网络环境中通过前端连接SQL Server 2008 R2数据库。

## 文件说明
- `proxy-server.js` - Node.js代理服务器主文件
- `package.json` - Node.js项目依赖配置
- `index.html` - 前端页面(已修改API地址)

## 部署步骤

### 1. 安装Node.js
确保已安装Node.js (建议v14或更高版本)
- 下载地址: https://nodejs.org/
- 验证安装: 打开命令行输入 `node -v`

### 2. 安装依赖包
在项目目录下打开命令行,执行:
```bash
npm install
```

这将安装以下依赖:
- `express` - Web服务器框架
- `mssql` - SQL Server数据库驱动
- `cors` - 跨域资源共享支持

### 3. 启动代理服务器
```bash
npm start
```

或使用nodemon实现自动重启(开发模式):
```bash
npm run dev
```

### 4. 验证服务器运行
启动成功后会显示:
```
========================================
🚀 SQL Server 代理服务器已启动
📡 监听端口: 3009
🗄️  数据库: csfhcdz.f3322.net\SQLEXPRESS
📊 数据库名: chargingdata
🔗 API地址: http://localhost:3009
💚 健康检查: http://localhost:3009/health
========================================
```

访问 http://localhost:3009/health 检查服务状态

### 5. 配置防火墙(重要)
确保服务器防火墙允许3009端口的入站连接:
```bash
# Windows防火墙设置
netsh advfirewall firewall add rule name="SQL Proxy 3009" dir=in action=allow protocol=TCP localport=3009
```

### 6. 打开前端页面
在浏览器中打开 `index.html` 文件,页面将自动连接代理服务器。
- 本地访问: http://localhost:3009
- 外网访问: http://csfhcdz.f3322.net:3009

## 数据库配置
当前配置的数据库信息:
- 服务器: csfhcdz.f3322.net
- 实例: SQLEXPRESS
- 数据库: chargingdata
- 用户名: csfh
- 端口: 1433

如需修改,请编辑 `proxy-server.js` 中的 `dbConfig` 对象。

## API接口说明

### POST /
执行SQL查询

**请求体:**
```json
{
  "query": "SELECT * FROM table_name"
}
```

**成功响应:**
```json
{
  "success": true,
  "data": [...],
  "rowCount": 10,
  "duration": 123
}
```

**错误响应:**
```json
{
  "error": "错误信息",
  "code": "错误代码",
  "message": "详细描述"
}
```

### GET /health
健康检查接口

**响应:**
```json
{
  "status": "healthy",
  "message": "服务运行正常",
  "database": "connected"
}
```

## 故障排查

### 1. 端口被占用
如果3009端口已被占用,修改 `proxy-server.js` 中的 `PORT` 常量,并同步修改 `index.html` 中的API地址。

### 2. 数据库连接失败
- 检查数据库服务器地址是否可访问
- 确认防火墙允许1433端口
- 验证用户名和密码是否正确
- 检查SQL Server是否允许远程连接

### 3. CORS错误
代理服务器已启用CORS,如仍有问题,检查浏览器控制台错误信息。

## 生产环境部署建议

### 使用PM2管理进程(推荐)
PM2可以确保服务器崩溃后自动重启:
```bash
npm install -g pm2
pm2 start proxy-server.js --name sqlserver-proxy
pm2 save
pm2 startup
```

### 配置为Windows服务
使用 `node-windows` 包将服务注册为Windows服务,开机自动启动:
```bash
npm install -g node-windows
```

### 外网访问配置
1. 确保路由器端口转发已配置(3009端口)
2. 确保动态域名解析(DDNS)正常工作
3. 服务器已配置为监听 0.0.0.0,可接受所有网络接口的连接

### 内测版本说明
本版本为公司内测版本,已移除所有安全限制以便快速部署和测试。
**注意**: 生产环境部署时建议添加以下安全措施:
1. 使用环境变量存储数据库密码
2. 添加API请求频率限制
3. 启用HTTPS加密传输
4. 添加身份验证机制(JWT/API Key)
5. 限制允许的SQL操作类型
6. 添加IP白名单限制

## 技术支持
如遇问题,请检查:
1. Node.js版本是否兼容
2. 网络连接是否正常
3. 数据库服务器是否在线
4. 查看服务器控制台日志
