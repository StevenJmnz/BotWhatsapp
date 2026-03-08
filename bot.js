const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const ExcelJS = require('exceljs');

const client = new Client({
    authStrategy: new LocalAuth()
});

const NECESARIOS = 100;
const HOMBRES_NECESARIOS = 40;
const MUJERES_NECESARIOS = 60;
const fecha = new Date().toISOString().split("T")[0];

const GRUPOS_ACTIVOS = ["Direct Jobs Turno Noche"];

const PALABRAS_CONFIRMACION = ["confirmo","Confirmo","confirmó","Confirmó","presente","voy","asistencia","participaré","cuenten conmigo","estoy adentro"];
const PALABRAS_REEMPLAZO = ["yo voy","me reemplazo","puedo ir"];

let miembrosPorGrupo = {};
let confirmadosPorGrupo = {};
let reemplazosPorGrupo = {};
let sexoPorUsuario = {};       // { grupoID: { telefono: 'H'/'M' } }
let esperandoSexo = {};        // { grupoID: { telefono: true } }

client.on('qr', qr => qrcode.generate(qr, {small:true}));

client.on('ready', async () => {
    console.log("Bot listo");

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
});

client.on('message', async message => {

    if(!message.from.includes("@g.us")) return;
    const chat = await message.getChat();
    if(!chat.isGroup) return;
    if(!GRUPOS_ACTIVOS.includes(chat.name)) return;

    const grupoID = chat.id._serialized;
    const texto = message.body.toLowerCase().trim();
    const personaID = message.author;
    const personaNombre = message._data.notifyName || "Usuario";

    // Registrar miembro
    miembrosPorGrupo[grupoID][personaID] = personaNombre;

    // Si el usuario estaba en espera de sexo
    if(esperandoSexo[grupoID][personaID]){
        if(texto === "1" || texto === "2"){
            const sexo = texto === "1" ? "H" : "M";

            // Validar límite de cupo por sexo
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
            message.reply(`✅ Confirmación registrada: ${personaNombre} (${sexo === "H" ? "Hombre" : "Mujer"}) recuerde no puede laborar mas de 5 dias`);
            generarExcel(grupoID, chat.name);
            esperandoSexo[grupoID][personaID] = false;
        } else {
            message.reply("Por favor responde solo:\n1️⃣ Hombre\n2️⃣ Mujer");
        }
        return;
    }

    // Palabras de confirmación sin sexo definido
    if(PALABRAS_CONFIRMACION.some(p => texto.includes(p))){
        message.reply("Para completar tu confirmación responde con:\n1️⃣ Hombre\n2️⃣ Mujer");
        esperandoSexo[grupoID][personaID] = true;
        return;
    }

    // Palabras de reemplazo
    if(PALABRAS_REEMPLAZO.some(p => texto.includes(p))){
        if(!reemplazosPorGrupo[grupoID].includes(personaID)){
            reemplazosPorGrupo[grupoID].push(personaID);
            message.reply("🟡 Reemplazo registrado: " + personaNombre);
            generarExcel(grupoID, chat.name);
        }
    }

    if(texto === "reporte") enviarReporte(message, grupoID);
});

function faltantes(grupoID){
    const hombresFaltan = Math.max(0, HOMBRES_NECESARIOS - Object.values(sexoPorUsuario[grupoID]).filter(s => s==="H").length);
    const mujeresFaltan = Math.max(0, MUJERES_NECESARIOS - Object.values(sexoPorUsuario[grupoID]).filter(s => s==="M").length);
    return {hombres: hombresFaltan, mujeres: mujeresFaltan};
}

function enviarReporte(message, grupoID){
    let listaConfirmadosH = "";
    let listaConfirmadosM = "";

    Object.entries(sexoPorUsuario[grupoID]).forEach(([tel, sexo], i)=>{
        const nombre = miembrosPorGrupo[grupoID][tel];
        if(sexo === "H") listaConfirmadosH += `${listaConfirmadosH.split("\n").length}. ${nombre}\n`;
        if(sexo === "M") listaConfirmadosM += `${listaConfirmadosM.split("\n").length}. ${nombre}\n`;
    });

    const faltan = faltantes(grupoID);

    const texto = `📊 REPORTE

Fecha: ${fecha}

Confirmados: ${confirmadosPorGrupo[grupoID].length}
Reemplazos: ${reemplazosPorGrupo[grupoID].length}
Faltantes: Hombres: ${faltan.hombres}, Mujeres: ${faltan.mujeres}

👨 HOMBRES
${listaConfirmadosH || "Nadie aún"}

👩 MUJERES
${listaConfirmadosM || "Nadie aún"}
`;

    message.reply(texto);
}

async function generarExcel(grupoID,nombreGrupo){
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Asistencia");
    sheet.addRow(["Nombre","Estado","Sexo","Fecha"]);

    confirmadosPorGrupo[grupoID].forEach(telefono=>{
        const nombre = miembrosPorGrupo[grupoID][telefono];
        const sexo = sexoPorUsuario[grupoID][telefono] === "H" ? "Hombre" : "Mujer";
        sheet.addRow([nombre,"Confirmado",sexo,fecha]);
    });

    reemplazosPorGrupo[grupoID].forEach(telefono=>{
        const nombre = miembrosPorGrupo[grupoID][telefono] || "Desconocido";
        sheet.addRow([nombre,"Reemplazo","-",fecha]);
    });

    await workbook.xlsx.writeFile(`asistencia_${nombreGrupo}_${fecha}.xlsx`);
}

// Reporte automático cada 2 minutos                    
cron.schedule('0 * * * *', async () => { 
    const chats = await client.getChats();
    for(const chat of chats){
        if(!chat.isGroup) continue;
        if(!GRUPOS_ACTIVOS.includes(chat.name)) continue;
        const grupoID = chat.id._serialized;
        enviarReporte({reply: msg=>chat.sendMessage(msg)}, grupoID);
    }
});

// Lista completa si llega al número necesario
cron.schedule('0 * * * *', async () => { 
    const chats = await client.getChats();
    for(const chat of chats){
        if(!chat.isGroup) continue;
        if(!GRUPOS_ACTIVOS.includes(chat.name)) continue;
        const grupoID = chat.id._serialized;

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

client.initialize();