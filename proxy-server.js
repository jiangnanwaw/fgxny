const express = require('express');
const sql = require('mssql');
const mysql = require('mysql2/promise');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const wechatLogin = require('./wechat-login');

const app = express();
const PORT = 3020;

// 启用CORS以允许前端访问
app.use(cors());
app.use(express.json());

// 托管静态文件（前端页面）
app.use(express.static(__dirname));

// 日志文件路径
const LOG_FILE = path.join(__dirname, 'query-logs.txt');

// 日志函数
function logToFile(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;

    // 同时输出到控制台和文件
    console.log(message);

    // 追加到日志文件
    fs.appendFile(LOG_FILE, logMessage, (err) => {
        if (err) console.error('写入日志文件失败:', err);
    });
}

// SQL Server 数据库配置 (使用端口方式连接)
const dbConfig = {
    server: 'csfhcdz.f3322.net',
    port: 1433,
    database: 'chargingdata',
    user: 'csfh',
    password: 'fh123456',
    options: {
        encrypt: false, // SQL Server 2008 R2 不需要加密
        trustServerCertificate: true,
        enableArithAbort: true,
        connectTimeout: 30000
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    },
    requestTimeout: 60000
};

// MySQL 数据库配置 (用于未充电时长统计)
const mysqlConfig = {
    host: 'localhost',
    port: 3306,
    user: 'repair_admin',
    password: 'password123',
    database: 'miniprogram_system',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 30000
};

const moduleRepairConfig = {
    baseUrl: 'https://api.csfh.asia/api',
    adminPhone: '15616000858',
    adminPassword: 'fh123456'
};

let reportAuthToken = null;
let reportAuthTokenExpiresAt = 0;

function padNumber(value) {
    return String(value).padStart(2, '0');
}

