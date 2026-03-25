const express = require("express");
const net = require("net");
const cors = require("cors");
const axios = require("axios"); // Убедись, что axios есть в package.json

const app = express();
app.use(cors());
app.use(express.json());

const RAW_DATA_URL = "https://raw.githubusercontent.com/SoliSpirit/mtproto/master/all_proxies.txt";
let cachedProxies = [];
let isUpdating = false;
let lastUpdate = 0;

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

// Фоновое обновление всех прокси
async function updateCache() {
    if (isUpdating) return;
    isUpdating = true;
    console.log("Запуск фонового обновления кэша...");

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
            if (host && port > 0 && port <= 65535) {
                toCheck.push({ host, port, secret: params.get('secret') || '', full: trimmed });
            }
        });

        // Проверяем пачками по 20, чтобы не вешать сервер
        const results = [];
        const limit = toCheck.slice(0, 150); // Проверяем максимум 150 штук
        for (let i = 0; i < limit.length; i += 20) {
            const chunk = limit.slice(i, i + 20);
            const checked = await Promise.all(chunk.map(async p => {
                const status = await checkSocket(p.host, p.port);
                return { ...p, ...status };
            }));
            results.push(...checked);
        }

        cachedProxies = results.sort((a, b) => {
            if (a.alive !== b.alive) return b.alive - a.alive;
            return (a.ping || 9999) - (b.ping || 9999);
        });

        lastUpdate = Date.now();
        console.log(`Кэш обновлен. Живых: ${cachedProxies.filter(p => p.alive).length}`);
    } catch (err) {
        console.error("Ошибка обновления:", err.message);
    } finally {
        isUpdating = false;
    }
}

// Принудительно обновляем при старте
updateCache();

app.get("/ping", async (req, res) => {
    // Если кэш старше 5 минут — запускаем обновление в фоне
    if (Date.now() - lastUpdate > 5 * 60 * 1000) {
        updateCache();
    }
    
    // Отдаем то, что есть в памяти (мгновенно)
    res.json(cachedProxies);
});

app.get("/", (req, res) => res.send("MTProto Cache Server is Online"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));