const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ----------------------
// BORRAR SESIÓN ANTERIOR (OPCIONAL)
// ----------------------
try {
    execSync('rm -rf ~/.cache/puppeteer');
    const sessionPath = path.join(__dirname, '.wwebjs_auth');
    if (fs.existsSync(sessionPath)) {
        execSync(`rm -rf ${sessionPath}`);
    }
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
            args: ['--no-sandbox','--disable-setuid-sandbox'],
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
        console.log("Bot listo");

        try {
            const chats = await client.getChats();
            const grupos = chats.filter(chat => chat.isGroup && GRUPOS_ACTIVOS.includes(chat.name));

            for(const grupo of grupos){
                const grupoID = grupo.id._serialized;

                miembrosPorGrupo[grupoID] = {};
                confirmadosPorGrupo[grupoID] = [];
                reemplazosPorGrupo[grupoID] = [];
                sexoPorUsuario[grupoID] = {};
                esperandoSexo[grupoID] = {};

                grupo.participants.forEach(p => {
                    const telefono = p.id._serialized;
                    const nombre = p.pushname || p.id.user;
                    miembrosPorGrupo[grupoID][telefono] = nombre;
                });

                console.log(`Grupo activo cargado: ${grupo.name}`);
            }
        } catch(e){
            console.error("Error cargando grupos:", e);
        }
    });

    // ----------------------
    // MENSAJES
    // ----------------------
    client.on('message', async message => {
        try {
            if(!message.from.includes("@g.us")) return;
            const chat = await message.getChat();
            if(!chat.isGroup) return;
            if(!GRUPOS_ACTIVOS.includes(chat.name)) return;

            const grupoID = chat.id._serialized;
            const texto = (message.body || "").toLowerCase().trim();
            const personaID = message.author;
            const personaNombre = message._data?.notifyName || "Usuario";

            if(!miembrosPorGrupo[grupoID]) miembrosPorGrupo[grupoID] = {};
            miembrosPorGrupo[grupoID][personaID] = personaNombre;

            // ----------------------
            // RESPUESTA SEXO
            // ----------------------
            if(esperandoSexo[grupoID][personaID]){
                if(texto === "1" || texto === "2"){
                    const sexo = texto === "1" ? "H" : "M";

                    const hombresActual = Object.values(sexoPorUsuario[grupoID] || {}).filter(s => s==="H").length;
                    const mujeresActual = Object.values(sexoPorUsuario[grupoID] || {}).filter(s => s==="M").length;

                    if(sexo === "H" && hombresActual >= HOMBRES_NECESARIOS){
                        await message.reply("⚠️ Cupo de hombres lleno. Puedes quedar como reemplazo.");
                        esperandoSexo[grupoID][personaID] = false;
                        return;
                    }
                    if(sexo === "M" && mujeresActual >= MUJERES_NECESARIOS){
                        await message.reply("⚠️ Cupo de mujeres lleno. Puedes quedar como reemplazo.");
                        esperandoSexo[grupoID][personaID] = false;
                        return;
                    }

                    if(!sexoPorUsuario[grupoID]) sexoPorUsuario[grupoID] = {};
                    sexoPorUsuario[grupoID][personaID] = sexo;

                    if(!confirmadosPorGrupo[grupoID]) confirmadosPorGrupo[grupoID] = [];
                    if(!confirmadosPorGrupo[grupoID].includes(personaID))
                        confirmadosPorGrupo[grupoID].push(personaID);

                    await message.reply(`✅ Confirmación registrada: ${personaNombre} (${sexo === "H" ? "Hombre" : "Mujer"})`);

                    esperandoSexo[grupoID][personaID] = false;

                    generarExcel(grupoID, chat.name);

                    return;
                } else {
                    await message.reply("Por favor responde solo:\n1️⃣ Hombre\n2️⃣ Mujer");
                    return;
                }
            }

            // ----------------------
            // CONFIRMAR
            // ----------------------
            if(PALABRAS_CONFIRMACION.some(p => texto.includes(p))){
                await message.reply("Para completar tu confirmación responde con:\n1️⃣ Hombre\n2️⃣ Mujer");
                if(!esperandoSexo[grupoID]) esperandoSexo[grupoID] = {};
                esperandoSexo[grupoID][personaID] = true;
                return;
            }

            // ----------------------
            // REEMPLAZO
            // ----------------------
            if(PALABRAS_REEMPLAZO.some(p => texto.includes(p))){
                if(!reemplazosPorGrupo[grupoID]) reemplazosPorGrupo[grupoID] = [];
                if(!reemplazosPorGrupo[grupoID].includes(personaID)){
                    reemplazosPorGrupo[grupoID].push(personaID);
                    await message.reply("🟡 Reemplazo registrado: " + personaNombre);
                    generarExcel(grupoID, chat.name);
                }
                return;
            }

            // ----------------------
            // REPORTE
            // ----------------------
            if(texto === "reporte"){
                enviarReporte(chat, grupoID);
                return;
            }

        } catch(err){
            console.error("Error manejando mensaje:", err);
        }
    });

    // ----------------------
    // FUNCIONES
    // ----------------------
    function faltantes(grupoID){
        const hombresFaltan = Math.max(0, (Object.values(sexoPorUsuario[grupoID] || {}).filter(s => s==="H").length || 0) - 0);
        const mujeresFaltan = Math.max(0, (Object.values(sexoPorUsuario[grupoID] || {}).filter(s => s==="M").length || 0) - 0);
        return {hombres: HOMBRES_NECESARIOS - hombresFaltan, mujeres: MUJERES_NECESARIOS - mujeresFaltan};
    }

    function enviarReporte(chat, grupoID){
        try {
            let listaConfirmadosH = "";
            let listaConfirmadosM = "";

            Object.entries(sexoPorUsuario[grupoID] || {}).forEach(([tel, sexo]) => {
                const nombre = miembrosPorGrupo[grupoID][tel] || "Usuario";
                if(sexo === "H") listaConfirmadosH += `${listaConfirmadosH.split("\n").length}. ${nombre}\n`;
                if(sexo === "M") listaConfirmadosM += `${listaConfirmadosM.split("\n").length}. ${nombre}\n`;
            });

            const faltan = faltantes(grupoID);

            const texto = `📊 REPORTE

Fecha: ${fecha}

Confirmados: ${confirmadosPorGrupo[grupoID]?.length || 0}
Reemplazos: ${reemplazosPorGrupo[grupoID]?.length || 0}
Faltantes: Hombres: ${faltan.hombres}, Mujeres: ${faltan.mujeres}

👨 HOMBRES
${listaConfirmadosH || "Nadie aún"}

👩 MUJERES
${listaConfirmadosM || "Nadie aún"}
`;

            chat.sendMessage(texto).catch(()=>{});
        } catch(e){
            console.error("Error enviando reporte:", e);
        }
    }

    async function generarExcel(grupoID,nombreGrupo){
        try {
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet("Asistencia");
            sheet.addRow(["Nombre","Estado","Sexo","Fecha"]);

            (confirmadosPorGrupo[grupoID] || []).forEach(telefono => {
                const nombre = miembrosPorGrupo[grupoID][telefono] || "Usuario";
                const sexo = sexoPorUsuario[grupoID][telefono] === "H" ? "Hombre" : "Mujer";
                sheet.addRow([nombre,"Confirmado",sexo,fecha]);
            });

            (reemplazosPorGrupo[grupoID] || []).forEach(telefono => {
                const nombre = miembrosPorGrupo[grupoID][telefono] || "Desconocido";
                sheet.addRow([nombre,"Reemplazo","-",fecha]);
            });

            await workbook.xlsx.writeFile(`asistencia_${nombreGrupo}_${fecha}.xlsx`);
        } catch(e){
            console.error("Error generando excel:", e);
        }
    }

    // ----------------------
    // CRON JOBS
    // ----------------------
    cron.schedule('0 * * * *', async () => { 
        try {
            const chats = await client.getChats();
            for(const chat of chats){
                if(!chat.isGroup) continue;
                if(!GRUPOS_ACTIVOS.includes(chat.name)) continue;
                const grupoID = chat.id._serialized;
                enviarReporte(chat, grupoID); // <- usar chat real
            }
        } catch(e){
            console.error("Error cron reporte:", e);
        }
    });

    cron.schedule('0 * * * *', async () => { 
        try {
            const chats = await client.getChats();
            for(const chat of chats){
                if(!chat.isGroup) continue;
                if(!GRUPOS_ACTIVOS.includes(chat.name)) continue;
                const grupoID = chat.id._serialized;
                if((confirmadosPorGrupo[grupoID] || []).length >= NECESARIOS){
                    let mensaje = "✅ LISTA COMPLETA\n\n";
                    (confirmadosPorGrupo[grupoID] || []).forEach((t,i)=>{
                        mensaje += `${i+1}. ${miembrosPorGrupo[grupoID][t]}\n`;
                    });
                    chat.sendMessage(mensaje).catch(()=>{});
                    generarExcel(grupoID,chat.name);
                }
            }
        } catch(e){
            console.error("Error cron lista completa:", e);
        }
    });

    // ----------------------
    // INICIALIZAR BOT
    // ----------------------
    client.initialize();
    rl.close();
});