function formatDateForApi(date) {
    return `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
}

function formatDateForDisplay(dateStr) {
    const datePart = String(dateStr || '').split(' ')[0];
    const parts = datePart.split('-');
    if (parts.length >= 3) {
        return `${padNumber(parts[1])}-${padNumber(parts[2])}`;
    }
    return datePart;
}

function parseNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

// 解析 xfl 的时长文本 "92小时6分15秒" -> 分钟
function parseDurationText(text) {
    if (!text) return 0;
    const hourMatch = text.match(/(\d+)小时/);
    const minMatch = text.match(/(\d+)分/);
    const hours = hourMatch ? parseInt(hourMatch[1]) : 0;
    const mins = minMatch ? parseInt(minMatch[1]) : 0;
    return hours * 60 + mins;
}

function getCurrentMonthRange() {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
        month: `${now.getFullYear()}-${padNumber(now.getMonth() + 1)}`,
        startDate: formatDateForApi(startDate),
        endDate: formatDateForApi(now)
    };
}

function createApiUrl(pathname, params = {}) {
    const url = new URL(pathname, moduleRepairConfig.baseUrl + '/');
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
        }
    });
    return url;
}

function apiRequest(method, pathname, { headers = {}, body = null, params = {} } = {}) {
    const url = createApiUrl(pathname, params);
    return new Promise((resolve, reject) => {
        const request = https.request(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...headers
            }
        }, (response) => {
            let rawData = '';
            response.on('data', chunk => {
                rawData += chunk;
            });
            response.on('end', () => {
                let parsedData = null;
                try {
                    parsedData = rawData ? JSON.parse(rawData) : null;
                } catch (parseError) {
                    return reject(new Error(`解析接口响应失败: ${parseError.message}`));
                }

                if (response.statusCode >= 200 && response.statusCode < 300) {
                    resolve(parsedData);
                } else {
                    const message = parsedData?.message || parsedData?.error || `HTTP ${response.statusCode}`;
                    const error = new Error(message);
                    error.statusCode = response.statusCode;
                    error.response = parsedData;
                    reject(error);
                }
            });
        });

        request.on('error', reject);
        request.setTimeout(30000, () => {
            request.destroy(new Error('请求超时'));
        });

        if (body) {
            request.write(JSON.stringify(body));
        }
        request.end();
    });
}

async function getReportAuthToken(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && reportAuthToken && now < reportAuthTokenExpiresAt) {
        return reportAuthToken;
    }

    logToFile('[历史数据] 正在获取报表接口认证令牌');
    const loginResult = await apiRequest('POST', 'auth/admin-login', {
        body: {
            phone: moduleRepairConfig.adminPhone,
            password: moduleRepairConfig.adminPassword
        }
    });

    const token = loginResult?.data?.token;
    if (!token) {
        throw new Error('报表接口登录成功但未返回token');
    }

    reportAuthToken = token;
    reportAuthTokenExpiresAt = now + 50 * 60 * 1000;
    return reportAuthToken;
}

async function fetchStationHistory(station, token, range) {
    return apiRequest('GET', 'reports/history-detail', {
        headers: {
            Authorization: `Bearer ${token}`
        },
        params: {
            station,
            startDate: range.startDate,
            endDate: range.endDate,
            limit: 100,
            offset: 0,
            sortBy: 'date',
            sortOrder: 'desc'
        }
    });
}

function mapStationName(source) {
    const lowerSource = String(source || '').toLowerCase();
    if (lowerSource === 'didi') return '长沙飞狐兴发路站';
    if (lowerSource === 'teld') return '长沙飞狐锦泰广场站';
    return source || '';
}

function normalizeHistoryRows(rows) {
    return rows.map(item => ({
        rawDate: String(item.date || '').split(' ')[0],
        date: formatDateForDisplay(item.date),
        stationKey: item.source || '',
        station: mapStationName(item.source),
        charge: parseNumber(item.electricity),
        totalIncome: parseNumber(item.totalAmount),
        income: parseNumber(item.serviceFee),
        orders: parseNumber(item.count)
    })).filter(item => item.rawDate);
}

function sortHistoryRows(rows) {
    return rows.sort((a, b) => {
        if (a.rawDate === b.rawDate) {
            if (a.stationKey === b.stationKey) return 0;
            if (a.stationKey === 'didi') return -1;
            if (b.stationKey === 'didi') return 1;
            return a.station.localeCompare(b.station, 'zh-CN');
        }
        return b.rawDate.localeCompare(a.rawDate);
    });
}

// 创建连接池
let pool = null;
let mysqlPool = null;

// 初始化SQL Server数据库连接池
async function initializePool() {
    try {
        if (pool) {
            await pool.close();
        }
        pool = await sql.connect(dbConfig);
        logToFile('✓ SQL Server数据库连接池已建立');
        return pool;
    } catch (err) {
        logToFile('✗ SQL Server数据库连接失败: ' + err.message);
        throw err;
    }
}

// 初始化MySQL数据库连接池
async function initializeMySQLPool() {
    try {
        if (mysqlPool) {
            await mysqlPool.end();
        }
        mysqlPool = mysql.createPool(mysqlConfig);
        logToFile('✓ MySQL数据库连接池已建立');
        return mysqlPool;
    } catch (err) {
        logToFile('✗ MySQL数据库连接失败: ' + err.message);
        throw err;
    }
}

// 处理SQL查询请求
app.post('/', async (req, res) => {
    const startTime = Date.now();

    try {
        const { query } = req.body;

        if (!query) {
            return res.status(400).json({
                error: 'Missing query parameter',
                message: '请求体中缺少query参数'
            });
        }

        logToFile(`\n收到查询请求`);
        logToFile('SQL: ' + query.substring(0, 200) + (query.length > 200 ? '...' : ''));

        // 确保连接池存在
        if (!pool || !pool.connected) {
            logToFile('重新建立数据库连接...');
            await initializePool();
        }

        // 执行查询
        const result = await pool.request().query(query);

        const duration = Date.now() - startTime;
        logToFile(`✓ 查询成功 (${duration}ms), 返回 ${result.recordset.length} 条记录`);

        // 返回结果 (使用与腾讯云函数相同的格式)
        res.json({
            success: true,
            results: result.recordset,  // 前端期望的字段名是 results，不是 data
            rowCount: result.recordset.length,
            duration: duration
        });

    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`✗ 查询失败 (${duration}ms): ${err.message}`);

        // 如果是连接错误，尝试重新连接
        if (err.message.includes('Connection') || err.message.includes('ECONNRESET')) {
            logToFile('检测到连接错误，尝试重新建立连接...');
            try {
                await initializePool();
            } catch (reconnectErr) {
                logToFile('重新连接失败: ' + reconnectErr.message);
            }
        }

        res.status(500).json({
            error: err.message,
            code: err.code,
            state: err.state,
            message: '数据库查询失败: ' + err.message
        });
    }
});

// 健康检查端点
app.get('/health', async (req, res) => {
    try {
        if (!pool || !pool.connected) {
            return res.status(503).json({
                status: 'unhealthy',
                message: '数据库连接未建立'
            });
        }

        // 测试查询
        await pool.request().query('SELECT 1 as test');

        res.json({
            status: 'healthy',
            message: '服务运行正常',
            database: 'connected'
        });
    } catch (err) {
        res.status(503).json({
            status: 'unhealthy',
            message: err.message
        });
    }
});

// 查看日志端点
app.get('/logs', (req, res) => {
    const lines = parseInt(req.query.lines) || 100;

    fs.readFile(LOG_FILE, 'utf8', (err, data) => {
        if (err) {
            return res.status(404).json({
                error: '日志文件不存在',
                message: '请先执行一些查询以生成日志'
            });
        }

        const logLines = data.split('\n').filter(line => line.trim());
        const recentLogs = logLines.slice(-lines);

        res.json({
            total: logLines.length,
            showing: recentLogs.length,
            logs: recentLogs
        });
    });
});

// 本月历史充电数据接口
app.get('/api/local/monthly-charge-history', async (req, res) => {
    const startTime = Date.now();
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const yearMonth = `${year}-${month}`;

    // 计算本月第一天和最后一天
    const startDate = `${yearMonth}-01`;
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    const endDate = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

    try {
        logToFile(`[历史数据] 开始查询本月数据 ${startDate} ~ ${endDate}`);

        // 查询锦泰广场站数据
        const jintaiQuery = `
            SELECT
                date,
                station_id,
                total_count as orders,
                total_electricity as charge,
                total_service_fee as income,
                total_electricity_fee + total_service_fee as totalIncome
            FROM jintai_history_summary
            WHERE DATE_FORMAT(date, '%Y-%m') = ?
              AND station_id = 'jintai_station_001'
            ORDER BY date DESC
        `;

        // 查询兴发路站数据
        const xflQuery = `
            SELECT
                date,
                scope,
                order_count as orders,
                electricity as charge,
                service_fee as income,
                electricity_fee + service_fee as totalIncome
            FROM xfl_history_summary
            WHERE DATE_FORMAT(date, '%Y-%m') = ?
              AND scope = 'all'
            ORDER BY date DESC
        `;

        const [jintaiRows] = await mysqlPool.query(jintaiQuery, [yearMonth]);
        const [xflRows] = await mysqlPool.query(xflQuery, [yearMonth]);

        // 格式化数据
        const data = [];

        // 处理锦泰广场站数据
        jintaiRows.forEach(row => {
            // 修复时区问题：使用本地日期而不是UTC日期
            const date = new Date(row.date);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;

            data.push({
                rawDate: dateStr,
                date: dateStr.substring(5), // "04-20"
                stationKey: 'TELD',
                station: '锦泰广场站',
                charge: parseFloat(row.charge) || 0,
                totalIncome: parseFloat(row.totalIncome) || 0,
                income: parseFloat(row.income) || 0,
                orders: parseInt(row.orders) || 0
            });
        });

        // 处理兴发路站数据
        xflRows.forEach(row => {
            // 修复时区问题：使用本地日期而不是UTC日期
            const date = new Date(row.date);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;

            data.push({
                rawDate: dateStr,
                date: dateStr.substring(5), // "04-20"
                stationKey: 'DIDI',
                station: '兴发路站',
                charge: parseFloat(row.charge) || 0,
                totalIncome: parseFloat(row.totalIncome) || 0,
                income: parseFloat(row.income) || 0,
                orders: parseInt(row.orders) || 0
            });
        });

        // 按日期降序排序
        data.sort((a, b) => b.rawDate.localeCompare(a.rawDate));

        const duration = Date.now() - startTime;
        logToFile(`[历史数据] 本月数据查询成功 (${duration}ms), 共 ${data.length} 条`);

        res.json({
            success: true,
            month: yearMonth,
            startDate: startDate,
            endDate: endDate,
            data
        });
    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[历史数据] 本月数据查询失败 (${duration}ms): ${err.message}`);
        res.status(500).json({
            success: false,
            message: err.message || '加载本月历史数据失败'
        });
    }
});

