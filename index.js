const express = require("express");
const net = require("net");
const cors = require("cors");

const app = express();

// Включаем CORS и JSON парсер
app.use(cors());
app.use(express.json());

/**
 * Функция проверки TCP-соединения (Пинг)
 */
function pingHost(proxy) {
    return new Promise((resolve) => {
        // Проверяем наличие обязательных полей
        if (!proxy.host || !proxy.port) {
            return resolve({ ...proxy, ping: -1, alive: false });
        }

        const host = proxy.host;
        const port = parseInt(proxy.port);
        const start = Date.now();
        const socket = new net.Socket();

        // Увеличиваем таймаут до 3000мс (3 сек), так как бесплатные прокси медленные
        socket.setTimeout(3000);

        socket.connect(port, host, () => {
            const ping = Date.now() - start;
            socket.destroy();
            resolve({ 
                ...proxy, 
                ping: ping, 
                alive: true 
            });
        });

        const handleError = () => {
            socket.destroy();
            resolve({ ...proxy, ping: -1, alive: false });
        };

        socket.on("error", handleError);
        socket.on("timeout", handleError);
    });
}

/**
 * API эндпоинт для проверки списка прокси
 */
app.post("/ping", async (req, res) => {
    try {
        const rawProxies = req.body.proxies || [];
        
        // Валидация: убираем объекты без хоста или порта
        const validProxies = rawProxies.filter(p => p.host && p.port);

        // Запускаем проверку всех прокси параллельно
        const results = await Promise.all(
            validProxies.map(p => pingHost(p))
        );

        // Сортировка: Живые вверху (по пингу), мертвые внизу
        results.sort((a, b) => {
            if (a.alive !== b.alive) return b.alive - a.alive;
            return a.ping - b.ping;
        });

        res.json(results);
    } catch (err) {
        console.error("Ошибка API:", err);
        res.status(500).json({ error: "Внутренняя ошибка сервера" });
    }
});

app.get("/", (req, res) => {
    res.send("<h1>MTProto Monitor API</h1><p>Status: Running 🚀</p>");
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});