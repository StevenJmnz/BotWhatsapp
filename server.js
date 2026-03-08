const express = require('express');
const app = express();
const port = 3000;
app.listen(port, '0.0.0.0', () => {
    console.log(`Web dashboard disponible en http://0.0.0.0:${port}`);
});

// Variables compartidas con el bot
global.botState = {
    grupos: {},      // id -> nombre
    confirmados: {}, // id -> [telefonos]
    reemplazos: {},  // id -> [telefonos]
    sexo: {}         // id -> {telefono: "H"/"M"}
};

// Servir archivos estáticos desde la carpeta public
app.use(express.static('public'));

// Endpoint para la API que devuelve el estado del bot
app.get('/api/status', (req, res) => {
    res.json(global.botState);
});

// Escucha en todas las interfaces para acceso externo
app.listen(port, '0.0.0.0', () => {
    console.log(`Web dashboard disponible en http://136.116.81.204:${port}`);
});