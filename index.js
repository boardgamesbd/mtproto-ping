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

// Состояние
let cachedProxies = [];
let isUpdating = false;
let lastUpdate = 0;
let postsToday = 0;
let lastPostDay = new Date().getDate();

// Проверка сокета
function checkSocket(host, port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const start = Date.now();
        socket.setTimeout(3500);
        socket.connect(port, host, () => {
            const ping = Date.now() - start;
            socket.destroy();
            resolve({ alive: true, ping });
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
    
    const text = `🚀 **TOP MTProto Proxy**\n\n` +
                 `⚡ Пинг: \`${proxy.ping}ms\`\n` +
                 `📍 Сервер: \`${proxy.host}\`\n\n` +
                 `🔗 [ПОДКЛЮЧИТЬ](${proxyLink})`;

    try {
        await axios.post(url, {
            chat_id: TG_CHAT_ID,
            text: text,
            parse_mode: "Markdown",
            disable_web_page_preview: true
        });
        postsToday++;
        console.log(`Пост отправлен. Всего за сегодня: ${postsToday}`);
    } catch (err) {
        console.error("Ошибка TG:", err.response?.data?.description || err.message);
    }
}

async function updateCache() {
    if (isUpdating) return;
    isUpdating = true;

    // Сброс счетчика при смене дня
    const today = new Date().getDate();
    if (today !== lastPostDay) {
        postsToday = 0;
        lastPostDay = today;
    }

    console.log("Запуск обновления из источников...");

    try {
        let allLines = [];
        for (const url of SOURCES) {
            try {
                const res = await axios.get(url);
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

        // Проверяем 50 штук
        const batch = toCheck.slice(0, 50);
        const results = await Promise.all(batch.map(async (p) => {
            const status = await checkSocket(p.host, p.port);
            return { ...p, ...status };
        }));

        cachedProxies = results.sort((a, b) => (b.alive - a.alive) || (a.ping - b.ping));

        // ЛОГИКА ПОСТИНГА ПАЧКОЙ
        if (postsToday < DAILY_LIMIT) {
            const aliveNow = cachedProxies.filter(p => p.alive);
            // Берем до 5 штук из свежего списка
            const toPublish = aliveNow.slice(0, 5);
            
            console.log(`Найдено живых: ${aliveNow.length}. Начинаем публикацию пачки...`);
            
            for (const proxy of toPublish) {
                if (postsToday >= DAILY_LIMIT) break;
                await sendToTelegram(proxy);
                // Задержка 1 минута между сообщениями в пачке
                if (toPublish.indexOf(proxy) !== toPublish.length - 1) {
                    console.log("Ждем 1 минуту перед следующим постом...");
                    await new Promise(r => setTimeout(r, 60000));
                }
            }
        }

        lastUpdate = Date.now();
    } catch (err) {
        console.error("Ошибка:", err.message);
    } finally {
        isUpdating = false;
    }
}

updateCache();

app.get("/ping", async (req, res) => {
    if (Date.now() - lastUpdate > 30 * 60 * 1000) updateCache();
    res.json(cachedProxies);
});

app.get("/", (req, res) => res.send("MTProto Parser Online"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));