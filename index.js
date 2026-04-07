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

let cachedProxies = [];
let isUpdating = false;
let lastUpdate = 0;

/**
 * Проверка сокета
 */
function checkSocket(proxy) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const start = Date.now();
        socket.setTimeout(8000); // 8 секунд на ожидание

        socket.connect(proxy.port, proxy.host, () => {
            const ping = Date.now() - start;
            socket.destroy();
            resolve({ ...proxy, ping, alive: true });
        });

        socket.on("error", () => { socket.destroy(); resolve({ ...proxy, alive: false, ping: 9999 }); });
        socket.on("timeout", () => { socket.destroy(); resolve({ ...proxy, alive: false, ping: 9999 }); });
    });
}

/**
 * Основная логика обновления
 */
async function updateCache() {
    if (isUpdating) return;
    isUpdating = true;

    try {
        console.log("Загрузка источников...");
        const allLines = [];
        for (const url of SOURCES) {
            try {
                const res = await axios.get(url, { timeout: 12000 });
                allLines.push(...res.data.split("\n"));
            } catch (e) {
                console.error(`Ошибка загрузки источника: ${url}`);
            }
        }

        const uniqueHosts = new Set();
        let candidates = [];

        allLines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed.includes('server=') || !trimmed.includes('port=')) return;
            
            try {
                const queryStr = trimmed.includes('?') ? trimmed.split('?')[1] : trimmed;
                const params = new URLSearchParams(queryStr);
                
                const host = params.get('server');
                const port = parseInt(params.get('port'));
                const secret = params.get('secret');

                // ВАЛИДАЦИЯ ПОРТА (Защита от ошибки 140409 и прочих)
                if (host && !isNaN(port) && port > 0 && port < 65536 && secret && !uniqueHosts.has(host)) {
                    uniqueHosts.add(host);
                    candidates.push({ 
                        host, 
                        port, 
                        secret, 
                        full: `tg://proxy?server=${host}&port=${port}&secret=${secret}`
                    });
                }
            } catch (e) {}
        });

        // Берем случайные 250 штук для проверки
        candidates = candidates.sort(() => Math.random() - 0.5).slice(0, 250);
        console.log(`Начинаю проверку ${candidates.length} прокси...`);

        const testedProxies = [];
        const batchSize = 15; // Небольшие пачки для стабильности на Render

        for (let i = 0; i < candidates.length; i += batchSize) {
            const batch = candidates.slice(i, i + batchSize);
            const results = await Promise.all(batch.map(p => checkSocket(p)));
            testedProxies.push(...results);
            
            // Если нашли первые 10 живых, обновляем кэш сразу, чтобы юзер не ждал
            const firstAlive = testedProxies.filter(p => p.alive);
            if (cachedProxies.length === 0 && firstAlive.length >= 10) {
                cachedProxies = sortLogic(firstAlive);
            }

            // Короткая пауза между пачками для обхода анти-флуда
            await new Promise(r => setTimeout(r, 100));
        }

        // Финальная сортировка
        const onlyAlive = testedProxies.filter(p => p.alive);
        cachedProxies = sortLogic(onlyAlive);
        
        console.log(`Обновление завершено. Найдено живых: ${onlyAlive.length}`);
        lastUpdate = Date.now();

    } catch (err) {
        console.error("Критическая ошибка обновления:", err.message);
    } finally {
        isUpdating = false;
    }
}

/**
 * Логика сортировки: EE секреты в топе, остальное по пингу
 */
function sortLogic(proxies) {
    return proxies.sort((a, b) => {
        const aIsEE = a.secret.toLowerCase().startsWith('ee');
        const bIsEE = b.secret.toLowerCase().startsWith('ee');
        
        if (aIsEE && !bIsEE) return -1;
        if (!aIsEE && bIsEE) return 1;
        return a.ping - b.ping;
    });
}

// API Эндпоинты
app.get("/ping", async (req, res) => {
    // Если кэш пуст — ждем первую проверку
    if (cachedProxies.length === 0) {
        await updateCache();
    } else if (Date.now() - lastUpdate > 10 * 60 * 1000) {
        // Если прошло больше 10 минут — обновляем в фоне
        updateCache();
    }
    res.json(cachedProxies);
});

app.get("/", (req, res) => {
    res.send(`Server Online. Cached: ${cachedProxies.length}. Last update: ${new Date(lastUpdate).toLocaleTimeString()}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});