// 实时汇总数据接口（本月、本年度充电数据）
app.get('/api/local/realtime-summary', async (req, res) => {
    const startTime = Date.now();
    const scope = req.query.scope || 'all'; // 从查询参数获取站点，默认为 'all'

    try {
        logToFile(`[实时汇总] 开始查询实时汇总数据 (站点: ${scope})`);

        if (!mysqlPool) {
            throw new Error('MySQL连接池未初始化');
        }

        // 查询锦泰广场站数据
        const [jintaiRows] = await mysqlPool.query(
            `SELECT granularity, total_count, total_electricity, total_electricity_fee,
                    total_service_fee, total_income, total_duration
             FROM jintai_realtime_summary
             WHERE station_id = 'jintai_station_001'
             ORDER BY granularity`
        );

        // 查询兴发路站数据
        const [xflRows] = await mysqlPool.query(
            `SELECT granularity, order_count, electricity, electricity_fee,
                    service_fee, order_amount, duration_text
             FROM xfl_realtime_summary
             WHERE scope = 'all'
             ORDER BY granularity`
        );

        // 构建数据结构
        const jintaiData = {};
        jintaiRows.forEach(row => {
            jintaiData[row.granularity] = {
                totalCount: row.total_count || 0,
                totalElectricity: parseFloat(row.total_electricity) || 0,
                totalElectricityFee: parseFloat(row.total_electricity_fee) || 0,
                totalServiceFee: parseFloat(row.total_service_fee) || 0,
                totalIncome: parseFloat(row.total_income) || 0,
                totalDuration: row.total_duration || 0
            };
        });

        const xflData = {};
        xflRows.forEach(row => {
            // 解析时长文本为分钟数
            const durationMinutes = parseDurationText(row.duration_text);
            xflData[row.granularity] = {
                totalCount: row.order_count || 0,
                totalElectricity: parseFloat(row.electricity) || 0,
                totalElectricityFee: parseFloat(row.electricity_fee) || 0,
                totalServiceFee: parseFloat(row.service_fee) || 0,
                totalIncome: parseFloat(row.order_amount) || 0,
                totalDuration: durationMinutes
            };
        });

        // 根据scope参数决定返回哪个站点的数据
        let result;
        if (scope === 'jintai') {
            // 只返回锦泰广场站数据
            result = {
                day: jintaiData.day || { totalCount: 0, totalElectricity: 0, totalElectricityFee: 0, totalServiceFee: 0, totalIncome: 0, totalDuration: 0 },
                month: jintaiData.month || { totalCount: 0, totalElectricity: 0, totalElectricityFee: 0, totalServiceFee: 0, totalIncome: 0, totalDuration: 0 },
                year: jintaiData.year || { totalCount: 0, totalElectricity: 0, totalElectricityFee: 0, totalServiceFee: 0, totalIncome: 0, totalDuration: 0 }
            };
        } else if (scope === 'xfl') {
            // 只返回兴发路站数据
            result = {
                day: xflData.day || { totalCount: 0, totalElectricity: 0, totalElectricityFee: 0, totalServiceFee: 0, totalIncome: 0, totalDuration: 0 },
                month: xflData.month || { totalCount: 0, totalElectricity: 0, totalElectricityFee: 0, totalServiceFee: 0, totalIncome: 0, totalDuration: 0 },
                year: xflData.year || { totalCount: 0, totalElectricity: 0, totalElectricityFee: 0, totalServiceFee: 0, totalIncome: 0, totalDuration: 0 }
            };
        } else {
            // scope === 'all'，合并两个站点的数据
            result = {
                day: {
                    totalCount: (jintaiData.day?.totalCount || 0) + (xflData.day?.totalCount || 0),
                    totalElectricity: (jintaiData.day?.totalElectricity || 0) + (xflData.day?.totalElectricity || 0),
                    totalElectricityFee: (jintaiData.day?.totalElectricityFee || 0) + (xflData.day?.totalElectricityFee || 0),
                    totalServiceFee: (jintaiData.day?.totalServiceFee || 0) + (xflData.day?.totalServiceFee || 0),
                    totalIncome: (jintaiData.day?.totalIncome || 0) + (xflData.day?.totalIncome || 0),
                    totalDuration: (jintaiData.day?.totalDuration || 0) + (xflData.day?.totalDuration || 0)
                },
                month: {
                    totalCount: (jintaiData.month?.totalCount || 0) + (xflData.month?.totalCount || 0),
                    totalElectricity: (jintaiData.month?.totalElectricity || 0) + (xflData.month?.totalElectricity || 0),
                    totalElectricityFee: (jintaiData.month?.totalElectricityFee || 0) + (xflData.month?.totalElectricityFee || 0),
                    totalServiceFee: (jintaiData.month?.totalServiceFee || 0) + (xflData.month?.totalServiceFee || 0),
                    totalIncome: (jintaiData.month?.totalIncome || 0) + (xflData.month?.totalIncome || 0),
                    totalDuration: (jintaiData.month?.totalDuration || 0) + (xflData.month?.totalDuration || 0)
                },
                year: {
                    totalCount: (jintaiData.year?.totalCount || 0) + (xflData.year?.totalCount || 0),
                    totalElectricity: (jintaiData.year?.totalElectricity || 0) + (xflData.year?.totalElectricity || 0),
                    totalElectricityFee: (jintaiData.year?.totalElectricityFee || 0) + (xflData.year?.totalElectricityFee || 0),
                    totalServiceFee: (jintaiData.year?.totalServiceFee || 0) + (xflData.year?.totalServiceFee || 0),
                    totalIncome: (jintaiData.year?.totalIncome || 0) + (xflData.year?.totalIncome || 0),
                    totalDuration: (jintaiData.year?.totalDuration || 0) + (xflData.year?.totalDuration || 0)
                }
            };
        }

        const duration = Date.now() - startTime;
        logToFile(`[实时汇总] 数据查询成功 (${duration}ms, 站点: ${scope})`);

        res.json({
            success: true,
            data: result
        });
    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[实时汇总] 数据查询失败 (${duration}ms, 站点: ${scope}): ${err.message}`);
        res.status(500).json({
            success: false,
            message: err.message || '加载实时汇总数据失败'
        });
    }
});

// 获取指定日期的小时明细数据（用于用户充电行为分析）
app.get('/api/local/hourly-details', async (req, res) => {
    const startTime = Date.now();
    const scope = req.query.scope || 'all';
    const date = req.query.date; // yyyy-mm-dd 格式

    try {
        if (!date) {
            return res.status(400).json({
                success: false,
                message: '缺少日期参数'
            });
        }

        logToFile(`[小时明细] 开始拉取小时明细数据 (站点: ${scope}, 日期: ${date})`);

        let token = await getReportAuthToken();

        // 使用 history-detail API 获取指定日期的数据
        const startDate = date;
        const endDate = date;

        let result;
        try {
            result = await apiRequest('GET', 'reports/history-detail', {
                headers: {
                    Authorization: `Bearer ${token}`
                },
                params: {
                    station: scope === 'all' ? undefined : scope,
                    startDate: startDate,
                    endDate: endDate,
                    limit: 100,
                    offset: 0,
                    sortBy: 'date',
                    sortOrder: 'desc'
                }
            });
        } catch (error) {
            if (error.statusCode === 401) {
                logToFile('[小时明细] 认证令牌失效，正在刷新后重试');
                token = await getReportAuthToken(true);
                result = await apiRequest('GET', 'reports/history-detail', {
                    headers: {
                        Authorization: `Bearer ${token}`
                    },
                    params: {
                        station: scope === 'all' ? undefined : scope,
                        startDate: startDate,
                        endDate: endDate,
                        limit: 100,
                        offset: 0,
                        sortBy: 'date',
                        sortOrder: 'desc'
                    }
                });
            } else {
                throw error;
            }
        }

        const duration = Date.now() - startTime;
        logToFile(`[小时明细] 数据拉取成功 (${duration}ms, 站点: ${scope}, 日期: ${date})`);

        // 返回数据
        res.json({
            success: true,
            date: date,
            scope: scope,
            data: result.data || []
        });
    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[小时明细] 数据拉取失败 (${duration}ms, 站点: ${scope}, 日期: ${date}): ${err.message}`);
        res.status(500).json({
            success: false,
            message: err.message || '加载小时明细数据失败'
        });
    }
});

