const express = require("express");
const net = require("net");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

// Функция проверки TCP-соединения
function pingHost(proxy) {
    return new Promise((resolve) => {
        // Проверка на случай, если прилетел пустой объект
        if (!proxy || !proxy.host || !proxy.port) {
            return resolve({ ...proxy, ping: -1, alive: false, error: "Invalid data" });
        }

        const host = proxy.host;
        const port = parseInt(proxy.port);
        const start = Date.now();
        const socket = new net.Socket();

        socket.setTimeout(2000); // 2 секунды на попытку

        socket.connect(port, host, () => {
            const ping = Date.now() - start;
            socket.destroy();
            resolve({ 
                ...proxy, 
                ping: ping, 
                alive: true 
            });
        });

        socket.on("error", () => {
            socket.destroy();
            resolve({ ...proxy, ping: -1, alive: false });
        });

        socket.on("timeout", () => {
            socket.destroy();
            resolve({ ...proxy, ping: -1, alive: false });
        });
    });
}

app.post("/ping", async (req, res) => {
    try {
        const proxies = req.body.proxies || [];
        
        // Чтобы сервер не упал от слишком большого количества запросов за раз,
        // ограничиваем пачку (например, максимум 50 штук)
        const limitedProxies = proxies.slice(0, 60);

        const results = await Promise.all(
            limitedProxies.map(p => pingHost(p))
        );

        res.json(results);
    } catch (err) {
        console.error("Критическая ошибка:", err);
        res.status(500).json({ error: "Internal Server Error", details: err.message });
    }
});

// Для проверки, что сервер вообще жив
app.get("/", (req, res) => {
    res.send("MTProto Ping API is running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});