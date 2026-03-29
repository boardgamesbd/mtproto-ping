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
const RAW_DATA_URL = "https://raw.githubusercontent.com/SoliSpirit/mtproto/master/all_proxies.txt";
const DAILY_LIMIT = 10; 

// Состояние
let cachedProxies = [];
let isUpdating = false;
let lastUpdate = 0;
let postsToday = 0;
let lastPostDay = new Date().getDate();

// Функция проверки одного хоста
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
    const today = new Date().getDate();
    if (today !== lastPostDay) {
        postsToday = 0;
        lastPostDay = today;
    }

    if (postsToday >= DAILY_LIMIT) return;

    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const proxyLink = `https://t.me/proxy?server=${proxy.host}&port=${proxy.port}&secret=${proxy.secret}`;
    
    const text = `🚀 **TOP MTProto Proxy**\n\n` +
                 `⚡ Пинг: \`${proxy.ping}ms\`\n` +
                 `📍 Сервер: \`${proxy.host}\`\n\n` +
                 `🔗 [ПОДКЛЮЧИТЬ ПРЯМО СЕЙЧАС](${proxyLink})`;

    try {
        await axios.post(url, {
            chat_id: TG_CHAT_ID,
            text: text,
            parse_mode: "Markdown",
            disable_web_page_preview: true
        });
        postsToday++;
        console.log(`Опубликовано в ТГ: ${postsToday}/${DAILY_LIMIT}`);
    } catch (err) {
        console.error("Ошибка TG:", err.response?.data?.description || err.message);
    }
}

async function updateCache() {
    if (isUpdating) return;
    isUpdating = true;
    console.log("Запуск обновления и поиск лучшего прокси...");

    try {
        const response = await axios.get(RAW_DATA_URL);
        const lines = response.data.split('\n');
        const toCheck = [];

        lines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed.includes('server=') || !trimmed.includes('port=')) return;
            const params = new URLSearchParams(trimmed.includes('?') ? trimmed.split('?')[1] : trimmed);
            const host = params.get('server');
            const port = parseInt(params.get('port'));
            if (host && port > 0) {
                toCheck.push({ host, port, secret: params.get('secret') || '', full: trimmed });
            }
        });

        // Берем первые 40 штук для проверки, чтобы не вешать Render
        const batch = toCheck.slice(0, 40);
        const results = await Promise.all(batch.map(async (p) => {
            const status = await checkSocket(p.host, p.port);
            return { ...p, ...status };
        }));

        cachedProxies = results.sort((a, b) => {
            if (a.alive !== b.alive) return b.alive - a.alive;
            return (a.ping || 9999) - (b.ping || 9999);
        });

        // ВЫБИРАЕМ ЛУЧШИЙ ДЛЯ ТЕЛЕГРАМА
        const bestProxy = cachedProxies.find(p => p.alive);
        if (bestProxy) {
            await sendToTelegram(bestProxy);
        }

        lastUpdate = Date.now();
    } catch (err) {
        console.error("Ошибка:", err.message);
    } finally {
        isUpdating = false;
    }
}

// Авто-обновление при старте
updateCache();

app.get("/ping", async (req, res) => {
    // Если кэш пуст — ждем немного
    if (cachedProxies.length === 0 && isUpdating) {
        let attempts = 0;
        while (isUpdating && attempts < 10) {
            await new Promise(r => setTimeout(r, 500));
            attempts++;
        }
    }
    
    // Обновляем, если прошло больше 10 минут
    if (Date.now() - lastUpdate > 10 * 60 * 1000) {
        updateCache();
    }
    
    res.json(cachedProxies);
});

app.get("/", (req, res) => res.send("MTProto Parser Online"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));