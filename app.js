const process = require('process');
const os = require('os');
const path = require('path');
const express = require('express');
const { exec } = require('child_process');
const crypto = require('crypto');
const auth = require('basic-auth');
const fs = require('fs');
const https = require('https');

const app = express();
const csrfTokens = new Map();

// ========== 配置管理 ==========
const CONFIG_FILE = path.join(__dirname, 'config.json');
const DEFAULT_CONFIG = {
  username: 'admin',
  password: 'admin',
  serverPort: 3000,
  domain: 'ct8.pl',
  checkInterval: 10,
  processes: [
    {
      name: 'example',
      command: 'echo "Hello World"'
    }
  ]
};

let config = { ...DEFAULT_CONFIG };
let monitorTimer = null;

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const savedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      config = { ...DEFAULT_CONFIG, ...savedConfig };
      console.log('✓ 配置已加载');
    } else {
      console.log('使用默认配置');
    }
  } catch (error) {
    console.error('加载配置失败，使用默认配置:', error.message);
  }
}

function saveConfig(newConfig) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
    config = { ...DEFAULT_CONFIG, ...newConfig };
    console.log('✓ 配置已保存');
    return true;
  } catch (error) {
    console.error('保存配置失败:', error.message);
    return false;
  }
}

// ========== CSRF Token 管理 ==========
const TOKEN_EXPIRE_TIME = 30 * 60 * 1000;

function generateCSRFToken() {
  const token = crypto.randomBytes(16).toString('hex');
  csrfTokens.set(token, Date.now());
  return token;
}

function cleanExpiredTokens() {
  const now = Date.now();
  for (const [token, timestamp] of csrfTokens.entries()) {
    if (now - timestamp > TOKEN_EXPIRE_TIME) {
      csrfTokens.delete(token);
    }
  }
}

function validateCSRFToken(req, res, next) {
  const token = req.headers['csrf-token'];
  if (!token) return res.status(403).send('缺少 CSRF 令牌');
  
  const timestamp = csrfTokens.get(token);
  if (!timestamp) return res.status(403).send('无效的 CSRF 令牌');
  
  if (Date.now() - timestamp > TOKEN_EXPIRE_TIME) {
    csrfTokens.delete(token);
    return res.status(403).send('CSRF 令牌已过期');
  }
  
  csrfTokens.set(token, Date.now());
  next();
}

setInterval(cleanExpiredTokens, 5 * 60 * 1000);

// ========== 中间件 ==========
app.use(express.json());

// 认证中间件（/oyz8 和 CSRF 令牌接口无需认证）
app.use((req, res, next) => {
  if (req.path === '/oyz8' || req.path === '/api/csrf-token') return next();
  
  const user = auth(req);
  if (user && user.name === config.username && user.pass === config.password) {
    return next();
  }
  
  res.set('WWW-Authenticate', 'Basic realm="Node"');
  res.status(401).send('需要认证');
});

// ========== 路由 ==========

// 获取 CSRF 令牌（需基本认证）
app.get('/api/csrf-token', (req, res) => {
  const user = auth(req);
  if (user && (user.name !== config.username || user.pass !== config.password)) {
    return res.status(401).send('认证失败');
  }
  const token = generateCSRFToken();
  res.json({ token });
});

