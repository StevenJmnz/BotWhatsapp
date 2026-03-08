const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ----------------------
// BORRAR SESIÓN ANTERIOR
// ----------------------
try {
    // Borra cache de Puppeteer
    execSync('rm -rf ~/.cache/puppeteer');
    // Borra sesión de WhatsApp
    const sessionPath = path.join(__dirname, '.wwebjs_auth');
    if (fs.existsSync(sessionPath)) execSync(`rm -rf ${sessionPath}`);
    console.log('Sesión y cache anteriores borradas ✅. Se pedirá QR nuevamente.');
} catch (err) {
    console.error('No se pudo borrar la sesión/cache:', err.message);
}

// ----------------------
// ENTRADA DE USUARIO: GRUPOS ACTIVOS
// ----------------------
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

rl.question('Ingresa los nombres de los grupos separados por comas: ', (answer) => {
    const GRUPOS_ACTIVOS = answer.split(',').map(g => g.trim());
    console.log('Grupos activos:', GRUPOS_ACTIVOS.join(', '));

    // ----------------------
    // CONFIG BOT
    // ----------------------
    const client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            executablePath: '/usr/bin/chromium-browser',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding'
            ],
            defaultViewport: null,
            timeout: 0
        }
    });

    const NECESARIOS = 100;
    const HOMBRES_NECESARIOS = 40;
    const MUJERES_NECESARIOS = 60;
    const fecha = new Date().toISOString().split("T")[0];

    const PALABRAS_CONFIRMACION = ["confirmo","Confirmo","confirmó","Confirmó","presente","voy","asistencia","participaré","cuenten conmigo","estoy adentro"];
    const PALABRAS_REEMPLAZO = ["yo voy","me reemplazo","puedo ir"];

    let miembrosPorGrupo = {};
    let confirmadosPorGrupo = {};
    let reemplazosPorGrupo = {};
    let sexoPorUsuario = {};
    let esperandoSexo = {};

    // ----------------------
    // EVENTOS DEL BOT
    // ----------------------
    client.on('qr', qr => qrcode.generate(qr, {small:true}));

    client.on('ready', async () => {
        console.log("Bot listo, cargando chats...");
        // ⏳ Espera a que WhatsApp Web cargue todos los chats
        await new Promise(r => setTimeout(r, 8000));

        const chats = await client.getChats();
        const grupos = chats.filter(chat => chat.isGroup && GRUPOS_ACTIVOS.includes(chat.name));

        for(const grupo of grupos){
            const grupoID = grupo.id._serialized;

            // Inicializa estructuras si no existen
            miembrosPorGrupo[grupoID] = miembrosPorGrupo[grupoID] || {};
            confirmadosPorGrupo[grupoID] = confirmadosPorGrupo[grupoID] || [];
            reemplazosPorGrupo[grupoID] = reemplazosPorGrupo[grupoID] || [];
            sexoPorUsuario[grupoID] = sexoPorUsuario[grupoID] || {};
            esperandoSexo[grupoID] = esperandoSexo[grupoID] || {};

            grupo.participants.forEach(p => {
                const telefono = p.id._serialized;
                const nombre = p.pushname || p.id.user;
                miembrosPorGrupo[grupoID][telefono] = nombre;
            });

            console.log(`Grupo activo cargado: ${grupo.name}`);
        }
    });

    // ----------------------
    // MENSAJES
    // ----------------------
    client.on('message', async message => {
        if(!message.from.includes("@g.us")) return;
        const chat = await message.getChat();
        if(!chat.isGroup) return;
        if(!GRUPOS_ACTIVOS.includes(chat.name)) return;

        const grupoID = chat.id._serialized;
        const texto = message.body.toLowerCase().trim();
        const personaID = message.author;
        const personaNombre = message._data.notifyName || "Usuario";

        // Inicializa estructuras si no existen
        miembrosPorGrupo[grupoID] = miembrosPorGrupo[grupoID] || {};
        confirmadosPorGrupo[grupoID] = confirmadosPorGrupo[grupoID] || [];
        reemplazosPorGrupo[grupoID] = reemplazosPorGrupo[grupoID] || [];
        sexoPorUsuario[grupoID] = sexoPorUsuario[grupoID] || {};
        esperandoSexo[grupoID] = esperandoSexo[grupoID] || {};

        miembrosPorGrupo[grupoID][personaID] = personaNombre;

        if(esperandoSexo[grupoID][personaID]){
            if(texto === "1" || texto === "2"){
                const sexo = texto === "1" ? "H" : "M";

                const hombresActual = Object.values(sexoPorUsuario[grupoID]).filter(s => s==="H").length;
                const mujeresActual = Object.values(sexoPorUsuario[grupoID]).filter(s => s==="M").length;

                if(sexo === "H" && hombresActual >= HOMBRES_NECESARIOS){
                    message.reply("⚠️ Cupo de hombres lleno. Puedes quedar como reemplazo.");
                    esperandoSexo[grupoID][personaID] = false;
                    return;
                }
                if(sexo === "M" && mujeresActual >= MUJERES_NECESARIOS){
                    message.reply("⚠️ Cupo de mujeres lleno. Puedes quedar como reemplazo.");
                    esperandoSexo[grupoID][personaID] = false;
                    return;
                }

                sexoPorUsuario[grupoID][personaID] = sexo;
                confirmadosPorGrupo[grupoID].push(personaID);
                message.reply(`✅ Confirmación registrada: ${personaNombre} (${sexo === "H" ? "Hombre" : "Mujer"})`);
                generarExcel(grupoID, chat.name);
                esperandoSexo[grupoID][personaID] = false;
            } else {
                message.reply("Por favor responde solo:\n1️⃣ Hombre\n2️⃣ Mujer");
            }
            return;
        }

        if(PALABRAS_CONFIRMACION.some(p => texto.includes(p))){
            message.reply("Para completar tu confirmación responde con:\n1️⃣ Hombre\n2️⃣ Mujer");
            esperandoSexo[grupoID][personaID] = true;
            return;
        }

        if(PALABRAS_REEMPLAZO.some(p => texto.includes(p))){
            if(!reemplazosPorGrupo[grupoID].includes(personaID)){
                reemplazosPorGrupo[grupoID].push(personaID);
                message.reply("🟡 Reemplazo registrado: " + personaNombre);
                generarExcel(grupoID, chat.name);
            }
        }

        if(texto === "reporte") enviarReporte(chat, grupoID);
    });

    // ----------------------
    // FUNCIONES
    // ----------------------
    function enviarReporte(chat, grupoID){
        // Protege estructuras
        miembrosPorGrupo[grupoID] = miembrosPorGrupo[grupoID] || {};
        confirmadosPorGrupo[grupoID] = confirmadosPorGrupo[grupoID] || [];
        reemplazosPorGrupo[grupoID] = reemplazosPorGrupo[grupoID] || [];
        sexoPorUsuario[grupoID] = sexoPorUsuario[grupoID] || {};

        let listaH = "";
        let listaM = "";
        let numH = 1, numM = 1;

        Object.entries(sexoPorUsuario[grupoID]).forEach(([tel,sexo])=>{
            const nombre = miembrosPorGrupo[grupoID][tel] || "Usuario";
            if(sexo==="H"){ listaH += `${numH}. ${nombre}\n`; numH++; }
            if(sexo==="M"){ listaM += `${numM}. ${nombre}\n`; numM++; }
        });

        const texto = `📊 REPORTE

Confirmados: ${confirmadosPorGrupo[grupoID].length}
Reemplazos: ${reemplazosPorGrupo[grupoID].length}

👨 HOMBRES
${listaH || "Nadie"}

👩 MUJERES
${listaM || "Nadie"}
`;
        chat.sendMessage(texto);
    }

    async function generarExcel(grupoID, nombreGrupo){
        miembrosPorGrupo[grupoID] = miembrosPorGrupo[grupoID] || {};
        confirmadosPorGrupo[grupoID] = confirmadosPorGrupo[grupoID] || [];
        reemplazosPorGrupo[grupoID] = reemplazosPorGrupo[grupoID] || [];
        sexoPorUsuario[grupoID] = sexoPorUsuario[grupoID] || {};

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Asistencia");
        sheet.addRow(["Nombre","Estado","Sexo","Fecha"]);

        confirmadosPorGrupo[grupoID].forEach(tel=>{
            const nombre = miembrosPorGrupo[grupoID][tel] || "Usuario";
            const sexo = sexoPorUsuario[grupoID][tel] === "H" ? "Hombre" : "Mujer";
            sheet.addRow([nombre,"Confirmado",sexo,fecha]);
        });

        reemplazosPorGrupo[grupoID].forEach(tel=>{
            const nombre = miembrosPorGrupo[grupoID][tel] || "Desconocido";
            sheet.addRow([nombre,"Reemplazo","-",fecha]);
        });

        await workbook.xlsx.writeFile(`asistencia_${nombreGrupo}_${fecha}.xlsx`);
    }

    // ----------------------
    // CRON JOBS
    // ----------------------
    cron.schedule('0 * * * *', async () => { 
        const chats = await client.getChats();
        for(const chat of chats){
            if(!chat.isGroup) continue;
            if(!GRUPOS_ACTIVOS.includes(chat.name)) continue;
            const grupoID = chat.id._serialized;
            if(!confirmadosPorGrupo[grupoID]) continue; // 🔒 protección
            enviarReporte(chat, grupoID);
        }
    });

    cron.schedule('0 * * * *', async () => { 
        const chats = await client.getChats();
        for(const chat of chats){
            if(!chat.isGroup) continue;
            if(!GRUPOS_ACTIVOS.includes(chat.name)) continue;
            const grupoID = chat.id._serialized;
            if(!confirmadosPorGrupo[grupoID]) continue; // 🔒 protección
            if(confirmadosPorGrupo[grupoID].length >= NECESARIOS){
                let mensaje = "✅ LISTA COMPLETA\n\n";
                confirmadosPorGrupo[grupoID].forEach((t,i)=>{
                    mensaje += `${i+1}. ${miembrosPorGrupo[grupoID][t]}\n`;
                });
                chat.sendMessage(mensaje);
                generarExcel(grupoID,chat.name);
            }
        }
    });

    // ----------------------
    // INICIALIZAR BOT
    // ----------------------
    client.initialize();
    rl.close();
});