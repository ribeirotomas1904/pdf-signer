import path from 'path';

import express from 'express';

const PORT = 3000;

const app = express();

app.get('/', (req, res) => {
    // TODO: handle sendFile error callback
    res.sendFile(path.resolve('static', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

