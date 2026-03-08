const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const ExcelJS = require('exceljs');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Pedimos los grupos primero
rl.question('Ingresa los nombres de los grupos separados por comas: ', (answer) => {
    const GRUPOS_ACTIVOS = answer.split(',').map(g => g.trim());
    console.log('Grupos activos:', GRUPOS_ACTIVOS.join(', '));

    let index = 0;
    const NECESARIOS_POR_GRUPO = {};
    const HOMBRES_POR_GRUPO = {};
    const MUJERES_POR_GRUPO = {};

    function pedirNumerosGrupo() {
        if(index >= GRUPOS_ACTIVOS.length) {
            rl.close();
            iniciarBot();
            return;
        }

        const grupo = GRUPOS_ACTIVOS[index];
        rl.question(`Grupo "${grupo}" - Total personas necesarias: `, (total) => {
            rl.question(`Grupo "${grupo}" - Hombres necesarios: `, (hombres) => {
                rl.question(`Grupo "${grupo}" - Mujeres necesarios: `, (mujeres) => {
                    NECESARIOS_POR_GRUPO[grupo] = parseInt(total) || 0;
                    HOMBRES_POR_GRUPO[grupo] = parseInt(hombres) || 0;
                    MUJERES_POR_GRUPO[grupo] = parseInt(mujeres) || 0;
                    index++;
                    pedirNumerosGrupo();
                });
            });
        });
    }

    pedirNumerosGrupo();

    function iniciarBot() {
        const client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: {
                headless: true,
                executablePath: '/usr/bin/chromium-browser',
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                defaultViewport: null,
                timeout: 0
            }
        });

        const fecha = new Date().toISOString().split("T")[0];

        const PALABRAS_CONFIRMACION = ["confirmo","Confirmo","confirmó","Confirmó","presente","voy","asistencia","participaré","cuenten conmigo","estoy adentro"];
        const PALABRAS_REEMPLAZO = ["yo voy","me reemplazo","puedo ir"];

        let miembrosPorGrupo = {};
        let confirmadosPorGrupo = {};
        let reemplazosPorGrupo = {};
        let sexoPorUsuario = {};
        let esperandoSexo = {};

        async function safeSend(chat, text){
            try { await chat.sendMessage(text); } 
            catch(err){ console.log("Error enviando mensaje:", err.message); }
        }

        function faltantes(grupoID, grupoNombre){
            const hombresFaltan = Math.max(0, HOMBRES_POR_GRUPO[grupoNombre] - Object.values(sexoPorUsuario[grupoID]).filter(s => s==="H").length);
            const mujeresFaltan = Math.max(0, MUJERES_POR_GRUPO[grupoNombre] - Object.values(sexoPorUsuario[grupoID]).filter(s => s==="M").length);
            return {hombres: hombresFaltan, mujeres: mujeresFaltan};
        }

        async function enviarReporte(messageOrChat, grupoID, grupoNombre){
            let listaConfirmadosH = "";
            let listaConfirmadosM = "";

            Object.entries(sexoPorUsuario[grupoID]).forEach(([tel, sexo])=>{
                const nombre = miembrosPorGrupo[grupoID][tel];
                if(sexo === "H") listaConfirmadosH += `${listaConfirmadosH.split("\n").length}. ${nombre}\n`;
                if(sexo === "M") listaConfirmadosM += `${listaConfirmadosM.split("\n").length}. ${nombre}\n`;
            });

            const faltan = faltantes(grupoID, grupoNombre);

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

            if(typeof messageOrChat.reply === 'function'){
                try { await messageOrChat.reply(texto); } 
                catch(err){ console.log("Error reply:", err.message); }
            } else {
                await safeSend(messageOrChat, texto);
            }
        }

        async function generarExcel(grupoID, nombreGrupo){
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet("Asistencia");
            sheet.addRow(["Nombre","Estado","Sexo","Fecha"]);

            confirmadosPorGrupo[grupoID].forEach(telefono=>{
                const nombre = miembrosPorGrupo[grupoID][telefono];
                const sexo = sexoPorUsuario[grupoID][telefono]==="H"?"Hombre":"Mujer";
                sheet.addRow([nombre,"Confirmado",sexo,fecha]);
            });

            reemplazosPorGrupo[grupoID].forEach(telefono=>{
                const nombre = miembrosPorGrupo[grupoID][telefono] || "Desconocido";
                sheet.addRow([nombre,"Reemplazo","-",fecha]);
            });

            try { await workbook.xlsx.writeFile(`asistencia_${nombreGrupo}_${fecha}.xlsx`); }
            catch(err){ console.log("Error guardando Excel:", err.message); }
        }

        // ---------------------- EVENTOS ----------------------
        client.on('qr', qr => qrcode.generate(qr, {small:true}));

        client.on('ready', async () => {
            console.log("Bot listo ✅");

            const chats = await client.getChats();
            const grupos = chats.filter(c => c.isGroup && GRUPOS_ACTIVOS.includes(c.name));

            for(const grupo of grupos){
                const id = grupo.id._serialized;
                miembrosPorGrupo[id] = {};
                confirmadosPorGrupo[id] = [];
                reemplazosPorGrupo[id] = [];
                sexoPorUsuario[id] = {};
                esperandoSexo[id] = {};

                grupo.participants.forEach(p=>{
                    const tel = p.id._serialized;
                    miembrosPorGrupo[id][tel] = p.pushname || p.id.user;
                });

                console.log(`Grupo cargado: ${grupo.name}`);
            }
        });

        client.on('message', async message=>{
            try{
                if(!message.from.includes("@g.us")) return;
                const chat = await message.getChat();
                if(!chat.isGroup) return;
                if(!GRUPOS_ACTIVOS.includes(chat.name)) return;

                const grupoID = chat.id._serialized;
                const grupoNombre = chat.name;
                const texto = (message.body||"").toLowerCase().trim();
                const personaID = message.author || message.from;
                const personaNombre = message._data.notifyName || "Usuario";

                miembrosPorGrupo[grupoID][personaID] = personaNombre;

                if(esperandoSexo[grupoID][personaID]){
                    if(texto==="1" || texto==="2"){
                        const sexo = texto==="1"?"H":"M";
                        const hombresActual = Object.values(sexoPorUsuario[grupoID]).filter(s => s==="H").length;
                        const mujeresActual = Object.values(sexoPorUsuario[grupoID]).filter(s => s==="M").length;

                        if(sexo==="H" && hombresActual>=HOMBRES_POR_GRUPO[grupoNombre]){
                            await safeSend(chat,"⚠️ Cupo de hombres lleno. Puedes quedar como reemplazo.");
                            esperandoSexo[grupoID][personaID]=false; return;
                        }
                        if(sexo==="M" && mujeresActual>=MUJERES_POR_GRUPO[grupoNombre]){
                            await safeSend(chat,"⚠️ Cupo de mujeres lleno. Puedes quedar como reemplazo.");
                            esperandoSexo[grupoID][personaID]=false; return;
                        }

                        sexoPorUsuario[grupoID][personaID]=sexo;
                        if(!confirmadosPorGrupo[grupoID].includes(personaID))
                            confirmadosPorGrupo[grupoID].push(personaID);
                        await safeSend(chat,`✅ Confirmación registrada: ${personaNombre} (${sexo==="H"?"Hombre":"Mujer"})`);

                        esperandoSexo[grupoID][personaID]=false;
                        generarExcel(grupoID, grupoNombre);
                        return;
                    } else {
                        await safeSend(chat,"Por favor responde solo:\n1️⃣ Hombre\n2️⃣ Mujer");
                        return;
                    }
                }

                if(PALABRAS_CONFIRMACION.some(p => texto.includes(p))){
                    await safeSend(chat,"Para completar tu confirmación responde con:\n1️⃣ Hombre\n2️⃣ Mujer");
                    esperandoSexo[grupoID][personaID] = true;
                    return;
                }

                if(PALABRAS_REEMPLAZO.some(p => texto.includes(p))){
                    if(!reemplazosPorGrupo[grupoID].includes(personaID)){
                        reemplazosPorGrupo[grupoID].push(personaID);
                        await safeSend(chat,"🟡 Reemplazo registrado: " + personaNombre);
                        generarExcel(grupoID, grupoNombre);
                    }
                    return;
                }

                if(texto==="reporte") enviarReporte(chat, grupoID, grupoNombre);

            } catch(err){ console.log("ERROR MENSAJE:", err.message); }
        });

        // ---------------------- CRON JOBS ----------------------
        cron.schedule('0 * * * *', async ()=>{
            for(const grupoID in confirmadosPorGrupo){
                const grupoNombre = GRUPOS_ACTIVOS.find(g => miembrosPorGrupo[grupoID] && Object.values(miembrosPorGrupo[grupoID]).length>0) || grupoID;
                const chatObj = {sendMessage: msg => safeSend({id:grupoID}, msg)};
                await enviarReporte(chatObj, grupoID, grupoNombre);
            }
        });

        cron.schedule('0 * * * *', async ()=>{
            for(const grupoID in confirmadosPorGrupo){
                const grupoNombre = GRUPOS_ACTIVOS.find(g => miembrosPorGrupo[grupoID] && Object.values(miembrosPorGrupo[grupoID]).length>0) || grupoID;
                if(confirmadosPorGrupo[grupoID].length>=NECESARIOS_POR_GRUPO[grupoNombre]){
                    let mensaje = "✅ LISTA COMPLETA\n\n";
                    confirmadosPorGrupo[grupoID].forEach((t,i)=>{ mensaje += `${i+1}. ${miembrosPorGrupo[grupoID][t]}\n`; });
                    await safeSend({id:grupoID}, mensaje);
                    generarExcel(grupoID, grupoNombre);
                }
            }
        });

        client.initialize();
    }
});