// 微信小程序扫码登录模块

const https = require('https');

// 微信小程序配置
const WECHAT_APPID = 'wx965ec95dfe82aaac';
const WECHAT_APPSECRET = 'dc5f042a030c04702d9764929ee7a002';

// 存储登录会话（生产环境建议使用 Redis）
const loginSessions = new Map();

// 日志函数（从主文件传入）
let logToFile = console.log;

// 设置日志函数
function setLogger(logger) {
    logToFile = logger;
}

// 生成扫码登录二维码
function generateQRCode(req, res) {
    try {
        // 生成唯一的登录码
        const loginCode = 'login_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);

        // 创建登录会话
        loginSessions.set(loginCode, {
            status: 'pending', // pending, success, expired
            createdAt: Date.now(),
            openid: null,
            userInfo: null
        });

        // 设置会话过期时间（5分钟）
        setTimeout(() => {
            if (loginSessions.has(loginCode)) {
                const session = loginSessions.get(loginCode);
                if (session.status === 'pending') {
                    session.status = 'expired';
                    loginSessions.delete(loginCode);
                }
            }
        }, 5 * 60 * 1000);

        // 生成扫码页面URL，跟随当前访问入口（直连或反向代理）
        const host = req.get('host');
        const protocol = req.get('x-forwarded-proto') || req.protocol;
        const miniProgramUrl = `${protocol}://${host}/wechat-scan?code=${loginCode}`;

        logToFile(`[微信扫码登录] 生成登录码: ${loginCode}`);

        res.json({
            success: true,
            loginCode: loginCode,
            qrcodeUrl: miniProgramUrl,
            expiresIn: 300 // 5分钟
        });

    } catch (err) {
        logToFile(`[微信扫码登录] 生成二维码失败: ${err.message}`);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
}

// 小程序扫码后调用此接口完成登录
function scanLogin(req, res) {
    try {
        const { loginCode, code } = req.body;

        if (!loginCode || !loginSessions.has(loginCode)) {
            return res.json({
                success: false,
                message: '登录码无效或已过期'
            });
        }

        const session = loginSessions.get(loginCode);

        if (session.status !== 'pending') {
            return res.json({
                success: false,
                message: '登录码已使用或已过期'
            });
        }

        // 使用微信code换取openid
        const wechatApiUrl = `https://api.weixin.qq.com/sns/jscode2session?appid=${WECHAT_APPID}&secret=${WECHAT_APPSECRET}&js_code=${code}&grant_type=authorization_code`;

        https.get(wechatApiUrl, (apiRes) => {
            let data = '';

            apiRes.on('data', (chunk) => {
                data += chunk;
            });

            apiRes.on('end', () => {
                try {
                    const result = JSON.parse(data);

                    if (result.openid) {
                        // 登录成功
                        session.status = 'success';
                        session.openid = result.openid;
                        session.unionid = result.unionid;
                        session.userInfo = {
                            openid: result.openid,
                            loginTime: new Date().toISOString()
                        };

                        logToFile(`[微信扫码登录] 登录成功: loginCode=${loginCode}, openid=${result.openid}`);

                        res.json({
                            success: true,
                            message: '登录成功'
                        });
                    } else {
                        logToFile(`[微信扫码登录] 获取openid失败: ${JSON.stringify(result)}`);
                        res.json({
                            success: false,
                            message: result.errmsg || '获取用户信息失败'
                        });
                    }
                } catch (parseError) {
                    logToFile(`[微信扫码登录] 解析微信API响应失败: ${parseError.message}`);
                    res.json({
                        success: false,
                        message: '系统错误'
                    });
                }
            });
        }).on('error', (apiError) => {
            logToFile(`[微信扫码登录] 调用微信API失败: ${apiError.message}`);
            res.json({
                success: false,
                message: '网络错误'
            });
        });

    } catch (err) {
        logToFile(`[微信扫码登录] 扫码登录失败: ${err.message}`);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
}

// 查询登录状态
function checkLoginStatus(req, res) {
    try {
        const { loginCode } = req.query;

        if (!loginCode || !loginSessions.has(loginCode)) {
            return res.json({
                success: false,
                status: 'invalid',
                message: '登录码无效'
            });
        }

        const session = loginSessions.get(loginCode);

        res.json({
            success: true,
            status: session.status,
            openid: session.openid,
            userInfo: session.userInfo
        });

        // 如果登录成功，清理会话
        if (session.status === 'success') {
            setTimeout(() => {
                loginSessions.delete(loginCode);
            }, 60000);
        }

    } catch (err) {
        logToFile(`[微信扫码登录] 查询状态失败: ${err.message}`);
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
}

// 扫码跳转页面（H5页面，用于跳转到小程序）
function scanPage(req, res) {
    const { code } = req.query;

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>微信登录</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    text-align: center;
                    padding: 50px 20px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    margin: 0;
                }
                .container {
                    max-width: 400px;
                    margin: 0 auto;
                    background: white;
                    padding: 40px;
                    border-radius: 20px;
                    box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                    color: #333;
                }
                h2 {
                    color: #667eea;
                    margin-bottom: 20px;
                }
                .icon {
                    font-size: 60px;
                    margin-bottom: 20px;
                }
                .btn {
                    display: inline-block;
                    padding: 15px 40px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    text-decoration: none;
                    border-radius: 30px;
                    margin-top: 20px;
                    font-size: 16px;
                    font-weight: bold;
                    border: none;
                    cursor: pointer;
                }
                .tip {
                    margin-top: 20px;
                    font-size: 14px;
                    color: #999;
                }
                .code {
                    font-size: 12px;
                    color: #999;
                    margin: 10px 0;
                    word-break: break-all;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="icon">📱</div>
                <h2>微信扫码登录</h2>
                <p>请在微信中打开此页面</p>
                <div class="code">登录码：${code}</div>
                <button class="btn" onclick="openMiniProgram()">
                    打开小程序登录
                </button>
                <div class="tip">
                    如果无法自动跳转，请手动打开"模块售后管理"小程序
                </div>
            </div>
            <script>
                function openMiniProgram() {
                    // 跳转到小程序
                    window.location.href = 'weixin://dl/business/?appid=${WECHAT_APPID}&path=pages/login/login&query=loginCode=${encodeURIComponent(code)}';
                }

                // 自动跳转到小程序（延迟1秒）
                setTimeout(openMiniProgram, 1000);
            </script>
        </body>
        </html>
    `);
}

module.exports = {
    setLogger,
    generateQRCode,
    scanLogin,
    checkLoginStatus,
    scanPage
};
