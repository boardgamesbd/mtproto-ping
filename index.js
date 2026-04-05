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
 * Глубокая проверка сокета
 */
function checkSocketDeep(host, port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const start = Date.now();
        socket.setTimeout(5000); 

        socket.connect(port, host, () => {
            const ping = Date.now() - start;
            socket.destroy();
            resolve(ping);
        });

        socket.on("error", () => { socket.destroy(); resolve(null); });
        socket.on("timeout", () => { socket.destroy(); resolve(null); });
    });
}

/**
 * Отправка в Telegram
 */
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
        console.log(`Опубликовано в ТГ: ${proxy.host}`);
    } catch (err) {
        console.error("Ошибка отправки в ТГ:", err.message);
    }
}

/**
 * Основная логика обновления и фильтрации
 */
async function updateCache() {
    if (isUpdating) return;
    isUpdating = true;

    try {
        console.log("Начинаю сбор и фильтрацию прокси...");
        const allLines = [];
        for (const url of SOURCES) {
            try {
                const res = await axios.get(url, { timeout: 10000 });
                allLines.push(...res.data.split("\n"));
            } catch (e) {
                console.error(`Ошибка загрузки источника ${url}`);
            }
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
                const secret = (params.get('secret') || '').toLowerCase();

                if (!host || isNaN(port) || port <= 0 || port >= 65536) return;

                const isTargetPort = port === 443;
                const isTargetSecret = secret.startsWith('dd') || secret.startsWith('ee');

                if ((isTargetPort || isTargetSecret) && !uniqueHosts.has(host)) {
                    uniqueHosts.add(host);
                    toCheck.push({ host, port, secret });
                }
            } catch (e) { return; }
        });

        toCheck = toCheck.sort(() => Math.random() - 0.5);
        console.log(`Уникальных прокси после фильтрации: ${toCheck.length}`);

        const today = new Date().getDate();
        if (today !== lastPostDay) {
            postsToday = 0;
            lastPostDay = today;
        }

        const aliveNow = [];
        // Проверяем порцию из 150 штук
        for (const proxy of toCheck.slice(0, 150)) {
            const ping = await checkSocketDeep(proxy.host, proxy.port);
            if (ping !== null) {
                aliveNow.push({ ...proxy, ping });
                
                // ПРАВКА: Если кэш пуст, записываем первые 10 рабочих сразу, 
                // чтобы приложение мгновенно ожило для пользователя
                if (cachedProxies.length === 0 && aliveNow.length === 10) {
                    cachedProxies = [...aliveNow];
                    console.log("Первичный кэш наполнен (10 шт), продолжаем проверку...");
                }
            }
        }

        // Финальная сортировка по пингу
        aliveNow.sort((a, b) => a.ping - b.ping);
        cachedProxies = aliveNow;
        console.log(`Проверка завершена. Всего живых: ${aliveNow.length}`);

        // Публикация в ТГ
        if (postsToday < DAILY_LIMIT && aliveNow.length > 0) {
            const countToPublish = isFirstRun ? 1 : 2;
            const toPublish = aliveNow.slice(0, countToPublish);
            
            for (const proxy of toPublish) {
                if (postsToday >= DAILY_LIMIT) break;
                await sendToTelegram(proxy);
                await new Promise(r => setTimeout(r, 120000));
            }
            isFirstRun = false;
        }

        lastUpdate = Date.now();
    } catch (err) {
        console.error("Критическая ошибка обновления:", err.message);
    } finally {
        isUpdating = false;
    }
}

// API Эндпоинты
app.get("/ping", async (req, res) => {
    // Если данных совсем нет — ждем первую порцию
    if (cachedProxies.length === 0) {
        await updateCache();
    } else if (Date.now() - lastUpdate > 20 * 60 * 1000) {
        // Если данные просто устарели — обновляем в фоне, отдавая старые
        updateCache();
    }
    res.json(cachedProxies);
});

app.get("/", (req, res) => {
    res.send(`MTProto Monitor Active. Cached: ${cachedProxies.length}. Posts today: ${postsToday}/${DAILY_LIMIT}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});