// ==================== 微信小程序扫码登录接口 ====================
// 设置日志函数
wechatLogin.setLogger(logToFile);

// 生成登录二维码
app.get('/api/wechat/qrcode', wechatLogin.generateQRCode);

// 小程序扫码登录
app.post('/api/wechat/scan-login', wechatLogin.scanLogin);

// 查询登录状态
app.get('/api/wechat/login-status', wechatLogin.checkLoginStatus);

// 扫码跳转页面
app.get('/wechat-scan', wechatLogin.scanPage);

// ==================== 未充电时长统计接口 ====================
// 获取未充电终端列表
app.get('/api/local/uncharged-terminals', async (req, res) => {
    const startTime = Date.now();

    try {
        logToFile('[未充电时长统计] 开始查询未充电终端数据');

        // 确保MySQL连接池存在
        if (!mysqlPool) {
            logToFile('初始化MySQL数据库连接...');
            await initializeMySQLPool();
        }

        // SQL查询：合并 didi 和 teld 两个表的数据
        const query = `
            SELECT
                station_name AS stationName,
                gun_id AS terminalName,
                MAX(charge_end_time) AS lastEndTime,
                NOW() AS currentTime
            FROM didi_order_detail_3days
            WHERE charge_end_time IS NOT NULL
            GROUP BY station_name, gun_id

            UNION ALL

            SELECT
                '长沙飞狐锦泰广场站' AS stationName,
                terminal_name AS terminalName,
                last_charge_end_time AS lastEndTime,
                NOW() AS currentTime
            FROM teld_terminal_last_charge
            WHERE last_charge_end_time IS NOT NULL

            ORDER BY stationName, terminalName
        `;

        const [rows] = await mysqlPool.query(query);

        // 处理数据：计算未充电时长
        const data = rows.map(row => {
            const lastEndTime = row.lastEndTime ? new Date(row.lastEndTime) : null;
            const currentTime = new Date(row.currentTime);

            // 计算时长（小时）
            let duration = 0;
            if (lastEndTime) {
                duration = (currentTime - lastEndTime) / (1000 * 60 * 60);
            }

            // 格式化日期时间为 yyyy-mm-dd hh:mm:ss
            const formatDateTime = (date) => {
                if (!date) return '';
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                const seconds = String(date.getSeconds()).padStart(2, '0');
                return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
            };

            return {
                stationName: row.stationName || '',
                terminalName: row.terminalName || '',
                lastEndTime: formatDateTime(lastEndTime),
                stillUnchargedTime: formatDateTime(currentTime),
                duration: Math.max(0, duration)
            };
        });

        const duration = Date.now() - startTime;
        logToFile(`[未充电时长统计] 查询成功 (${duration}ms), 返回 ${data.length} 条记录`);

        res.json({
            success: true,
            data: data,
            count: data.length,
            duration: duration
        });

    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[未充电时长统计] 查询失败 (${duration}ms): ${err.message}`);

        // 如果是连接错误，尝试重新连接
        if (err.message.includes('Connection') || err.code === 'PROTOCOL_CONNECTION_LOST') {
            logToFile('检测到MySQL连接错误，尝试重新建立连接...');
            try {
                await initializeMySQLPool();
            } catch (reconnectErr) {
                logToFile('MySQL重新连接失败: ' + reconnectErr.message);
            }
        }

        res.status(500).json({
            success: false,
            message: err.message || '查询未充电终端数据失败',
            error: err.message
        });
    }
});

// 获取经营效率分析可用日期列表
app.get('/api/local/efficiency-available-dates', async (req, res) => {
    const startTime = Date.now();

    try {
        logToFile(`[经营效率分析] 开始查询可用日期列表`);

        // 查询两个表中都有数据的日期（取交集）
        const [rows] = await mysqlPool.query(
            `SELECT DISTINCT j.date
            FROM jintai_history_summary j
            INNER JOIN xfl_history_summary x ON j.date = x.date
            WHERE j.date IS NOT NULL
            ORDER BY j.date DESC
            LIMIT 90`
        );

        const dates = rows.map(row => row.date);

        const duration = Date.now() - startTime;
        logToFile(`[经营效率分析] 可用日期查询成功 (${duration}ms, 共${dates.length}天)`);

        res.json({
            success: true,
            dates: dates
        });
    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[经营效率分析] 可用日期查询失败 (${duration}ms): ${err.message}`);

        res.status(500).json({
            success: false,
            message: err.message || '查询可用日期失败',
            error: err.message
        });
    }
});

