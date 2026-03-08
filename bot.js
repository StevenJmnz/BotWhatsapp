const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');


// ----------------------
// BORRAR SESIÓN (OPCIONAL)
// ----------------------
try {

    execSync('rm -rf ~/.cache/puppeteer');

    const sessionPath = path.join(__dirname,'.wwebjs_auth');

    if(fs.existsSync(sessionPath)){
        execSync(`rm -rf ${sessionPath}`);
    }

    console.log("Sesión anterior eliminada");

}catch(err){}


// ----------------------
// ENTRADA USUARIO
// ----------------------

const rl = readline.createInterface({
input:process.stdin,
output:process.stdout
});

rl.question("Ingresa los nombres de los grupos separados por coma: ", async (answer)=>{

const GRUPOS_ACTIVOS = answer.split(",").map(g=>g.trim());

console.log("Grupos activos:",GRUPOS_ACTIVOS);


// ----------------------
// CONFIG
// ----------------------

const client = new Client({
authStrategy:new LocalAuth(),
puppeteer:{
headless:true,
executablePath:'/usr/bin/chromium-browser',
args:['--no-sandbox','--disable-setuid-sandbox'],
timeout:0
}
});


const NECESARIOS = 100;
const HOMBRES_NECESARIOS = 40;
const MUJERES_NECESARIOS = 60;

const fecha = new Date().toISOString().split("T")[0];

const PALABRAS_CONFIRMACION = ["confirmo","confirmó","presente","voy","asistencia","participaré","cuenten conmigo","estoy adentro"];
const PALABRAS_REEMPLAZO = ["yo voy","me reemplazo","puedo ir"];


let grupos = {};
let confirmados = {};
let reemplazos = {};
let sexoUsuario = {};
let esperandoSexo = {};
let miembros = {};


// ----------------------
// QR
// ----------------------

client.on('qr', qr => {
qrcode.generate(qr,{small:true});
});


// ----------------------
// READY
// ----------------------

client.on('ready', async ()=>{

console.log("Bot listo");

await new Promise(r=>setTimeout(r,5000));

const chats = await client.getChats();

chats.forEach(chat=>{

if(!chat.isGroup) return;

if(!GRUPOS_ACTIVOS.includes(chat.name)) return;

const id = chat.id._serialized;

grupos[id] = chat.name;

confirmados[id] = [];
reemplazos[id] = [];
sexoUsuario[id] = {};
esperandoSexo[id] = {};
miembros[id] = {};

chat.participants.forEach(p=>{

const tel = p.id._serialized;

miembros[id][tel] = p.pushname || p.id.user;

});

console.log("Grupo cargado:",chat.name);

});

});


// ----------------------
// MENSAJES
// ----------------------

client.on('message', async message => {

try{

if(message.fromMe) return;

if(!message.from.includes("@g.us")) return;

const chat = await message.getChat();

if(!chat.isGroup) return;

if(!GRUPOS_ACTIVOS.includes(chat.name)) return;

const grupoID = chat.id._serialized;

const texto = (message.body || "").toLowerCase().trim();

const personaID = message.author || message.from;

const nombre = message._data?.notifyName || "Usuario";

if(!miembros[grupoID]) miembros[grupoID] = {};

miembros[grupoID][personaID] = nombre;


// ----------------------
// RESPUESTA SEXO
// ----------------------

if(esperandoSexo[grupoID][personaID]){

if(texto==="1" || texto==="2"){

const sexo = texto==="1"?"H":"M";

const hombresActual = Object.values(sexoUsuario[grupoID]).filter(x=>x==="H").length;
const mujeresActual = Object.values(sexoUsuario[grupoID]).filter(x=>x==="M").length;

if(sexo==="H" && hombresActual>=HOMBRES_NECESARIOS){

await message.reply("⚠️ Cupo de hombres lleno");

esperandoSexo[grupoID][personaID]=false;

return;
}

if(sexo==="M" && mujeresActual>=MUJERES_NECESARIOS){

await message.reply("⚠️ Cupo de mujeres lleno");

esperandoSexo[grupoID][personaID]=false;

return;
}

sexoUsuario[grupoID][personaID]=sexo;

if(!confirmados[grupoID].includes(personaID))
confirmados[grupoID].push(personaID);

await message.reply(`✅ Confirmado ${nombre}`);

esperandoSexo[grupoID][personaID]=false;

generarExcel(grupoID,chat.name);

return;

}

await message.reply("Responde:\n1 Hombre\n2 Mujer");

return;

}


// ----------------------
// CONFIRMAR
// ----------------------

if(PALABRAS_CONFIRMACION.some(p=>texto.includes(p))){

await message.reply("Responde:\n1️⃣ Hombre\n2️⃣ Mujer");

esperandoSexo[grupoID][personaID]=true;

return;

}


// ----------------------
// REEMPLAZO
// ----------------------

if(PALABRAS_REEMPLAZO.some(p=>texto.includes(p))){

if(!reemplazos[grupoID].includes(personaID)){

reemplazos[grupoID].push(personaID);

await message.reply("🟡 Reemplazo registrado");

generarExcel(grupoID,chat.name);

}

return;

}


// ----------------------
// REPORTE
// ----------------------

if(texto==="reporte"){

enviarReporte(chat,grupoID);

}


}catch(err){

console.log("ERROR MENSAJE:",err);

}

});


// ----------------------
// REPORTE
// ----------------------

function enviarReporte(chat,grupoID){

let listaH="";
let listaM="";

Object.entries(sexoUsuario[grupoID]).forEach(([tel,sexo],i)=>{

const nombre = miembros[grupoID][tel] || "Usuario";

if(sexo==="H")
listaH+=`${listaH.split("\n").length}. ${nombre}\n`;

if(sexo==="M")
listaM+=`${listaM.split("\n").length}. ${nombre}\n`;

});

const texto = `📊 REPORTE

Confirmados: ${confirmados[grupoID].length}
Reemplazos: ${reemplazos[grupoID].length}

👨 HOMBRES
${listaH || "Nadie"}

👩 MUJERES
${listaM || "Nadie"}
`;

chat.sendMessage(texto);

}


// ----------------------
// EXCEL
// ----------------------

async function generarExcel(grupoID,nombreGrupo){

const wb = new ExcelJS.Workbook();

const ws = wb.addWorksheet("Asistencia");

ws.addRow(["Nombre","Estado","Sexo","Fecha"]);

confirmados[grupoID].forEach(t=>{

const nombre = miembros[grupoID][t];

const sexo = sexoUsuario[grupoID][t]==="H"?"Hombre":"Mujer";

ws.addRow([nombre,"Confirmado",sexo,fecha]);

});

reemplazos[grupoID].forEach(t=>{

const nombre = miembros[grupoID][t] || "Usuario";

ws.addRow([nombre,"Reemplazo","-",fecha]);

});

await wb.xlsx.writeFile(`asistencia_${nombreGrupo}_${fecha}.xlsx`);

}


// ----------------------
// CRON REPORTE
// ----------------------

cron.schedule('0 * * * *', async ()=>{

const chats = await client.getChats();

for(const chat of chats){

if(!chat.isGroup) continue;

if(!GRUPOS_ACTIVOS.includes(chat.name)) continue;

const id = chat.id._serialized;

enviarReporte(chat,id);

}

});


// ----------------------

client.initialize();

rl.close();

});