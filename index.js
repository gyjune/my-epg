// 简化版本，避免复杂的重定向逻辑
const Config = {
    repository: 'celetor/epg',
    branch: '112114'
};

// 工具函数
function getNowDate() {
    const now = new Date();
    const china_time = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const year = china_time.getUTCFullYear();
    const month = china_time.getUTCMonth() + 1;
    const day = china_time.getUTCDate();
    
    return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function getFormatTime(time) {
    if (!time || time.length < 8) {
        return { date: getNowDate(), time: '00:00' };
    }

    const year = time.substring(0, 4);
    const month = time.substring(4, 6);
    const day = time.substring(6, 8);
    const date = `${year}-${month}-${day}`;

    let timeStr = '00:00';
    if (time.length >= 12) {
        const hour = time.substring(8, 10);
        const minute = time.substring(10, 12);
        timeStr = `${hour}:${minute}`;
    }

    return { date, time: timeStr };
}

// 简单的 fetch 包装，避免重定向问题
async function safeFetch(url) {
    try {
        console.log('Fetching:', url);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; EPG-Proxy/1.0)'
            },
            redirect: 'follow'
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response;
    } catch (error) {
        console.error('Fetch error:', error.message);
        throw error;
    }
}

// 处理 XML 请求
async function handleXmlRequest() {
    try {
        const xmlUrl = `https://github.com/${Config.repository}/releases/latest/download/${Config.branch}.xml`;
        const response = await safeFetch(xmlUrl);
        const xmlText = await response.text();
        
        return {
            status: 200,
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            },
            body: xmlText
        };
    } catch (error) {
        return {
            status: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Failed to fetch XML data' })
        };
    }
}

// 处理频道请求
async function handleChannelRequest(channel, date) {
    try {
        const cleanChannel = channel.replace(/[-]/g, '').toUpperCase();
        const tag = date.replace(/-/g, '.');
        const jsonUrl = `https://github.com/${Config.repository}/releases/download/${tag}/${Config.branch}.json`;
        
        console.log(`Fetching EPG for channel: ${cleanChannel}, date: ${date}`);
        
        const response = await safeFetch(jsonUrl);
        const data = await response.json();

        const programInfo = {
            date: date,
            channel_name: cleanChannel,
            url: `https://github.com/${Config.repository}`,
            epg_data: []
        };

        // 过滤该频道的节目
        if (Array.isArray(data)) {
            const dateStr = date.replace(/-/g, '');
            data.forEach(item => {
                if (item['@channel'] === cleanChannel && 
                    item['@start'] && 
                    item['@start'].startsWith(dateStr)) {
                    
                    programInfo.epg_data.push({
                        start: getFormatTime(item['@start']).time,
                        end: getFormatTime(item['@stop']).time,
                        title: item.title?.['#text'] || '未知节目',
                        desc: item.desc?.['#text'] || ''
                    });
                }
            });
        }

        // 如果没有找到节目，返回默认节目
        if (programInfo.epg_data.length === 0) {
            programInfo.epg_data.push({
                start: "00:00",
                end: "23:59",
                title: "未知节目",
                desc: ""
            });
        }

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(programInfo)
        };

    } catch (error) {
        console.error('Channel request error:', error);
        
        // 返回默认数据而不是错误
        const defaultProgram = {
            date: date,
            channel_name: channel,
            url: `https://github.com/${Config.repository}`,
            epg_data: [{
                start: "00:00",
                end: "23:59",
                title: "暂无节目信息",
                desc: error.message
            }]
        };

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(defaultProgram)
        };
    }
}

// 主请求处理函数
async function handleRequest(req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const channel = url.searchParams.get('ch');
    
    // 设置 CORS 头
    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    };

    // 处理 OPTIONS 请求
    if (req.method === 'OPTIONS') {
        return {
            status: 200,
            headers: corsHeaders,
            body: ''
        };
    }

    // 只处理 GET 请求
    if (req.method !== 'GET') {
        return {
            status: 405,
            headers: {
                'Content-Type': 'application/json',
                ...corsHeaders
            },
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    // 如果没有频道参数，返回 XML
    if (!channel) {
        return await handleXmlRequest();
    }

    // 处理频道请求
    let date = url.searchParams.get('date');
    if (!date) {
        date = getNowDate();
    } else {
        // 清理日期参数
        date = getFormatTime(date.replace(/\D+/g, '')).date;
    }

    return await handleChannelRequest(channel, date);
}

// Zeabur 入口点
module.exports = async (req, res) => {
    try {
        console.log('Request:', {
            method: req.method,
            url: req.url,
            query: req.query
        });

        const result = await handleRequest(req);
        
        // 设置响应头
        if (result.headers) {
            Object.entries(result.headers).forEach(([key, value]) => {
                res.setHeader(key, value);
            });
        }
        
        // 发送响应
        res.statusCode = result.status || 200;
        res.end(result.body || '');

    } catch (error) {
        console.error('Unhandled error:', error);
        
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify({ 
            error: 'Internal server error',
            message: error.message 
        }));
    }
};