// 获取经营效率分析数据（日数据）
app.get('/api/local/efficiency-analysis-daily', async (req, res) => {
    const startTime = Date.now();
    const date = req.query.date; // yyyy-mm-dd 格式

    try {
        if (!date) {
            return res.status(400).json({
                success: false,
                message: '缺少date参数'
            });
        }

        logToFile(`[经营效率分析-日数据] 开始查询数据 (日期: ${date})`);

        // 查询锦泰广场站数据 (jintai_history_summary)
        const [jintaiRows] = await mysqlPool.query(
            `SELECT
                total_count,
                total_electricity,
                total_service_fee,
                total_duration
            FROM jintai_history_summary
            WHERE date = ? AND station_id = 'jintai_station_001'`,
            [date]
        );

        // 查询兴发路站数据 (xfl_history_summary)
        const [xflRows] = await mysqlPool.query(
            `SELECT
                order_count,
                electricity,
                service_fee,
                duration_text
            FROM xfl_history_summary
            WHERE date = ? AND scope = 'all'`,
            [date]
        );

        const jintaiData = jintaiRows[0] || {};
        const xflData = xflRows[0] || {};

        // 解析 xfl 的时长文本 "92小时6分15秒" -> 分钟
        function parseDurationText(text) {
            if (!text) return 0;
            const hourMatch = text.match(/(\d+)小时/);
            const minMatch = text.match(/(\d+)分/);
            const hours = hourMatch ? parseInt(hourMatch[1]) : 0;
            const mins = minMatch ? parseInt(minMatch[1]) : 0;
            return hours * 60 + mins;
        }

        // 锦泰广场站：total_duration 已经是分钟数
        const jintaiTotalMinutes = parseFloat(jintaiData.total_duration) || 0;

        // 兴发路站：解析 duration_text
        const xflTotalMinutes = parseDurationText(xflData.duration_text);

        // 锦泰广场站计算 (48个充电枪)
        const jintaiDailyDuration = jintaiTotalMinutes / 48;
        const jintaiDailyUtilization = (jintaiDailyDuration / 1440).toFixed(4);  // 返回小数，前端会乘100
        const jintaiDailyElectricity = ((jintaiData.total_electricity || 0) / 48).toFixed(2);
        const jintaiDailyRevenue = ((jintaiData.total_service_fee || 0) / 48).toFixed(2);
        const jintaiAvgPower = jintaiTotalMinutes > 0 ? ((jintaiData.total_electricity || 0) / (jintaiTotalMinutes / 60)).toFixed(2) : '0.00';
        const jintaiDailyOrders = ((jintaiData.total_count || 0) / 48).toFixed(2);

        // 兴发路站计算 (20个充电枪)
        const xflDailyDuration = xflTotalMinutes / 20;
        const xflDailyUtilization = (xflDailyDuration / 1440).toFixed(4);  // 返回小数，前端会乘100
        const xflDailyElectricity = ((xflData.electricity || 0) / 20).toFixed(2);
        const xflDailyRevenue = ((xflData.service_fee || 0) / 20).toFixed(2);
        const xflAvgPower = xflData.total_duration_minutes > 0 ? ((xflData.electricity || 0) / (xflData.total_duration_minutes / 60)).toFixed(2) : '0.00';
        const xflDailyOrders = ((xflData.order_count || 0) / 20).toFixed(2);

        const duration = Date.now() - startTime;
        logToFile(`[经营效率分析-日数据] 数据查询成功 (${duration}ms, 日期: ${date})`);

        res.json({
            success: true,
            data: {
                gaolin: {
                    dailyDuration: jintaiDailyDuration.toFixed(2),
                    dailyUtilization: jintaiDailyUtilization,
                    dailyElectricity: jintaiDailyElectricity,
                    dailyRevenue: jintaiDailyRevenue,
                    avgPower: jintaiAvgPower,
                    dailyOrders: jintaiDailyOrders
                },
                sifangping: {
                    dailyDuration: xflDailyDuration.toFixed(2),
                    dailyUtilization: xflDailyUtilization,
                    dailyElectricity: xflDailyElectricity,
                    dailyRevenue: xflDailyRevenue,
                    avgPower: xflAvgPower,
                    dailyOrders: xflDailyOrders
                }
            }
        });
    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[经营效率分析-日数据] 数据查询失败 (${duration}ms): ${err.message}`);

        res.status(500).json({
            success: false,
            message: err.message || '查询经营效率分析日数据失败',
            error: err.message
        });
    }
});

// 获取经营效率分析数据（月数据）
app.get('/api/local/efficiency-analysis', async (req, res) => {
    const startTime = Date.now();
    const month = req.query.month; // yyyy-mm 格式

    try {
        if (!month) {
            return res.status(400).json({
                success: false,
                message: '缺少month参数'
            });
        }

        logToFile(`[经营效率分析] 开始查询数据 (月份: ${month})`);

        // 计算当月天数
        const [year, monthNum] = month.split('-').map(Number);
        const daysInMonth = new Date(year, monthNum, 0).getDate();

        // 查询锦泰广场站数据 (jintai_history_summary) - 按月汇总
        const [jintaiRows] = await mysqlPool.query(
            `SELECT
                SUM(total_count) as order_count,
                SUM(total_electricity) as electricity,
                SUM(total_service_fee) as service_fee,
                SUM(total_duration) as total_duration_minutes
            FROM jintai_history_summary
            WHERE DATE_FORMAT(date, '%Y-%m') = ? AND station_id = 'jintai_station_001'`,
            [month]
        );

        // 查询兴发路站数据 (xfl_history_summary) - 需要逐行解析时长
        const [xflDetailRows] = await mysqlPool.query(
            `SELECT
                order_count,
                electricity,
                service_fee,
                duration_text
            FROM xfl_history_summary
            WHERE DATE_FORMAT(date, '%Y-%m') = ? AND scope = 'all'`,
            [month]
        );

        // 解析 xfl 的时长文本并汇总
        let xflTotalOrders = 0;
        let xflTotalElectricity = 0;
        let xflTotalServiceFee = 0;
        let xflTotalMinutes = 0;

        for (const row of xflDetailRows) {
            xflTotalOrders += row.order_count || 0;
            xflTotalElectricity += parseFloat(row.electricity) || 0;
            xflTotalServiceFee += parseFloat(row.service_fee) || 0;
            xflTotalMinutes += parseDurationText(row.duration_text);
        }

        const jintaiData = jintaiRows[0] || {};
        const xflData = {
            order_count: xflTotalOrders,
            electricity: xflTotalElectricity,
            service_fee: xflTotalServiceFee,
            total_duration_minutes: xflTotalMinutes
        };

        // 锦泰广场站计算 (48个充电枪)
        const jintaiTotalMinutes = jintaiData.total_duration_minutes || 0;
        const jintaiDailyDuration = jintaiTotalMinutes / daysInMonth / 48;
        const jintaiDailyUtilization = (jintaiDailyDuration / 1440).toFixed(4);  // 返回小数，前端会乘100
        const jintaiDailyElectricity = ((jintaiData.electricity || 0) / daysInMonth / 48).toFixed(2);
        const jintaiDailyRevenue = ((jintaiData.service_fee || 0) / daysInMonth / 48).toFixed(2);
        const jintaiAvgPower = jintaiTotalMinutes > 0 ? ((jintaiData.electricity || 0) / (jintaiTotalMinutes / 60)).toFixed(2) : '0.00';
        const jintaiDailyOrders = ((jintaiData.order_count || 0) / daysInMonth / 48).toFixed(2);

        // 兴发路站计算 (20个充电枪)
        const xflDailyDuration = xflData.total_duration_minutes / daysInMonth / 20;
        const xflDailyUtilization = (xflDailyDuration / 1440).toFixed(4);  // 返回小数，前端会乘100
        const xflDailyElectricity = ((xflData.electricity || 0) / daysInMonth / 20).toFixed(2);
        const xflDailyRevenue = ((xflData.service_fee || 0) / daysInMonth / 20).toFixed(2);
        const xflAvgPower = xflData.total_duration_minutes > 0 ? ((xflData.electricity || 0) / (xflData.total_duration_minutes / 60)).toFixed(2) : '0.00';
        const xflDailyOrders = ((xflData.order_count || 0) / daysInMonth / 20).toFixed(2);

        const duration = Date.now() - startTime;
        logToFile(`[经营效率分析] 数据查询成功 (${duration}ms, 月份: ${month})`);

        res.json({
            success: true,
            data: {
                gaolin: {
                    dailyDuration: jintaiDailyDuration.toFixed(2),
                    dailyUtilization: jintaiDailyUtilization,
                    dailyElectricity: jintaiDailyElectricity,
                    dailyRevenue: jintaiDailyRevenue,
                    avgPower: jintaiAvgPower,
                    dailyOrders: jintaiDailyOrders
                },
                sifangping: {
                    dailyDuration: xflDailyDuration.toFixed(2),
                    dailyUtilization: xflDailyUtilization,
                    dailyElectricity: xflDailyElectricity,
                    dailyRevenue: xflDailyRevenue,
                    avgPower: xflAvgPower,
                    dailyOrders: xflDailyOrders
                }
            }
        });
    } catch (err) {
        const duration = Date.now() - startTime;
        logToFile(`[经营效率分析] 数据查询失败 (${duration}ms): ${err.message}`);

        res.status(500).json({
            success: false,
            message: err.message || '查询经营效率分析数据失败',
            error: err.message
        });
    }
});

// 启动服务器
async function startServer() {
    try {
        // 初始化SQL Server数据库连接
        await initializePool();

        // 初始化MySQL数据库连接
        await initializeMySQLPool();

        // 启动HTTP服务器 - 监听所有网络接口(0.0.0.0)以允许外网访问
        app.listen(PORT, '0.0.0.0', () => {
            logToFile('\n========================================');
            logToFile('🚀 SQL Server 代理服务器已启动');
            logToFile(`📡 监听端口: ${PORT}`);
            logToFile(`🗄️  SQL Server: ${dbConfig.server}/${dbConfig.database}`);
            logToFile(`🗄️  MySQL: ${mysqlConfig.host}/${mysqlConfig.database}`);
            logToFile(`🔗 本地访问: http://localhost:${PORT}`);
            logToFile(`🌐 外网访问: http://csfhcdz.f3322.net:${PORT}`);
            logToFile(`💚 健康检查: http://csfhcdz.f3322.net:${PORT}/health`);
            logToFile(`📋 查看日志: http://csfhcdz.f3322.net:${PORT}/logs`);
            logToFile(`📁 日志文件: ${LOG_FILE}`);
            logToFile('========================================\n');
        });

    } catch (err) {
        logToFile('服务器启动失败: ' + err);
        process.exit(1);
    }
}

// 优雅关闭
process.on('SIGINT', async () => {
    logToFile('\n正在关闭服务器...');
    if (pool) {
        await pool.close();
        logToFile('SQL Server数据库连接已关闭');
    }
    if (mysqlPool) {
        await mysqlPool.end();
        logToFile('MySQL数据库连接已关闭');
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logToFile('\n正在关闭服务器...');
    if (pool) {
        await pool.close();
        logToFile('SQL Server数据库连接已关闭');
    }
    if (mysqlPool) {
        await mysqlPool.end();
        logToFile('MySQL数据库连接已关闭');
    }
    process.exit(0);
});

// 启动服务器
startServer();
