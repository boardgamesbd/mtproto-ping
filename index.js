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

/**
 * Проверка сокета
 */
function checkSocket(proxy) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const start = Date.now();
        socket.setTimeout(7000); // 7 секунд на ответ

        socket.connect(proxy.port, proxy.host, () => {
            const ping = Date.now() - start;
            socket.destroy();
            // Добавляем поле alive: true для фронтенда
            resolve({ ...proxy, ping, alive: true });
        });

        socket.on("error", () => { socket.destroy(); resolve({ ...proxy, alive: false }); });
        socket.on("timeout", () => { socket.destroy(); resolve({ ...proxy, alive: false }); });
    });
}

async function updateCache() {
    if (isUpdating) return;
    isUpdating = true;

    try {
        console.log("Загрузка источников...");
        const allLines = [];
        for (const url of SOURCES) {
            try {
                const res = await axios.get(url, { timeout: 10000 });
                allLines.push(...res.data.split("\n"));
            } catch (e) { console.error(`Ошибка источника: ${url}`); }
        }

        const uniqueHosts = new Set();
        let candidates = [];

        allLines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed.includes('server=') || !trimmed.includes('port=')) return;
            
            try {
                const params = new URLSearchParams(trimmed.includes('?') ? trimmed.split('?')[1] : trimmed);
                const host = params.get('server');
                const port = parseInt(params.get('port'));
                const secret = params.get('secret');

                if (host && port && secret && !uniqueHosts.has(host)) {
                    uniqueHosts.add(host);
                    // Формируем поле full для кнопок копирования на фронтенде
                    const full = `tg://proxy?server=${host}&port=${port}&secret=${secret}`;
                    candidates.push({ host, port, secret, full });
                }
            } catch (e) {}
        });

        // Перемешиваем и берем 200 штук
        candidates = candidates.sort(() => Math.random() - 0.5).slice(0, 200);
        console.log(`Проверка ${candidates.length} прокси...`);

        const results = [];
        const batchSize = 20;

        for (let i = 0; i < candidates.length; i += batchSize) {
            const batch = candidates.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(p => checkSocket(p)));
            results.push(...batchResults);
        }

        // Фильтруем и сортируем: сначала живые с секретом EE, потом остальные живые по пингу
        const finalNodes = results.filter(p => p.alive).sort((a, b) => {
            const aIsEE = a.secret.toLowerCase().startsWith('ee');
            const bIsEE = b.secret.toLowerCase().startsWith('ee');
            if (aIsEE && !bIsEE) return -1;
            if (!aIsEE && bIsEE) return 1;
            return a.ping - b.ping;
        });

        cachedProxies = finalNodes;
        console.log(`Обновление завершено. Найдено живых: ${finalNodes.length}`);
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
    } else if (Date.now() - lastUpdate > 10 * 60 * 1000) {
        updateCache();
    }
    res.json(cachedProxies);
});

app.get("/", (req, res) => {
    res.send(`Active. Live count: ${cachedProxies.length}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));