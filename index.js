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

        socket.on("error", () => {
            socket.destroy();
            resolve(null);
        });

        socket.on("timeout", () => {
            socket.destroy();
            resolve(null);
        });
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
        const toCheck = [];

        // --- НОВЫЙ ФИЛЬТР: 443/8443 и EE/DD ---
        allLines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed.includes('server=') || !trimmed.includes('port=')) return;
            
            const params = new URLSearchParams(trimmed.includes('?') ? trimmed.split('?')[1] : trimmed);
            const host = params.get('server');
            const port = parseInt(params.get('port'));
            const secret = (params.get('secret') || '').toLowerCase();

            // Проверка портов: 443 или 8443
            const isTargetPort = [443, 8443].includes(port);
            
            // Проверка секретов: начинаются на dd или ee
            const isTargetSecret = secret.startsWith('dd') || secret.startsWith('ee');

            // Прокси проходит, если подходит порт ИЛИ подходит секрет
            if (host && port > 0 && (isTargetPort || isTargetSecret) && !uniqueHosts.has(host)) {
                uniqueHosts.add(host);
                toCheck.push({ host, port, secret });
            }
        });

        console.log(`Уникальных прокси (443/8443 или DD/EE) для проверки: ${toCheck.length}`);

        // Сброс лимита постов раз в сутки
        const today = new Date().getDate();
        if (today !== lastPostDay) {
            postsToday = 0;
            lastPostDay = today;
        }

        // Проверка пинга
        const aliveNow = [];
        for (const proxy of toCheck.slice(0, 100)) { // Проверяем первые 100 подходящих
            const ping = await checkSocketDeep(proxy.host, proxy.port);
            if (ping !== null) {
                aliveNow.push({ ...proxy, ping });
            }
        }

        // Сортируем по пингу
        aliveNow.sort((a, b) => a.ping - b.ping);
        cachedProxies = aliveNow;

        // Логика авто-публикации в ТГ
        if (postsToday < DAILY_LIMIT) {
            const countToPublish = isFirstRun ? 1 : 2; 
            const toPublish = aliveNow.slice(0, countToPublish);
            
            if (toPublish.length > 0) {
                console.log(`Публикация: ${toPublish.length} шт. (FirstRun: ${isFirstRun})`);
                for (const proxy of toPublish) {
                    if (postsToday >= DAILY_LIMIT) break;
                    await sendToTelegram(proxy);
                    // Пауза 2 минуты между постами
                    await new Promise(r => setTimeout(r, 120000)); 
                }
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
    if (Date.now() - lastUpdate > 20 * 60 * 1000) {
        updateCache(); // Фоновое обновление
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