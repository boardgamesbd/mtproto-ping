const express = require("express");
const net = require("net");
const cors = require("cors"); // Добавлено: решение проблемы "Ошибка связи"

const app = express();

// Разрешаем запросы с любого домена (CORS)
app.use(cors());
app.use(express.json());

/**
 * Функция проверки TCP-соединения (Пинг)
 */
function pingHost(proxy) {
    return new Promise((resolve) => {
        const host = proxy.host;
        const port = parseInt(proxy.port);
        const start = Date.now();
        const socket = new net.Socket();

        // Таймаут 2 секунды для проверки
        socket.setTimeout(2000);

        socket.connect(port, host, () => {
            const ping = Date.now() - start;
            socket.destroy();
            resolve({ 
                ...proxy, // Возвращаем все исходные данные прокси
                ping: ping, 
                alive: true 
            });
        });

        // Обработка ошибки (сервер недоступен)
        socket.on("error", () => {
            socket.destroy();
            resolve({ ...proxy, ping: -1, alive: false });
        });

        // Обработка таймаута (сервер слишком долго отвечает)
        socket.on("timeout", () => {
            socket.destroy();
            resolve({ ...proxy, ping: -1, alive: false });
        });
    });
}

/**
 * API эндпоинт для массовой проверки
 */
app.post("/ping", async (req, res) => {
    try {
        const proxies = req.body.proxies || [];

        // Проверяем все прокси параллельно
        const results = await Promise.all(
            proxies.map(p => pingHost(p))
        );

        // Сортировка: сначала живые с лучшим пингом, потом мертвые
        results.sort((a, b) => {
            if (a.alive !== b.alive) return b.alive - a.alive;
            return a.ping - b.ping;
        });

        res.json(results);
    } catch (err) {
        res.status(500).json({ error: "Ошибка сервера при проверке" });
    }
});

/**
 * Простая проверка работоспособности в браузере
 */
app.get("/", (req, res) => {
    res.send("MTProto Gold API: Online 🚀");
});

// Настройка порта для Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});