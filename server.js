const express = require('express');
const app = express();
const port = 3000;

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

app.listen(port, () => {
    console.log(`Web dashboard disponible en http://localhost:${port}`);
});