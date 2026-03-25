const express = require("express");
const net = require("net");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Функция одиночной проверки
function checkSocket(host, port, timeout) {
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const start = Date.now();

        socket.setTimeout(timeout);

        socket.connect(port, host, () => {
            const ping = Date.now() - start;
            socket.destroy();
            resolve({ alive: true, ping });
        });

        socket.on("error", () => {
            socket.destroy();
            resolve({ alive: false });
        });

        socket.on("timeout", () => {
            socket.destroy();
            resolve({ alive: false });
        });
    });
}

// Умная проверка с повтором
async function thoroughPing(proxy) {
    const host = proxy.host;
    const port = parseInt(proxy.port);

    if (isNaN(port) || port <= 0 || port > 65535) {
        return { ...proxy, alive: false, ping: -1 };
    }

    // Попытка №1 (быстрая - 2.5 сек)
    let result = await checkSocket(host, port, 2500);

    // Попытка №2 (контрольная, если первая провалена - 4 сек)
    if (!result.alive) {
        // Небольшая пауза перед повтором
        await new Promise(r => setTimeout(r, 200)); 
        result = await checkSocket(host, port, 4000);
    }

    return {
        ...proxy,
        alive: result.alive,
        ping: result.alive ? result.ping : -1
    };
}

app.post("/ping", async (req, res) => {
    try {
        const proxies = req.body.proxies || [];
        const limited = proxies.slice(0, 40); // Берем 40 лучших

        // Проверяем прокси порциями по 10 штук, чтобы не перегружать сеть
        const results = [];
        for (let i = 0; i < limited.length; i += 10) {
            const chunk = limited.slice(i, i + 10);
            const checkedChunk = await Promise.all(chunk.map(p => thoroughPing(p)));
            results.push(...checkedChunk);
        }

        res.json(results);
    } catch (err) {
        console.error("Error:", err);
        res.status(500).json({ error: "Internal Error" });
    }
});

app.get("/", (req, res) => res.send("MTProto Reliable Monitor Active"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));