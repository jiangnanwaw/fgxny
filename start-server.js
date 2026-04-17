const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('========================================');
console.log('   启动SQL Server代理服务器');
console.log('========================================');
console.log('');

// 日志文件路径
const logFile = path.join(__dirname, 'server-output.log');
const errorFile = path.join(__dirname, 'server-error.log');

// 打开日志文件
const out = fs.openSync(logFile, 'a');
const err = fs.openSync(errorFile, 'a');

// 启动服务器进程
const serverPath = path.join(__dirname, 'proxy-server.js');
const child = spawn('node', [serverPath], {
    detached: true,
    stdio: ['ignore', out, err],
    cwd: __dirname
});

// 分离进程
child.unref();

console.log('服务器已在后台启动！');
console.log('进程ID: ' + child.pid);
console.log('');
console.log('========================================');
console.log('服务器信息');
console.log('========================================');
console.log('服务器地址: http://csfhcdz.f3322.net:3009');
console.log('健康检查: http://csfhcdz.f3322.net:3009/health');
console.log('查看日志: http://csfhcdz.f3322.net:3009/logs');
console.log('========================================');
console.log('');
console.log('日志文件: ' + logFile);
console.log('错误日志: ' + errorFile);
console.log('');
console.log('[提示] 服务器在后台运行,关闭此窗口不影响服务器');
console.log('[提示] 使用"查看服务状态.bat"查看运行状态');
console.log('[提示] 使用"停止服务.bat"停止服务器');
console.log('');
