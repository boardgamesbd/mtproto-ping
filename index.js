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
    "https://raw.githubusercontent.com/SoliSpirit/mtproto/refs/heads/master/all_proxies.txt",
    "https://raw.githubusercontent.com/kort0881/telegram-proxy-collector/refs/heads/main/verified/proxy_ru_verified.txt",
    "https://raw.githubusercontent.com/kort0881/telegram-proxy-collector/refs/heads/main/verified/proxy_all_verified.txt"
];
const DAILY_LIMIT = 10; 

let cachedProxies = [];
let isUpdating = false;
let lastUpdate = 0;
let postsToday = 0;
let lastPostDay = new Date().getDate();
let isFirstRun = true;

/**
 * Проверка сокета
 */
function checkSocket(proxy) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const start = Date.now();
        socket.setTimeout(7000); 

        socket.connect(proxy.port, proxy.host, () => {
            const ping = Date.now() - start;
            socket.destroy();
            resolve({ ...proxy, ping });
        });

        socket.on("error", () => { socket.destroy(); resolve(null); });
        socket.on("timeout", () => { socket.destroy(); resolve(null); });
    });
}

/**
 * Логика сортировки: EE в приоритете, далее по пингу
 */
function prioritizeAndSort(proxies) {
    return proxies.sort((a, b) => {
        const aIsEE = a.secret.toLowerCase().startsWith('ee');
        const bIsEE = b.secret.toLowerCase().startsWith('ee');
        
        if (aIsEE && !bIsEE) return -1;
        if (!aIsEE && bIsEE) return 1;
        return a.ping - b.ping; // Если оба EE или оба не EE — по пингу
    });
}

async function sendToTelegram(proxy) {
    try {
        const link = `tg://proxy?server=${proxy.host}&port=${proxy.port}&secret=${proxy.secret}`;
        const text = `💎 *Новый высокоскоростной прокси*\n\n` +
                     `📍 Сервер: \`${proxy.host}\`\n` +
                     `🔌 Порт: \`${proxy.port}\`\n` +
                     `🔑 Секрет: \`${proxy.secret}\`\n` +
                     `📈 Пинг: ~${proxy.ping}ms\n\n` +
                     `🚀 [ПОДКЛЮЧИТЬСЯ](${link})`;

        await axios.post(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            chat_id: TG_CHAT_ID,
            text: text,
            parse_mode: "Markdown"
        });
        postsToday++;
    } catch (err) {
        console.error("Ошибка отправки в ТГ:", err.message);
    }
}

async function updateCache() {
    if (isUpdating) return;
    isUpdating = true;

    try {
        console.log("Сбор всех доступных прокси без фильтров...");
        const allLines = [];
        for (const url of SOURCES) {
            try {
                const res = await axios.get(url, { timeout: 15000 });
                allLines.push(...res.data.split("\n"));
            } catch (e) { console.error(`Ошибка источника: ${url}`); }
        }

        const uniqueHosts = new Set();
        let toCheck = [];

        allLines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.includes('server=') || !trimmed.includes('port=')) return;
            
            try {
                const queryString = trimmed.includes('?') ? trimmed.split('?')[1] : trimmed;
                const params = new URLSearchParams(queryString);
                const host = params.get('server');
                const port = parseInt(params.get('port'));
                const secret = params.get('secret');

                if (host && port > 0 && port < 65536 && secret && !uniqueHosts.has(host)) {
                    uniqueHosts.add(host);
                    toCheck.push({ host, port, secret });
                }
            } catch (e) {}
        });

        toCheck = toCheck.sort(() => Math.random() - 0.5).slice(0, 300);
        console.log(`Кандидатов: ${toCheck.length}. Начинаю проверку...`);

        const aliveNow = [];
        const batchSize = 25; // Параллельная проверка пачками

        for (let i = 0; i < toCheck.length; i += batchSize) {
            const batch = toCheck.slice(i, i + batchSize);
            const results = await Promise.all(batch.map(p => checkSocket(p)));
            const successful = results.filter(r => r !== null);
            
            aliveNow.push(...successful);
            
            // Быстрое наполнение кэша для пользователя
            if (cachedProxies.length === 0 && aliveNow.length >= 10) {
                cachedProxies = prioritizeAndSort([...aliveNow]);
            }
        }

        cachedProxies = prioritizeAndSort(aliveNow);
        console.log(`Обновление завершено. Живых: ${aliveNow.length}`);

        // Сброс счетчика постов
        const today = new Date().getDate();
        if (today !== lastPostDay) {
            postsToday = 0;
            lastPostDay = today;
        }

        // Публикация
        if (postsToday < DAILY_LIMIT && aliveNow.length > 0) {
            const countToPublish = isFirstRun ? 1 : 2;
            const toPublish = cachedProxies.slice(0, countToPublish);
            
            for (const proxy of toPublish) {
                if (postsToday >= DAILY_LIMIT) break;
                await sendToTelegram(proxy);
                await new Promise(r => setTimeout(r, 60000));
            }
            isFirstRun = false;
        }

        lastUpdate = Date.now();
    } catch (err) {
        console.error("Ошибка обновления:", err.message);
    } finally {
        isUpdating = false;
    }
}

app.get("/ping", async (req, res) => {
    if (cachedProxies.length === 0) {
        await updateCache();
    } else if (Date.now() - lastUpdate > 15 * 60 * 1000) {
        updateCache();
    }
    res.json(cachedProxies);
});

app.get("/", (req, res) => {
    res.send(`Active. Live: ${cachedProxies.length}. Posts: ${postsToday}/${DAILY_LIMIT}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});