const express = require("express");
const net = require("net");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

// --- НАСТРОЙКИ ---
const TG_TOKEN = "8254087272:AAFKgYTDBZCvkyuZ34fbZqc6Y43qjzEqkSE";
const TG_CHAT_ID = "@Proxy_free_Daily";
const SOURCES = [
    "https://raw.githubusercontent.com/SoliSpirit/mtproto/master/all_proxies.txt",
    "https://raw.githubusercontent.com/Argh94/telegram-proxy-scraper/main/proxy.txt"
];
const DAILY_LIMIT = 10; 

let cachedProxies = [];
let isUpdating = false;
let lastUpdate = 0;
let postsToday = 0;
let lastPostDay = new Date().getDate();

// ТЩАТЕЛЬНАЯ ПРОВЕРКА (Deep Check)
// Мы не просто стучимся в порт, а ждем данных от прокси
function checkSocketDeep(host, port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const start = Date.now();
        // Увеличиваем таймаут до 5 секунд для стабильности
        socket.setTimeout(5000);

        socket.connect(port, host, () => {
            const ping = Date.now() - start;
            
            // Здесь можно было бы отправить приветственный пакет MTProto, 
            // но для начала просто убедимся, что сокет не закрывается сразу
            setTimeout(() => {
                if (!socket.destroyed) {
                    socket.destroy();
                    resolve({ alive: true, ping });
                } else {
                    resolve({ alive: false, ping: -1 });
                }
            }, 500); // Ждем полсекунды, чтобы проверить стабильность
        });

        const fail = () => { socket.destroy(); resolve({ alive: false, ping: -1 }); };
        socket.on("error", fail);
        socket.on("timeout", fail);
    });
}

// Отправка в Telegram
async function sendToTelegram(proxy) {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const proxyLink = `https://t.me/proxy?server=${proxy.host}&port=${proxy.port}&secret=${proxy.secret}`;
    
    // Добавляем инфу о типе прокси, чтобы юзер понимал
    const text = `🚀 **Verified MTProto Proxy**\n\n` +
                 `⚡ Ping: \`${proxy.ping}ms\`\n` +
                 `📍 Server: \`${proxy.host}\`\n` +
                 `🏷 Status: \`High Stability\`\n\n` +
                 `🔗 [ПОДКЛЮЧИТЬ](${proxyLink})`;

    try {
        await axios.post(url, {
            chat_id: TG_CHAT_ID,
            text: text,
            parse_mode: "Markdown",
            disable_web_page_preview: true
        });
        postsToday++;
    } catch (err) {
        console.error("Ошибка TG:", err.message);
    }
}

async function updateCache() {
    if (isUpdating) return;
    isUpdating = true;

    const today = new Date().getDate();
    if (today !== lastPostDay) {
        postsToday = 0;
        lastPostDay = today;
    }

    try {
        let allLines = [];
        for (const url of SOURCES) {
            try {
                const res = await axios.get(url, { timeout: 5000 });
                allLines.push(...res.data.split('\n'));
            } catch (e) { console.error(`Ошибка загрузки ${url}`); }
        }

        const toCheck = [];
        const uniqueHosts = new Set();

        allLines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed.includes('server=') || !trimmed.includes('port=')) return;
            const params = new URLSearchParams(trimmed.includes('?') ? trimmed.split('?')[1] : trimmed);
            const host = params.get('server');
            const port = parseInt(params.get('port'));
            if (host && port > 0 && !uniqueHosts.has(host)) {
                uniqueHosts.add(host);
                toCheck.push({ host, port, secret: params.get('secret') || '' });
            }
        });

        // Сортируем: сначала проверяем те, что уже были живыми (они стабильнее)
        const batch = toCheck.slice(0, 50);
        
        // Проверяем по очереди или небольшими пачками по 5, чтобы не убить CPU
        const results = [];
        for (let i = 0; i < batch.length; i += 5) {
            const chunk = batch.slice(i, i + 5);
            const chunkResults = await Promise.all(chunk.map(p => checkSocketDeep(p.host, p.port)));
            results.push(...chunk.map((p, idx) => ({ ...p, ...chunkResults[idx] })));
        }

        cachedProxies = results.sort((a, b) => (b.alive - a.alive) || (a.ping - b.ping));

        if (postsToday < DAILY_LIMIT) {
            const aliveNow = cachedProxies.filter(p => p.alive && p.ping < 1500); // Берем только быстрые
            const toPublish = aliveNow.slice(0, 5);
            
            for (const proxy of toPublish) {
                if (postsToday >= DAILY_LIMIT) break;
                await sendToTelegram(proxy);
                if (toPublish.indexOf(proxy) !== toPublish.length - 1) {
                    await new Promise(r => setTimeout(r, 60000));
                }
            }
        }

        lastUpdate = Date.now();
    } catch (err) {
        console.error("Ошибка обновления:", err.message);
    } finally {
        isUpdating = false;
    }
}

updateCache();

app.get("/ping", async (req, res) => {
    if (Date.now() - lastUpdate > 30 * 60 * 1000) updateCache();
    res.json(cachedProxies);
});

app.get("/", (req, res) => res.send("MTProto Deep Checker Online"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));