// 保活探测端点 /oyz8
app.get('/oyz8', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html><head><title>Welcome to nginx!</title>
<style>body{width:35em;margin:0 auto;font-family:Tahoma,Verdana,Arial,sans-serif}</style>
</head><body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p>
<p>For online documentation and support please refer to <a href="http://nginx.org/">nginx.org</a>.</p>
<p><em>Thank you for using nginx.</em></p>
</body></html>`);
});

// 进程状态
app.get('/status', (req, res) => {
  exec('ps aux', (err, stdout) => {
    if (err) return res.type('html').send('<pre>获取进程失败：\n' + err + '</pre>');
    res.type('html').send('<pre>系统进程：\n' + stdout + '</pre>');
  });
});

// 控制面板
app.get('/control', (req, res) => {
  const csrfToken = generateCSRFToken();
  const USERNAME = os.userInfo().username;
  const WORKDIR = path.join('/home', USERNAME, 'domains', `${USERNAME}.${config.domain}`, 'public_nodejs');

  res.type('html').send(`<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>控制面板</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f5;padding:20px;line-height:1.6;color:#333}
.container{max-width:1200px;margin:0 auto}
h1{font-size:24px;margin-bottom:20px}
.section{background:white;padding:20px;margin-bottom:20px;border-radius:4px;border:1px solid #e0e0e0}
.section h2{font-size:18px;margin-bottom:15px;color:#555;border-bottom:1px solid #eee;padding-bottom:10px}
.info-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:10px}
.info-item{padding:10px;background:#f9f9f9;border-left:3px solid #4a90e2;font-size:14px}
.info-item strong{display:block;color:#666;font-size:12px;margin-bottom:5px}
.btn-group{display:flex;flex-wrap:wrap;gap:10px}
.btn{padding:10px 20px;border:none;border-radius:4px;font-size:14px;cursor:pointer;background:#4a90e2;color:white;transition:opacity .2s}
.btn:hover{opacity:.9}
.btn:active{opacity:.8}
.btn-success{background:#5cb85c}
.btn-danger{background:#d9534f}
.btn-warning{background:#f0ad4e}
.btn-secondary{background:#777}
.form-row{display:grid;grid-template-columns:repeat(5,1fr);gap:15px;margin-bottom:15px}
.form-group{margin-bottom:15px}
.form-group label{display:block;margin-bottom:5px;font-size:13px;font-weight:500;color:#555}
.form-group input,.form-group textarea{width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:4px;font-size:14px;font-family:inherit}
.form-group input:focus,.form-group textarea:focus{outline:none;border-color:#4a90e2}
.form-group textarea{font-family:monospace;height:150px;resize:vertical}
#output{background:#1e1e1e;color:#0f0;padding:15px;border-radius:4px;font-family:monospace;font-size:13px;white-space:pre-wrap;max-height:400px;overflow-y:auto;display:none}
#output.show{display:block}
.alert{padding:12px 15px;border-radius:4px;margin-bottom:20px;display:none;font-size:14px}
.alert.success{background:#dff0d8;color:#3c763d;border:1px solid #d6e9c6}
.alert.error{background:#f2dede;color:#a94442;border:1px solid #ebccd1}
.help{background:#f9f9f9;border:1px solid #e0e0e0;padding:10px;margin-top:10px;border-radius:4px;font-size:13px;color:#666}
.help pre{background:#fff;padding:8px;border-radius:3px;overflow-x:auto;margin:8px 0;border:1px solid #e0e0e0}
.status-bar{background:#f9f9f9;padding:8px 12px;border-radius:4px;font-size:13px;color:#666;margin-bottom:15px}
@media(max-width:1024px){.form-row{grid-template-columns:repeat(3,1fr)}}
@media(max-width:768px){.form-row{grid-template-columns:1fr}.btn-group{flex-direction:column}.btn{width:100%}.info-grid{grid-template-columns:1fr}}
</style>
</head><body>
<div class="container">
<h1>进程守护控制台</h1>
<div class="status-bar">Token 状态: <span id="tokenStatus">已加载</span></div>
<div class="alert" id="alert"></div>

<div class="section">
<h2>系统信息</h2>
<div class="info-grid">
<div class="info-item"><strong>工作目录</strong><div style="word-break:break-all">${WORKDIR}</div></div>
<div class="info-item"><strong>监控进程数</strong><div>${config.processes.length} 个</div></div>
<div class="info-item"><strong>检查间隔</strong><div>${config.checkInterval} 秒</div></div>
<div class="info-item"><strong>服务端口</strong><div>${config.serverPort}</div></div>
</div>
</div>

<div class="section">
<h2>快速操作</h2>
<div class="btn-group">
<button class="btn" onclick="viewStatus()">刷新进程</button>
<button class="btn btn-success" onclick="runMonitor()">立即保活</button>
<button class="btn btn-danger" onclick="restart()">重启服务</button>
<button class="btn btn-secondary" onclick="refreshToken()">刷新Token</button>
</div>
</div>

<div id="output"></div>

<div class="section">
<h2>配置管理</h2>
<form id="configForm">
<div class="form-row">
<div class="form-group"><label>用户名</label><input type="text" name="username" value="${config.username}" required></div>
<div class="form-group"><label>密码</label><input type="password" name="password" value="${config.password}" required></div>
<div class="form-group"><label>域名</label><input type="text" name="domain" value="${config.domain}" required></div>
<div class="form-group"><label>服务器端口</label><input type="number" name="serverPort" value="${config.serverPort}" required></div>
<div class="form-group"><label>检查间隔(秒)</label><input type="number" name="checkInterval" value="${config.checkInterval}" min="5" required></div>
</div>
<div class="form-group">
<label>进程配置 (JSON)</label>
<textarea name="processes" required>${JSON.stringify(config.processes, null, 2)}</textarea>
<div class="help">
<strong>格式:</strong>
<pre>[{"name": "进程名", "command": "启动命令"}]</pre>
name: 进程关键字 | command: 启动命令
</div>
</div>
<button type="button" class="btn btn-warning" onclick="saveAndRestart()">保存配置并重启</button>
</form>
</div>
</div>

<script>
let csrfToken='${csrfToken}';
const output=document.getElementById('output');
const alert=document.getElementById('alert');
const tokenStatus=document.getElementById('tokenStatus');

function updateTokenStatus(s){tokenStatus.textContent=s}
async function refreshToken(){
try{updateTokenStatus('刷新中...');
const r=await fetch('/api/csrf-token');
if(!r.ok)throw new Error('获取失败');
const d=await r.json();
csrfToken=d.token;
updateTokenStatus('已更新');
showAlert('Token 刷新成功','success');
return true;
}catch(e){updateTokenStatus('刷新失败');showAlert('Token 刷新失败','error');return false}
}
async function fetchWithRetry(url,options={}){
try{const r=await fetch(url,{...options,headers:{...options.headers,'CSRF-Token':csrfToken}});
if(r.status===403){const refreshed=await refreshToken();if(refreshed){return fetch(url,{...options,headers:{...options.headers,'CSRF-Token':csrfToken}})}}
return r}catch(e){throw e}
}
function showAlert(msg,type='success'){alert.textContent=msg;alert.className='alert '+type;alert.style.display='block';setTimeout(()=>alert.style.display='none',5000)}
function showOutput(text){output.textContent=text;output.classList.add('show')}
async function viewStatus(){showOutput('加载中...');try{const r=await fetchWithRetry('/api/status');const t=await r.text();showOutput('进程列表:\\n\\n'+t)}catch(e){showOutput('错误: '+e.message)}}
async function runMonitor(){showOutput('执行中...');try{const r=await fetchWithRetry('/api/monitor',{method:'POST'});const t=await r.text();showOutput('保活任务完成:\\n\\n'+t);showAlert('保活成功','success')}catch(e){showOutput('错误: '+e.message);showAlert('保活失败','error')}}
async function restart(){if(!confirm('确定重启所有服务?'))return;showOutput('重启中...');try{const r=await fetchWithRetry('/api/restart',{method:'POST'});const t=await r.text();showOutput(t+'\\n\\n3秒后刷新页面...');showAlert('重启成功','success');setTimeout(()=>location.reload(),3000)}catch(e){showOutput('错误: '+e.message)}}
async function saveAndRestart(){if(!confirm('保存配置将重启服务，确定继续?'))return;const fd=new FormData(document.getElementById('configForm'));try{JSON.parse(fd.get('processes'))}catch(e){showAlert('JSON 格式错误','error');return}
const nc={username:fd.get('username'),password:fd.get('password'),domain:fd.get('domain'),serverPort:parseInt(fd.get('serverPort')),checkInterval:parseInt(fd.get('checkInterval')),processes:JSON.parse(fd.get('processes'))};
showOutput('保存中...');try{const r=await fetchWithRetry('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(nc)});if(!r.ok)throw new Error(await r.text());const t=await r.text();showOutput(t+'\\n\\n3秒后刷新页面...');showAlert('保存成功','success');setTimeout(()=>location.reload(),3000)}catch(e){showOutput('错误: '+e.message);showAlert('保存失败','error')}}
updateTokenStatus('已加载');
setInterval(refreshToken,10*60*1000);
</script>
</body></html>`);
});

// API：获取进程列表
app.get('/api/status', (req, res) => {
  exec('ps aux', (err, stdout) => {
    if (err) return res.status(500).send('获取进程失败');
    res.type('text').send(stdout);
  });
});

// API：手动触发保活
app.post('/api/monitor', validateCSRFToken, (req, res) => {
  exec('ps aux', (err, stdout) => {
    if (err) return res.status(500).send('获取进程失败');
    const results = [];
    config.processes.forEach(proc => {
      if (!stdout.includes(proc.name)) {
        exec(proc.command, (err) => {
          if (err) console.error(`启动 ${proc.name} 失败:`, err.message);
        });
        results.push(`✓ 启动: ${proc.name}`);
      } else {
        results.push(`✓ 运行中: ${proc.name}`);
      }
    });
    res.send(results.join('\n') || '所有进程正常运行');
  });
});

// API：重启服务
app.post('/api/restart', validateCSRFToken, (req, res) => {
  res.send('服务重启中...');
  setTimeout(() => {
    exec('killall -u $(whoami)', (err) => {
      if (err) console.error('重启失败:', err.message);
    });
  }, 500);
});

// API：保存配置并重启
app.post('/api/config', validateCSRFToken, (req, res) => {
  const newConfig = req.body;
  if (!newConfig.username || !newConfig.password || !Array.isArray(newConfig.processes)) {
    return res.status(400).send('配置格式错误');
  }
  if (!saveConfig(newConfig)) return res.status(500).send('保存配置失败');
  
  restartMonitor();
  res.send('配置已保存，服务重启中...');
  setTimeout(() => {
    exec('killall -u $(whoami)', (err) => {
      if (err) console.error('重启失败:', err.message);
    });
  }, 1000);
});

// ========== 自动保活注册（启动时调用一次） ==========
function registerKeepAlive() {
  const USERNAME = os.userInfo().username;
  const host = `auto-keep.${USERNAME}.${config.domain}`;   // auto-keep.<user>.ct8.pl 或 serv00.net
  const postData = JSON.stringify({ url: `http://${host}/oyz8` });

  const urlObj = new URL('https://trans.ct8.pl/add-url');
  const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || 443,
    path: urlObj.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
    timeout: 10000,
  };

  const req = https.request(options, (res) => {
    res.resume(); // 忽略响应体
  });

  req.on('error', (err) => {
    console.error('保活注册失败:', err.message);
  });

  req.on('timeout', () => {
    req.destroy();
    console.error('保活注册超时');
  });

  req.write(postData);
  req.end();

  console.log(`✓ 已向保活服务注册: http://${host}/oyz8`);
}

// ========== 进程守护逻辑 ==========
function keep_processes_alive() {
  exec('ps aux', (err, stdout) => {
    if (err) {
      console.error('进程检查失败:', err.message);
      return;
    }
    config.processes.forEach(proc => {
      if (!stdout.includes(proc.name)) {
        console.log(`保活 - 启动进程: ${proc.name}`);
        exec(proc.command, (err) => {
          if (err) console.error(`启动 ${proc.name} 失败:`, err.message);
          else console.log(`✓ ${proc.name} 已启动`);
        });
      }
    });
  });
}

function restartMonitor() {
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = setInterval(keep_processes_alive, config.checkInterval * 1000);
  console.log(`✓ 监控已启动 (间隔: ${config.checkInterval}秒)`);
}

function startServer() {
  loadConfig();

  // 启动时注册一次保活
  registerKeepAlive();

  const USERNAME = os.userInfo().username;
  const WORKDIR = path.join('/home', USERNAME, 'domains', `${USERNAME}.${config.domain}`, 'public_nodejs');
  try {
    process.chdir(WORKDIR);
    console.log('✓ 工作目录:', WORKDIR);
  } catch (err) {
    console.error('切换工作目录失败:', err.message);
  }

  keep_processes_alive();
  restartMonitor();

  app.listen(config.serverPort, () => {
    console.log(`✓ 服务器运行在端口 ${config.serverPort}`);
    console.log(`✓ 监控 ${config.processes.length} 个进程`);
  });
}

startServer();
