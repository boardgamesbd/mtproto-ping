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

/**
 * Глубокая проверка сокета:
 * Не просто стучимся в порт, а имитируем начало передачи данных.
 */
function checkSocketDeep(host, port) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const start = Date.now();
        socket.setTimeout(5000); 

        socket.connect(port, host, () => {
            const ping = Date.now() - start;
            
            // Пытаемся отправить пустой байт, чтобы проверить реакцию сервера
            socket.write(Buffer.from([0x00])); 
            
            setTimeout(() => {
                if (!socket.destroyed) {
                    socket.destroy();
                    resolve({ alive: true, ping });
                } else {
                    resolve({ alive: false, ping: -1 });
                }
            }, 1000); // Ждем секунду на проверку стабильности
        });

        const fail = () => { socket.destroy(); resolve({ alive: false, ping: -1 }); };
        socket.on("error", fail);
        socket.on("timeout", fail);
    });
}

async function sendToTelegram(proxy) {
    const url = `https://api.telegram.org/bot${TG_TOKEN}/sendMessage`;
    const proxyLink = `https://t.me/proxy?server=${proxy.host}&port=${proxy.port}&secret=${proxy.secret}`;
    
    const text = `🚀 **Verified MTProto Proxy (Padding)**\n\n` +
                 `⚡ Пинг: \`${proxy.ping}ms\`\n` +
                 `📍 Сервер: \`${proxy.host}\`\n` +
                 `🛡 Секрет: \`dd-encoded\`\n\n` +
                 `🔗 [ПОДКЛЮЧИТЬ ПРЯМО СЕЙЧАС](${proxyLink})`;

    try {
        await axios.post(url, {
            chat_id: TG_CHAT_ID,
            text: text,
            parse_mode: "Markdown",
            disable_web_page_preview: true
        });
        postsToday++;
        console.log(`Пост отправлен (${postsToday}/${DAILY_LIMIT}): ${proxy.host}`);
    } catch (err) {
        console.error("Ошибка TG:", err.response?.data?.description || err.message);
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
                const res = await axios.get(url, { timeout: 7000 });
                allLines.push(...res.data.split('\n'));
            } catch (e) { console.error(`Ошибка загрузки источника: ${url}`); }
        }

        const toCheck = [];
        const uniqueHosts = new Set();

        allLines.forEach(line => {
            const trimmed = line.trim();
            if (!trimmed.includes('server=') || !trimmed.includes('port=')) return;
            
            const params = new URLSearchParams(trimmed.includes('?') ? trimmed.split('?')[1] : trimmed);
            const host = params.get('server');
            const port = parseInt(params.get('port'));
            const secret = params.get('secret') || '';

            // ФИЛЬТР: Пропускаем только современные секреты (начинаются на dd)
            const isModern = secret.toLowerCase().startsWith('dd');

            if (host && port > 0 && isModern && !uniqueHosts.has(host)) {
                uniqueHosts.add(host);
                toCheck.push({ host, port, secret });
            }
        });

        console.log(`Уникальных DD-прокси для проверки: ${toCheck.length}`);

        // Берем пачку из 50 штук
        const batch = toCheck.slice(0, 50);
        const results = [];
        
        // Проверяем по 5 штук одновременно, чтобы не вешать сетевой стек
        for (let i = 0; i < batch.length; i += 5) {
            const chunk = batch.slice(i, i + 5);
            const chunkResults = await Promise.all(chunk.map(p => checkSocketDeep(p.host, p.port)));
            results.push(...chunk.map((p, idx) => ({ ...p, ...chunkResults[idx] })));
        }

        cachedProxies = results.sort((a, b) => (b.alive - a.alive) || (a.ping - b.ping));

        // ПОСТИНГ
        if (postsToday < DAILY_LIMIT) {
            const aliveNow = cachedProxies.filter(p => p.alive && p.ping < 2000);
            const toPublish = aliveNow.slice(0, 5);
            
            if (toPublish.length > 0) {
                console.log(`Начинаем публикацию пачки из ${toPublish.length} шт.`);
                for (const proxy of toPublish) {
                    if (postsToday >= DAILY_LIMIT) break;
                    await sendToTelegram(proxy);
                    
                    // Делей 1 минута между постами в пачке
                    if (toPublish.indexOf(proxy) !== toPublish.length - 1) {
                        await new Promise(r => setTimeout(r, 60000));
                    }
                }
            }
        }

        lastUpdate = Date.now();
    } catch (err) {
        console.error("Критическая ошибка обновления:", err.message);
    } finally {
        isUpdating = false;
    }
}

// Старт при запуске
updateCache();

app.get("/ping", async (req, res) => {
    // Если прошло > 20 минут, обновляем
    if (Date.now() - lastUpdate > 20 * 60 * 1000) updateCache();
    res.json(cachedProxies);
});

app.get("/", (req, res) => res.send("MTProto DD-Only Checker Active"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));