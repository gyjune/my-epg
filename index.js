const Config = {
    repository: 'celetor/epg',
    branch: '112114'
};

function makeRes(body, status = 200, headers = {}) {
    headers['access-control-allow-origin'] = '*';
    headers['content-type'] = 'application/json';
    return {
        status,
        headers,
        body: typeof body === 'string' ? body : JSON.stringify(body)
    };
}

function getNowDate() {
    const utc_timestamp = (new Date()).getTime();
    const china_time = new Date(utc_timestamp + 8 * 60 * 60 * 1000);
    const month = china_time.getMonth() + 1;
    const day = china_time.getDate();
    return `${china_time.getFullYear()}-${month < 10 ? '0' + month : month}-${day < 10 ? '0' + day : day}`;
}

function getFormatTime(time) {
    let result = {
        date: '',
        time: ''
    };

    if (time.length < 8) {
        result['date'] = getNowDate();
        return result;
    }

    let year = time.substring(0, 4);
    let month = time.substring(4, 6);
    let day = time.substring(6, 8);
    result['date'] = year + '-' + month + '-' + day;

    if (time.length >= 12) {
        let hour = time.substring(8, 10);
        let minute = time.substring(10, 12);
        result['time'] = hour + ':' + minute;
    }
    return result;
}

async function jq_fetch(url, options = {}) {
    let times = 5;
    let real_url = url;
    let isRedirect = false;
    let response = await fetch(real_url, options);

    while (times > 0) {
        console.log('status', response.status);
        if (response.status === 301 || response.status === 302) {
            isRedirect = true;
            real_url = response.headers.get('location');
        } else if (response.redirected === true) {
            isRedirect = true;
            real_url = response.url;
        } else {
            break;
        }
        if (isRedirect) {
            console.log('real_url', real_url);
            let newOptions = {
                headers: {}
            };
            
            // 复制 headers
            if (options.headers) {
                for (let [key, value] of Object.entries(options.headers)) {
                    if (key.toLowerCase() !== 'location') {
                        if (key.toLowerCase() === 'set-cookie') {
                            newOptions.headers['cookie'] = value;
                        } else {
                            newOptions.headers[key] = value;
                        }
                    }
                }
            }
            
            response = await fetch(real_url, newOptions);
            times -= 1;
        }
    }
    return response;
}

async function diypHandle(channel, date, options = {}) {
    const tag = date.replaceAll('-', '.');
    const url = `https://github.com/${Config.repository}/releases/download/${tag}/${Config.branch}.json`;
    
    try {
        const res = await jq_fetch(url, options);
        
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        
        const response = await res.json();

        console.log(channel, date);
        const program_info = {
            "date": date,
            "channel_name": channel,
            "url": `https://github.com/${Config.repository}`,
            "epg_data": []
        };
        
        if (Array.isArray(response)) {
            response.forEach(function (element) {
                if (element['@channel'] === channel && element['@start'].startsWith(date.replaceAll('-', ''))) {
                    program_info['epg_data'].push({
                        "start": getFormatTime(element['@start'])['time'],
                        "end": getFormatTime(element['@stop'])['time'],
                        "title": element['title'] && element['title']['#text'] ? element['title']['#text'] : '未知节目',
                        "desc": (element['desc'] && element['desc']['#text']) ? element['desc']['#text'] : ''
                    });
                }
            });
        }
        
        console.log(program_info);
        if (program_info['epg_data'].length === 0) {
            program_info['epg_data'].push({
                "start": "00:00",
                "end": "23:59",
                "title": "未知节目",
                "desc": ""
            });
        }
        return program_info;
    } catch (error) {
        console.error('Error in diypHandle:', error);
        return {
            "date": date,
            "channel_name": channel,
            "url": `https://github.com/${Config.repository}`,
            "epg_data": [{
                "start": "00:00",
                "end": "23:59",
                "title": "获取节目表失败",
                "desc": error.message
            }]
        };
    }
}

async function fetchHandler(req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const channel = url.searchParams.get("ch");

    if (!channel || channel.length === 0) {
        try {
            const xmlUrl = `https://github.com/${Config.repository}/releases/latest/download/${Config.branch}.xml`;
            const xml_res = await jq_fetch(xmlUrl);
            
            if (xml_res.ok) {
                const xml_text = await xml_res.text();
                return makeRes(xml_text, 200, {
                    'content-type': 'text/xml; charset=utf-8',
                    'access-control-allow-origin': '*'
                });
            } else {
                throw new Error(`Failed to fetch XML: ${xml_res.status}`);
            }
        } catch (error) {
            console.error('Error fetching XML:', error);
            return makeRes('Failed to fetch EPG data', 500);
        }
    }

    let date = url.searchParams.get("date");
    if (date) {
        date = getFormatTime(date.replace(/\D+/g, ''))['date'];
    } else {
        date = getNowDate();
    }

    const cleanChannel = channel.replaceAll('-', '').toUpperCase();
    
    if (parseInt(date.replaceAll('-', '')) >= 20240214) {
        const options = {
            headers: {
                'user-agent': 'Mozilla/5.0 (compatible; EPG-Proxy/1.0)'
            }
        };
        
        const programInfo = await diypHandle(cleanChannel, date, options);
        return makeRes(programInfo);
    } else {
        return makeRes({
            "date": date,
            "channel_name": cleanChannel,
            "url": `https://github.com/${Config.repository}`,
            "epg_data": [{
                "start": "00:00",
                "end": "23:59",
                "title": "历史日期无数据",
                "desc": ""
            }]
        });
    }
}

// Zeabur 专用导出 - 简化版本
module.exports = async (req, res) => {
    try {
        console.log('Request received:', req.method, req.url);
        
        // 设置 CORS 头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        // 处理 OPTIONS 请求
        if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.end();
            return;
        }
        
        // 只处理 GET 请求
        if (req.method !== 'GET') {
            res.statusCode = 405;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }
        
        const result = await fetchHandler(req);
        
        // 设置响应头
        if (result.headers) {
            for (const [key, value] of Object.entries(result.headers)) {
                res.setHeader(key, value);
            }
        }
        
        // 设置状态码和响应体
        res.statusCode = result.status || 200;
        res.end(result.body);
        
    } catch (err) {
        console.error('Server error:', err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
            error: 'Internal server error',
            message: err.message 
        }));
    }
};