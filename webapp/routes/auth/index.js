function tryExtractTelegramUserId(initDataRaw=""){
    try {
        const params = new URLSearchParams(String(initDataRaw || ''));
        const userRaw = params.get('user');
        console.log(params);
        if (!userRaw) return null;

        const user = JSON.parse(userRaw)
        const userId = Number(user?.id);
        return Number.isFinite(userId) ? userId : null;
    } catch {
        return null;
    }
}


async function authRoutes(fastify) {
    fastify.get('/', async (req, res) => {
        const initData = req.headers['x-telegram-init-data'] || '';
        const telegramUserId = tryExtractTelegramUserId(initData);
        console.log(telegramUserId);


        const token = fastify.jwt.sign({ userId: telegramUserId });
        console.log(token);
        res.send(token);
    });
}

module.exports = authRoutes;
