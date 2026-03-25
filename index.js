const express = require("express");
const net = require("net");

const app = express();
app.use(express.json());

function pingHost(host, port) {
    return new Promise((resolve) => {
        const start = Date.now();
        const socket = new net.Socket();

        socket.setTimeout(1500);

        socket.connect(port, host, () => {
            const ping = Date.now() - start;
            socket.destroy();
            resolve({ host, port, ping, alive: true });
        });

        socket.on("error", () => resolve({ host, port, ping: -1, alive: false }));

        socket.on("timeout", () => {
            socket.destroy();
            resolve({ host, port, ping: -1, alive: false });
        });
    });
}

app.post("/ping", async (req, res) => {
    const proxies = req.body.proxies || [];

    const results = await Promise.all(
        proxies.map(p => pingHost(p.host, p.port))
    );

    results.sort((a, b) => {
        if (!a.alive) return 1;
        if (!b.alive) return -1;
        return a.ping - b.ping;
    });

    res.json(results);
});

app.get("/", (req, res) => {
    res.send("MTProto ping API работает 🚀");
});

app.listen(3000, () => console.log("Server started"));